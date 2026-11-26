// Private Node-parent custodian. Not an authorization, quota or recovery API.
// Native file/crash and host composition qualification are separate from ABI tests.
#define NOMINMAX
#define NAPI_VERSION 8
#include <windows.h>
#include <winternl.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <delayimp.h>
#include <node_api.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

extern "C" NTSYSAPI NTSTATUS NTAPI NtSetSecurityObject(HANDLE, SECURITY_INFORMATION, PSECURITY_DESCRIPTOR);
extern "C" NTSYSAPI NTSTATUS NTAPI NtQueryVolumeInformationFile(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);
// Electron exports the same stable Node-API symbols from its own executable.
static FARPROC WINAPI executableHook(unsigned event, PDelayLoadInfo info) {
    if (event == dliNotePreLoadLibrary && std::strcmp(info->szDll, "node.exe") == 0)
        return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
    return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = executableHook;

namespace {
constexpr size_t chunkBytes = 8192, ownerLimit = 32, fileLimit = 256;
constexpr uint64_t safeInteger = 9007199254740991ULL;
constexpr napi_type_tag storeTag{0x9ad33d4059e740e7ULL, 0xb6832b292e7df3feULL};
constexpr napi_type_tag readerTag{0x13a7b4e326384bb4ULL, 0x95c75337b538aac0ULL};
struct Denied {};
void need(bool condition) { if (!condition) throw Denied{}; }
void js(napi_status status) { need(status == napi_ok); }
bool valid(HANDLE h) { return h != nullptr && h != INVALID_HANDLE_VALUE; }

struct Row {
    uint64_t size = 0, written = 0, allocation = 0;
    std::array<unsigned char, 32> sha{};
    std::array<unsigned char, 24> identity{};
    HANDLE handle = INVALID_HANDLE_VALUE;
    bool finished = false;
};
struct Frame {
    // NtCreateFile may return STATUS_PENDING even when refused by our profile.
    // Keep its ORIGINAL output slot, name, SD and IO block until known return.
    HANDLE handle = INVALID_HANDLE_VALUE;
    std::wstring name;
    UNICODE_STRING string{};
    OBJECT_ATTRIBUTES attributes{};
    IO_STATUS_BLOCK io{};
    LARGE_INTEGER allocation{};
    SECURITY_DESCRIPTOR security{};
    struct Volume { LARGE_INTEGER total, available; ULONG sectors, bytes; } volume{};
};
struct Operation;
struct WorkFrame;
struct Store {
    napi_env env = nullptr;
    std::wstring parent, publication;
    std::array<unsigned char, 32> scope{};
    uint64_t maximumFile = 0, maximumTotal = 0, maximumMetadata = 0;
    uint32_t maximumFiles = 0, maximumMs = 0;
    std::atomic<bool> pending{false}, fenced{false}, uncertain{false}, prepared{false}, closed{false};
    std::atomic<uint32_t> complete{0}, readers{0};
    std::atomic<uint32_t> stage{0}; // Private finite diagnostic; never authority.
    std::atomic<uint32_t> sealStep{0}, sealStatus{0}, permissionBits{0}, permissionControl{0}, sealAccess{0};
    std::vector<HANDLE> ancestors;
    HANDLE token = INVALID_HANDLE_VALUE, root = INVALID_HANDLE_VALUE, receipt = INVALID_HANDLE_VALUE;
    std::array<unsigned char, 24> rootIdentity{};
    std::vector<unsigned char> principal, constructionAcl, sealedAcl;
    std::vector<Row> rows;
    std::shared_ptr<Frame> frame;
    std::shared_ptr<Operation> unacknowledged;
    WorkFrame* unretiredFrame = nullptr; // Retained if native work deletion fails.
    uint64_t allocationUnit = 0, metadataAllocation = 0;
    Row receiptFacts;
    bool effects = false;
};
struct Reader { std::shared_ptr<Store> store; uint32_t index; uint64_t offset = 0; bool closed = false; };
template<class T> struct Box { std::shared_ptr<T> value; };
std::mutex registryMutex;
std::vector<std::shared_ptr<Store>> registry;

uint32_t u32(const unsigned char* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
uint64_t u64(const unsigned char* p) { uint64_t v; std::memcpy(&v, p, 8); return v; }
template<class T> void bytes(std::vector<unsigned char>& out, const T& value) {
    const auto* p = reinterpret_cast<const unsigned char*>(&value); out.insert(out.end(), p, p + sizeof(value));
}
bool hex(wchar_t c) { return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'); }
unsigned char nibble(wchar_t c) { return static_cast<unsigned char>(c <= L'9' ? c - L'0' : c - L'a' + 10); }
std::wstring text(napi_env env, napi_value v, size_t maximum) {
    napi_valuetype type; js(napi_typeof(env, v, &type)); need(type == napi_string);
    size_t length = 0; js(napi_get_value_string_utf16(env, v, nullptr, 0, &length)); need(length > 0 && length <= maximum);
    std::vector<char16_t> data(length + 1); size_t actual = 0;
    js(napi_get_value_string_utf16(env, v, data.data(), data.size(), &actual)); need(actual == length);
    std::wstring result(reinterpret_cast<wchar_t*>(data.data()), length); need(result.find(L'\0') == std::wstring::npos); return result;
}
uint64_t number(napi_env env, napi_value v, uint64_t minimum, uint64_t maximum) {
    napi_valuetype type; js(napi_typeof(env, v, &type)); need(type == napi_number);
    double value; js(napi_get_value_double(env, v, &value));
    need(std::isfinite(value) && value >= static_cast<double>(minimum) && value <= static_cast<double>(maximum)
         && std::floor(value) == value); return static_cast<uint64_t>(value);
}
std::vector<unsigned char> buffer(napi_env env, napi_value v, size_t minimum, size_t maximum) {
    bool actual = false; js(napi_is_buffer(env, v, &actual)); need(actual);
    void* data = nullptr; size_t size = 0; js(napi_get_buffer_info(env, v, &data, &size));
    need(size >= minimum && size <= maximum && data != nullptr);
    const auto* first = static_cast<const unsigned char*>(data); return {first, first + size};
}
void path(const std::wstring& value) {
    need(value.size() >= 4 && value.size() < 32700 && value[1] == L':' && value[2] == L'\\'
         && ((value[0] >= L'A' && value[0] <= L'Z') || (value[0] >= L'a' && value[0] <= L'z')));
    size_t start = 3, count = 0;
    while (start < value.size()) {
        const size_t end = value.find(L'\\', start), stop = end == std::wstring::npos ? value.size() : end;
        const auto part = value.substr(start, stop - start);
        need(!part.empty() && part.size() <= 255 && part != L"." && part != L".." && part.back() != L'.' && part.back() != L' ' && ++count <= 63);
        for (wchar_t c : part) need(c >= 32 && c < 127 && std::wstring(L"<>:\"/|?*").find(c) == std::wstring::npos);
        auto stem = part.substr(0, part.find(L'.')); for (auto& c : stem) c = static_cast<wchar_t>(towupper(c));
        need(stem != L"CON" && stem != L"PRN" && stem != L"AUX" && stem != L"NUL"
             && !(stem.size() == 4 && (stem.substr(0,3) == L"COM" || stem.substr(0,3) == L"LPT") && stem[3] >= L'1' && stem[3] <= L'9'));
        if (end == std::wstring::npos) break; start = end + 1; need(start < value.size());
    }
}
template<class T> std::shared_ptr<T> unbox(napi_env env, napi_value value, const napi_type_tag& tag) {
    bool tagged = false; js(napi_check_object_type_tag(env, value, &tag, &tagged)); need(tagged);
    Box<T>* box = nullptr; js(napi_unwrap(env, value, reinterpret_cast<void**>(&box))); need(box != nullptr && box->value != nullptr); return box->value;
}
template<class T> napi_value box(napi_env env, std::shared_ptr<T> value, const napi_type_tag& tag) {
    auto item = std::make_unique<Box<T>>(); item->value = std::move(value); napi_value object;
    js(napi_create_object(env, &object)); js(napi_type_tag_object(env, object, &tag));
    js(napi_wrap(env, object, item.get(), [](napi_env, void* data, void*) { delete static_cast<Box<T>*>(data); }, nullptr, nullptr));
    item.release(); js(napi_object_freeze(env, object)); return object;
}
std::vector<napi_value> args(napi_env env, napi_callback_info info, size_t expected) {
    size_t count = expected + 1; std::vector<napi_value> result(count); js(napi_get_cb_info(env, info, &count, result.data(), nullptr, nullptr)); need(count == expected); result.resize(count); return result;
}
napi_value boolean(napi_env env, bool value) { napi_value out; js(napi_get_boolean(env, value, &out)); return out; }
napi_value integer(napi_env env, uint32_t value) { napi_value out; js(napi_create_uint32(env, value, &out)); return out; }
napi_value failure(napi_env env) { napi_throw_error(env, "TRAINING_RESULT_STORE_DENIED", "Protected training result storage is unavailable."); return nullptr; }

void kind(HANDLE handle, bool directory) {
    FILE_ATTRIBUTE_TAG_INFO info{}; need(GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info)) != FALSE);
    need(((info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) == directory && info.ReparseTag == 0
         && (info.FileAttributes & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000 | 0x40 | 0x10000)) == 0);
}
std::array<unsigned char, 24> identity(HANDLE handle) {
    FILE_ID_INFO info{}; need(GetFileInformationByHandleEx(handle, FileIdInfo, &info, sizeof(info)) != FALSE);
    static_assert(sizeof(info) == 24); std::array<unsigned char,24> value{}; std::memcpy(value.data(), &info, 24);
    need(std::any_of(value.begin(), value.begin()+8, [](auto c){ return c != 0; }) && std::any_of(value.begin()+8, value.end(), [](auto c){ return c != 0; })); return value;
}
std::vector<unsigned char> acl(const std::vector<unsigned char>& principal, bool sealed) {
    const std::array<unsigned char,12> world{1,1,0,0,0,0,0,1,0,0,0,0}, owner{1,1,0,0,0,0,0,3,4,0,0,0};
    std::vector<unsigned char> result(sizeof(ACL)); auto* head = reinterpret_cast<ACL*>(result.data());
    head->AclRevision = ACL_REVISION; head->AceCount = 3; head->AclSize = static_cast<WORD>(56 + principal.size());
    auto ace = [&](BYTE type, DWORD mask, const auto& sid) {
        bytes(result, type); bytes(result, BYTE{0}); bytes(result, static_cast<WORD>(8 + sid.size())); bytes(result, mask); result.insert(result.end(), sid.begin(), sid.end());
    };
    ace(ACCESS_DENIED_ACE_TYPE, sealed ? 0xD0156UL : 0xD0150UL, world);
    ace(ACCESS_ALLOWED_ACE_TYPE, 0x20000UL, owner); ace(ACCESS_ALLOWED_ACE_TYPE, 0x1701ffUL, principal);
    need(IsValidAcl(reinterpret_cast<PACL>(result.data())) != FALSE); return result;
}
void principal(Store& s) {
    need(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &s.token) != FALSE); DWORD length = 0;
    need(GetTokenInformation(s.token, TokenUser, nullptr, 0, &length) == FALSE && GetLastError() == ERROR_INSUFFICIENT_BUFFER && length >= sizeof(TOKEN_USER) && length <= 4096);
    std::vector<unsigned char> data(length); need(GetTokenInformation(s.token, TokenUser, data.data(), length, &length) != FALSE);
    auto* user = reinterpret_cast<TOKEN_USER*>(data.data()); const auto first = reinterpret_cast<uintptr_t>(data.data()), sid = reinterpret_cast<uintptr_t>(user->User.Sid);
    need(sid >= first && sid + 8 <= first + data.size() && IsValidSid(user->User.Sid) != FALSE);
    const DWORD size = GetLengthSid(user->User.Sid); need(size >= 8 && size <= 68 && sid + size <= first + data.size());
    s.principal.assign(reinterpret_cast<unsigned char*>(sid), reinterpret_cast<unsigned char*>(sid) + size);
    need(CloseHandle(s.token) != FALSE); s.token = INVALID_HANDLE_VALUE;
    s.constructionAcl = acl(s.principal, false); s.sealedAcl = acl(s.principal, true);
}
void permissions(Store& s, HANDLE h, bool sealed) {
    PSID owner = nullptr; PACL observed = nullptr; PSECURITY_DESCRIPTOR descriptor = nullptr;
    const DWORD status = GetSecurityInfo(h, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr, &observed, nullptr, &descriptor);
    // A known return never leaves an asynchronous borrower of this allocation.
    bool correct = false;
    s.permissionBits=0; s.permissionControl=0;
    if (status == ERROR_SUCCESS && descriptor != nullptr && owner != nullptr && observed != nullptr && IsValidSecurityDescriptor(descriptor) && IsValidSid(owner) && IsValidAcl(observed)) {
        SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision = 0; const auto& expected = sealed ? s.sealedAcl : s.constructionAcl;
        const bool haveControl=GetSecurityDescriptorControl(descriptor,&control,&revision)!=FALSE;
        s.permissionControl=haveControl?static_cast<uint32_t>(control & 0x150c):0;
        const uint32_t bits=1U | (EqualSid(owner,s.principal.data())?2U:0U)
            | (observed->AclSize==expected.size() && std::memcmp(observed,expected.data(),expected.size())==0?4U:0U)
            | (haveControl && (control & 0x150c)==0x1004?8U:0U);
        s.permissionBits=bits; correct=bits==15;
    }
    if (descriptor != nullptr) need(LocalFree(descriptor) == nullptr); need(correct);
}
void securityDescriptor(Store& s, SECURITY_DESCRIPTOR& descriptor, bool sealed) {
    const auto& policy=sealed?s.sealedAcl:s.constructionAcl;
    need(InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION)
        && SetSecurityDescriptorOwner(&descriptor,s.principal.data(),FALSE)
        && SetSecurityDescriptorDacl(&descriptor,TRUE,reinterpret_cast<PACL>(const_cast<unsigned char*>(policy.data())),FALSE)
        && SetSecurityDescriptorControl(&descriptor,0x1500,0x1000)
        && IsValidSecurityDescriptor(&descriptor));
}
HANDLE open(Store& s, HANDLE parent, const std::wstring& name, bool directory, bool fresh, uint64_t allocation = 0) {
    need(s.frame == nullptr); s.frame = std::make_shared<Frame>(); auto& f = *s.frame; f.name = name;
    f.string.Length = static_cast<USHORT>(name.size()*2); f.string.MaximumLength = f.string.Length; f.string.Buffer = f.name.data();
    f.attributes.Length = sizeof(OBJECT_ATTRIBUTES); f.attributes.RootDirectory = parent; f.attributes.ObjectName = &f.string; f.attributes.Attributes = 0x40;
    if (fresh) {
        securityDescriptor(s,f.security,false);
        f.attributes.SecurityDescriptor = &f.security; s.effects = true;
    }
    f.allocation.QuadPart = static_cast<LONGLONG>(allocation);
    const ACCESS_MASK access = fresh ? (directory ? 0x1701a7UL : 0x17019fUL) : 0x1200a1UL;
    const NTSTATUS status = NtCreateFile(&f.handle, access, &f.attributes, &f.io, allocation ? &f.allocation : nullptr,
        FILE_ATTRIBUTE_NORMAL, fresh ? 0 : FILE_SHARE_READ, fresh ? 2 : 1, 0x200000 | 0x20 | (directory ? 1 : 0x40), nullptr, 0);
    // No retry, destructor or GC may free an original unknown native frame.
    need(status == 0 && f.io.Status == 0 && f.io.Information == static_cast<ULONG_PTR>(fresh ? 2 : 1) && valid(f.handle));
    const HANDLE result = f.handle;
    // Register the returned creator BEFORE any inspecting native call.
    if (!fresh) s.ancestors.push_back(result);
    else if (directory) s.root = result;
    else if (s.rows.size() > 0 && std::all_of(s.rows.begin(), s.rows.end(), [](const Row& r){ return valid(r.handle); })) s.receipt = result;
    else { auto row = std::find_if(s.rows.begin(), s.rows.end(), [](const Row& r){ return !valid(r.handle); }); need(row != s.rows.end()); row->handle = result; }
    s.frame.reset(); kind(result, directory); if (fresh) permissions(s, result, false); return result;
}
void seal(Store& s, HANDLE h) {
    s.sealStep=1; const auto id = identity(h); s.sealStep=2; permissions(s,h,false); SECURITY_DESCRIPTOR descriptor{};
    s.sealStep=3;
    securityDescriptor(s,descriptor,true);
    // Advisory rights only, never a substitute for the enforced calls/checks.
    std::array<DWORD,14> basic{}; ULONG length=0;
    s.sealAccess=NtQueryObject(h,ObjectBasicInformation,basic.data(),static_cast<ULONG>(sizeof(basic)),&length)==0 && length==sizeof(basic)?basic[1]:0;
    s.sealStep=4; const NTSTATUS status=NtSetSecurityObject(h,DACL_SECURITY_INFORMATION,&descriptor); s.sealStatus=static_cast<uint32_t>(status);
    need(status==0); s.sealStep=5; permissions(s,h,true); s.sealStep=6; need(identity(h)==id);
}
void facts(Store& s, Row& r, uint64_t expectedSize) {
    kind(r.handle, false); FILE_STANDARD_INFO info{};
    need(GetFileInformationByHandleEx(r.handle, FileStandardInfo, &info, sizeof(info)) && !info.DeletePending && !info.Directory && info.NumberOfLinks == 1
        && info.EndOfFile.QuadPart == static_cast<LONGLONG>(expectedSize) && info.AllocationSize.QuadPart >= 0 && static_cast<uint64_t>(info.AllocationSize.QuadPart) <= r.allocation);
    alignas(8) std::array<unsigned char,4096> stream{};
    need(GetFileInformationByHandleEx(r.handle, FileStreamInfo, stream.data(), static_cast<DWORD>(stream.size())));
    need(u32(stream.data()) == 0 && u32(stream.data()+4) == 14 && u64(stream.data()+8) == expectedSize
         && u64(stream.data()+16) == static_cast<uint64_t>(info.AllocationSize.QuadPart) && std::memcmp(stream.data()+24,L"::$DATA",14) == 0);
    need(identity(r.handle) == r.identity); permissions(s,r.handle,true);
}
void seek(HANDLE handle, uint64_t offset) { LARGE_INTEGER distance{}; distance.QuadPart = static_cast<LONGLONG>(offset); need(SetFilePointerEx(handle,distance,nullptr,FILE_BEGIN)); }
void write(HANDLE handle, const unsigned char* data, size_t size) {
    DWORD count = 0; need(size <= chunkBytes && WriteFile(handle,data,static_cast<DWORD>(size),&count,nullptr) && count == size);
}
struct Hash {
    BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE hash = nullptr; std::vector<unsigned char> object;
    Hash() {
        try {
            need(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,MS_PRIMITIVE_PROVIDER,0) == 0); DWORD size = 0, result = 0;
            need(BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&size),sizeof(size),&result,0) == 0 && result == 4 && size > 0 && size <= 65536);
            object.resize(size); need(BCryptCreateHash(algorithm,&hash,object.data(),size,nullptr,0,0) == 0);
        } catch(...) { if(hash) BCryptDestroyHash(hash); if(algorithm) BCryptCloseAlgorithmProvider(algorithm,0); throw; }
    }
    void add(const unsigned char* data, size_t size) { need(size <= chunkBytes && BCryptHashData(hash,const_cast<PUCHAR>(data),static_cast<ULONG>(size),0) == 0); }
    std::array<unsigned char,32> finish() { std::array<unsigned char,32> out{}; need(BCryptFinishHash(hash,out.data(),32,0) == 0); return out; }
    ~Hash() { if (hash) BCryptDestroyHash(hash); if (algorithm) BCryptCloseAlgorithmProvider(algorithm,0); }
};
enum class Action { prepare, append, finish, read, discard };
struct Operation {
    napi_env env; napi_deferred deferred = nullptr; napi_async_work work = nullptr;
    std::shared_ptr<Store> store; std::shared_ptr<Reader> reader; Action action;
    uint32_t index = 0, maximum = 0; std::vector<unsigned char> data;
    ULONGLONG started = 0; bool success = false, entered = false;
    void guard(bool allowFence = false) { need(!store->uncertain && !store->closed && (allowFence || !store->fenced) && GetTickCount64()-started < store->maximumMs); }
    void namespaceMatches(bool complete) {
        auto& s=*store; std::vector<bool> seen(s.rows.size()+1,false); size_t count=0;
        alignas(8) std::array<unsigned char,65536> page{};
        static_assert(offsetof(FILE_ID_EXTD_DIR_INFO,FileName)==88);
        for(unsigned pass=0;pass<4;++pass) {
            guard(); page.fill(0);
            if(!GetFileInformationByHandleEx(s.root,pass==0?FileIdExtdDirectoryRestartInfo:FileIdExtdDirectoryInfo,page.data(),static_cast<DWORD>(page.size()))) {
                need(GetLastError()==ERROR_NO_MORE_FILES && count==seen.size()); return;
            }
            size_t offset=0;
            for(size_t row=0;row<fileLimit+3;++row) {
                need(offset+88<=page.size()); const auto* entry=reinterpret_cast<const FILE_ID_EXTD_DIR_INFO*>(page.data()+offset);
                need(entry->FileNameLength>0 && entry->FileNameLength%2==0 && entry->FileNameLength<=510 && offset+88+entry->FileNameLength<=page.size());
                std::wstring name(entry->FileName,entry->FileNameLength/2);
                if(name!=L"." && name!=L"..") {
                    const auto expected=[&]() -> size_t {
                        if(name==L"receipt.bin") return s.rows.size();
                        for(size_t i=0;i<s.rows.size();++i) if(name==std::to_wstring(i)+L".bin") return i;
                        throw Denied{};
                    }();
                    need(!seen[expected] && (entry->FileAttributes & ~(FILE_ATTRIBUTE_NORMAL | FILE_ATTRIBUTE_ARCHIVE))==0 && entry->ReparsePointTag==0 && entry->EaSize==0);
                    const Row& original=expected==s.rows.size()?s.receiptFacts:s.rows[expected];
                    need(std::memcmp(entry->FileId.Identifier,original.identity.data()+8,16)==0
                        && entry->EndOfFile.QuadPart==static_cast<LONGLONG>(complete?original.size:0)
                        && entry->AllocationSize.QuadPart>=0 && static_cast<uint64_t>(entry->AllocationSize.QuadPart)<=original.allocation);
                    seen[expected]=true; ++count;
                }
                if(entry->NextEntryOffset==0) break;
                need(entry->NextEntryOffset%8==0 && entry->NextEntryOffset>=88+entry->FileNameLength && offset+entry->NextEntryOffset<page.size()); offset+=entry->NextEntryOffset;
                need(row<fileLimit+2);
            }
        }
        throw Denied{};
    }
    void metadataFacts() {
        auto& s=*store; kind(s.root,true); need(identity(s.root)==s.rootIdentity); permissions(s,s.root,true);
        FILE_STANDARD_INFO info{}; need(GetFileInformationByHandleEx(s.root,FileStandardInfo,&info,sizeof(info)) && info.Directory && !info.DeletePending
            && info.AllocationSize.QuadPart>=0 && static_cast<uint64_t>(info.AllocationSize.QuadPart)<=s.maximumMetadata-s.metadataAllocation);
        // A named directory stream is not an enumerated child. Reject it too;
        // unsupported or oversized stream queries never become a clean tree.
        alignas(8) std::array<unsigned char,4096> streams{};
        if(GetFileInformationByHandleEx(s.root,FileStreamInfo,streams.data(),static_cast<DWORD>(streams.size()))) {
            need(u32(streams.data())==0 && (u32(streams.data()+4)==0 || (u32(streams.data()+4)==14 && std::memcmp(streams.data()+24,L"::$DATA",14)==0))
                && u64(streams.data()+8)==0 && u64(streams.data()+16)==0);
        } else need(GetLastError()==ERROR_HANDLE_EOF);
    }
    void prepare() {
        auto& s = *store; guard(); s.stage=1; principal(s); s.stage=2;
        need(GetDriveTypeW(s.parent.substr(0,3).c_str()) == DRIVE_FIXED);
        HANDLE parent = open(s,nullptr,L"\\??\\" + s.parent.substr(0,3),true,false);
        wchar_t filesystem[32]{}; DWORD flags = 0;
        need(GetVolumeInformationByHandleW(parent,nullptr,0,nullptr,nullptr,&flags,filesystem,32) && std::wcscmp(filesystem,L"NTFS") == 0 && (flags & FILE_PERSISTENT_ACLS));
        for (size_t start=3; start<s.parent.size();) {
            guard(); const auto end=s.parent.find(L'\\',start); parent=open(s,parent,s.parent.substr(start,end==std::wstring::npos?end:end-start),true,false);
            if (end==std::wstring::npos) break; start=end+1;
        }
        s.stage=3; need(s.frame == nullptr); s.frame=std::make_shared<Frame>(); auto& query=*s.frame; auto& volume=query.volume;
        need(NtQueryVolumeInformationFile(parent,&query.io,&volume,sizeof(volume),3) == 0 && query.io.Status == 0 && query.io.Information == sizeof(volume)
            && volume.sectors >= 1 && volume.sectors <= 65536 && volume.bytes >= 512 && volume.bytes <= 65536 && volume.available.QuadPart >= 0 && volume.available.QuadPart <= volume.total.QuadPart);
        s.allocationUnit=static_cast<uint64_t>(volume.sectors)*volume.bytes; need(s.allocationUnit <= 1024*1024 && (s.allocationUnit & (s.allocationUnit-1)) == 0);
        uint64_t allocated=0; for (auto& row:s.rows) { row.allocation=(row.size+s.allocationUnit-1)/s.allocationUnit*s.allocationUnit; need(row.allocation <= s.maximumTotal-allocated); allocated+=row.allocation; }
        const uint64_t metadata=116+68*s.rows.size(); s.metadataAllocation=(metadata+s.allocationUnit-1)/s.allocationUnit*s.allocationUnit;
        // Reserve the complete explicit metadata bound, then measure root and
        // receipt allocations before bytes. Free observation is NOT a quota.
        const uint64_t metadataUnits=(s.maximumMetadata+s.allocationUnit-1)/s.allocationUnit;
        need(s.metadataAllocation+s.allocationUnit <= s.maximumMetadata && allocated/s.allocationUnit+metadataUnits <= static_cast<uint64_t>(volume.available.QuadPart));
        s.frame.reset();
        guard(); s.stage=4; open(s,parent,s.publication,true,true); s.rootIdentity=identity(s.root); s.stage=5;
        for (uint32_t i=0;i<s.rows.size();++i) { guard(); auto h=open(s,s.root,std::to_wstring(i)+L".bin",false,true,s.rows[i].allocation); s.rows[i].identity=identity(h); }
        guard(); open(s,s.root,L"receipt.bin",false,true,s.metadataAllocation);
        s.receiptFacts.handle=s.receipt; s.receiptFacts.allocation=s.metadataAllocation; s.receiptFacts.size=metadata; s.receiptFacts.identity=identity(s.receipt);
        // Every empty entry is sealed before the first private payload write.
        s.stage=6; for (const auto& row:s.rows) { guard(); seal(s,row.handle); }
        seal(s,s.receipt); seal(s,s.root);
        s.stage=7; for (auto& row:s.rows) { guard(); facts(s,row,0); }
        facts(s,s.receiptFacts,0); metadataFacts(); namespaceMatches(false); s.prepared=true; s.stage=8;
    }
    void finish() {
        auto& s=*store; auto& r=s.rows[index]; guard(); s.stage=10; need(r.written==r.size && FlushFileBuffers(r.handle)); facts(s,r,r.size); seek(r.handle,0);
        Hash hash; std::array<unsigned char,chunkBytes> part{}; uint64_t remaining=r.size;
        while (remaining) { guard(); DWORD count=0; const DWORD request=static_cast<DWORD>(std::min<uint64_t>(remaining,chunkBytes)); need(ReadFile(r.handle,part.data(),request,&count,nullptr) && count>0 && count<=request); hash.add(part.data(),count); remaining-=count; }
        DWORD eof=0; need(ReadFile(r.handle,part.data(),1,&eof,nullptr) && eof==0 && hash.finish()==r.sha); facts(s,r,r.size);
        r.finished=true; s.complete.fetch_add(1);
        if (s.complete==s.rows.size()) {
            s.stage=11;
            std::vector<unsigned char> receipt{'A','S','B','T','R','S','0','1'};
            for (size_t i=0;i<s.publication.size();i+=2) receipt.push_back(static_cast<unsigned char>((nibble(s.publication[i])<<4)|nibble(s.publication[i+1])));
            receipt.insert(receipt.end(),s.scope.begin(),s.scope.end()); receipt.insert(receipt.end(),s.rootIdentity.begin(),s.rootIdentity.end()); bytes(receipt,static_cast<uint32_t>(s.rows.size()));
            for (uint32_t i=0;i<s.rows.size();++i) { bytes(receipt,i); bytes(receipt,s.rows[i].size); receipt.insert(receipt.end(),s.rows[i].sha.begin(),s.rows[i].sha.end()); receipt.insert(receipt.end(),s.rows[i].identity.begin(),s.rows[i].identity.end()); }
            Hash check; for (size_t p=0;p<receipt.size();p+=chunkBytes) check.add(receipt.data()+p,std::min(chunkBytes,receipt.size()-p)); const auto sha=check.finish(); receipt.insert(receipt.end(),sha.begin(),sha.end());
            need(receipt.size()<=s.metadataAllocation); seek(s.receipt,0);
            for (size_t p=0;p<receipt.size();p+=chunkBytes) { guard(); write(s.receipt,receipt.data()+p,std::min(chunkBytes,receipt.size()-p)); }
            need(FlushFileBuffers(s.receipt)); seek(s.receipt,0); std::vector<unsigned char> reread(receipt.size()); size_t offset=0;
            while(offset<reread.size()) { guard(); DWORD count=0; const DWORD request=static_cast<DWORD>(std::min(chunkBytes,reread.size()-offset)); need(ReadFile(s.receipt,reread.data()+offset,request,&count,nullptr) && count>0 && count<=request); offset+=count; }
            need(reread==receipt); facts(s,s.receiptFacts,receipt.size()); metadataFacts(); namespaceMatches(true);
        }
    }
    void discard() {
        auto& s=*store; guard(true); need(s.fenced && s.readers==0 && !s.uncertain && s.frame==nullptr);
        s.stage=13;
        auto remove=[&](HANDLE& h) { if (!valid(h)) return; guard(true); FILE_DISPOSITION_INFO disposition{TRUE}; need(SetFileInformationByHandle(h,FileDispositionInfo,&disposition,sizeof(disposition))); need(CloseHandle(h)); h=INVALID_HANDLE_VALUE; };
        // Only exact original creators from this live episode. No path deletion,
        // old-root adoption, ACL restoration or accounting credit exists here.
        for(auto& row:s.rows) remove(row.handle); remove(s.receipt); remove(s.root);
        for(auto i=s.ancestors.rbegin();i!=s.ancestors.rend();++i) { guard(true); need(CloseHandle(*i)); *i=INVALID_HANDLE_VALUE; }
        if(valid(s.token)) { need(CloseHandle(s.token)); s.token=INVALID_HANDLE_VALUE; }
        s.closed=true; s.stage=14; std::lock_guard lock(registryMutex); registry.erase(std::remove(registry.begin(),registry.end(),store),registry.end());
    }
    void execute() {
        entered=true;
        try {
            if(action==Action::prepare) prepare();
            else if(action==Action::discard) discard();
            else if(action==Action::append) { guard(); store->stage=9; auto& row=store->rows[index]; facts(*store,row,row.written); seek(row.handle,row.written); guard(); write(row.handle,data.data(),data.size()); row.written+=data.size(); guard(); facts(*store,row,row.written); }
            else if(action==Action::finish) finish();
            else {
                guard(true); store->stage=12; auto& r=store->rows[reader->index]; facts(*store,r,r.size); seek(r.handle,reader->offset); data.resize(static_cast<size_t>(std::min<uint64_t>(maximum,r.size-reader->offset)));
                if(!data.empty()) { DWORD count=0; need(ReadFile(r.handle,data.data(),static_cast<DWORD>(data.size()),&count,nullptr) && count==data.size()); reader->offset+=count; }
                guard(true); facts(*store,r,r.size);
            }
            if(action!=Action::discard) guard(action==Action::read);
            success=true;
        } catch(...) { store->uncertain=true; store->fenced=true; }
    }
};
struct WorkFrame { std::shared_ptr<Operation> operation; };
napi_value queue(napi_env env, std::unique_ptr<Operation> op) {
    auto s=op->store; need(s->env==env && !s->closed && !s->uncertain && !s->pending.exchange(true));
    // Allocate the shared lifetime/control block before native dispatch. The
    // completion callback itself needs no C++ heap allocation to retain it.
    std::unique_ptr<WorkFrame> frame;
    napi_value promise, name;
    try {
        frame=std::make_unique<WorkFrame>(); frame->operation=std::shared_ptr<Operation>(std::move(op));
        auto original=frame->operation; original->started=GetTickCount64();
        js(napi_create_promise(env,&original->deferred,&promise)); js(napi_create_string_utf8(env,"protected-training-result-io",NAPI_AUTO_LENGTH,&name));
        js(napi_create_async_work(env,nullptr,name,[](napi_env,void* data){ static_cast<WorkFrame*>(data)->operation->execute(); },[](napi_env env,napi_status status,void* data){
            std::unique_ptr<WorkFrame> frame(static_cast<WorkFrame*>(data)); auto original=frame->operation; auto owner=original->store;
            if(owner->unretiredFrame==frame.get()) owner->unretiredFrame=nullptr;
            // Actual execute retirement AND known promise settlement are needed.
            // An unavailable NAPI allocation/settlement keeps original custody.
            bool settled=false;
            if(env!=nullptr) {
                napi_value value=nullptr;
                if(status==napi_ok && original->entered && original->success) {
                    const auto made=original->action==Action::read
                        ? napi_create_buffer_copy(env,original->data.size(),original->data.data(),nullptr,&value)
                        : napi_get_boolean(env,true,&value);
                    settled=made==napi_ok && value!=nullptr && napi_resolve_deferred(env,original->deferred,value)==napi_ok;
                } else { owner->uncertain=true; owner->fenced=true; napi_value message=nullptr,code=nullptr,error=nullptr;
                    settled=napi_create_string_utf8(env,"Protected training result storage is unavailable.",NAPI_AUTO_LENGTH,&message)==napi_ok
                        && napi_create_string_utf8(env,"TRAINING_RESULT_STORE_DENIED",NAPI_AUTO_LENGTH,&code)==napi_ok
                        && napi_create_error(env,code,message,&error)==napi_ok && napi_reject_deferred(env,original->deferred,error)==napi_ok;
                }
                settled=settled && napi_delete_async_work(env,original->work)==napi_ok;
            }
            if(settled) owner->pending=false;
            else { owner->uncertain=true; owner->fenced=true; owner->unacknowledged=original; }
        },frame.get(),&original->work));
        js(napi_queue_async_work(env,original->work)); frame.release(); return promise;
    } catch(...) {
        if(frame && frame->operation && frame->operation->work && napi_delete_async_work(env,frame->operation->work)!=napi_ok) {
            s->uncertain=true; s->fenced=true; s->unacknowledged=frame->operation;
            s->unretiredFrame=frame.release();
        } else s->pending=false;
        throw;
    }
}
napi_value create(napi_env env,napi_callback_info info) {
    try {
        const auto a=args(env,info,8); auto s=std::make_shared<Store>(); s->env=env; s->parent=text(env,a[0],32700); path(s->parent);
        s->publication=text(env,a[1],32); need(s->publication.size()==32 && std::all_of(s->publication.begin(),s->publication.end(),hex));
        const auto scope=text(env,a[2],64); need(scope.size()==64 && std::all_of(scope.begin(),scope.end(),hex));
        for(size_t i=0;i<32;++i) s->scope[i]=static_cast<unsigned char>((nibble(scope[2*i])<<4)|nibble(scope[2*i+1]));
        s->maximumFiles=static_cast<uint32_t>(number(env,a[3],1,fileLimit)); s->maximumFile=number(env,a[4],1,safeInteger);
        s->maximumTotal=number(env,a[5],s->maximumFile,safeInteger); s->maximumMetadata=number(env,a[6],4096,1024*1024);
        s->maximumMs=static_cast<uint32_t>(number(env,a[7],1,120000));
        std::lock_guard lock(registryMutex); need(registry.size()<ownerLimit); registry.push_back(s); return box(env,s,storeTag);
    } catch(...) { return failure(env); }
}
napi_value prepare(napi_env env,napi_callback_info info) {
    try {
        const auto a=args(env,info,2); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && !s->pending && !s->prepared && !s->fenced && !s->effects && s->rows.empty());
        const auto data=buffer(env,a[1],12,12+44*fileLimit); need(std::memcmp(data.data(),"ASBTRS01",8)==0); const uint32_t count=u32(data.data()+8);
        need(count>0 && count<=s->maximumFiles && data.size()==12+44*count); std::vector<Row> rows; uint64_t total=0;
        for(uint32_t i=0;i<count;++i) { const auto* p=data.data()+12+44*i; Row row; need(u32(p)==i); row.size=u64(p+4); need(row.size>0 && row.size<=s->maximumFile && row.size<=s->maximumTotal-total); total+=row.size; std::memcpy(row.sha.data(),p+12,32); rows.push_back(row); }
        need(116+68*count<=s->maximumMetadata); auto op=std::make_unique<Operation>(); op->env=env; op->store=s; op->action=Action::prepare; s->rows=std::move(rows); return queue(env,std::move(op));
    } catch(...) { return failure(env); }
}
napi_value append(napi_env env,napi_callback_info info) {
    try { const auto a=args(env,info,3); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && s->prepared && !s->pending && !s->fenced);
        const auto index=static_cast<uint32_t>(number(env,a[1],0,s->rows.size()-1)); need(index==s->complete && !s->rows[index].finished);
        auto data=buffer(env,a[2],1,chunkBytes); need(data.size()<=s->rows[index].size-s->rows[index].written);
        auto op=std::make_unique<Operation>(); op->env=env; op->store=s; op->index=index; op->data=std::move(data); op->action=Action::append; return queue(env,std::move(op));
    } catch(...) { return failure(env); }
}
napi_value finish(napi_env env,napi_callback_info info) {
    try { const auto a=args(env,info,2); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && s->prepared && !s->pending && !s->fenced);
        const auto index=static_cast<uint32_t>(number(env,a[1],0,s->rows.size()-1)); need(index==s->complete && !s->rows[index].finished && s->rows[index].written==s->rows[index].size);
        auto op=std::make_unique<Operation>(); op->env=env; op->store=s; op->index=index; op->action=Action::finish; return queue(env,std::move(op));
    } catch(...) { return failure(env); }
}
napi_value fence(napi_env env,napi_callback_info info) { try { auto a=args(env,info,1); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env); s->fenced=true; return boolean(env,true); } catch(...) { return failure(env); } }
napi_value inspect(napi_env env,napi_callback_info info) {
    try { auto a=args(env,info,1); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env); napi_value result; js(napi_create_object(env,&result));
        for(auto [key,value]:std::vector<std::pair<const char*,bool>>{{"pending",s->pending},{"fenced",s->fenced},{"uncertain",s->uncertain},{"prepared",s->prepared},{"closed",s->closed}}) js(napi_set_named_property(env,result,key,boolean(env,value)));
        js(napi_set_named_property(env,result,"completedFiles",integer(env,s->complete))); js(napi_set_named_property(env,result,"readers",integer(env,s->readers)));
        napi_value diagnostic; js(napi_create_object(env,&diagnostic));
        for(auto [key,value]:std::vector<std::pair<const char*,uint32_t>>{{"sealStep",s->sealStep},{"nativeStatus",s->sealStatus},{"permissionBits",s->permissionBits},{"permissionControl",s->permissionControl},{"grantedAccess",s->sealAccess}})
            js(napi_set_named_property(env,diagnostic,key,integer(env,value)));
        js(napi_object_freeze(env,diagnostic)); js(napi_set_named_property(env,result,"diagnostics",diagnostic));
        js(napi_set_named_property(env,result,"stage",integer(env,s->stage))); js(napi_object_freeze(env,result)); return result;
    } catch(...) { return failure(env); }
}
napi_value openReader(napi_env env,napi_callback_info info) {
    try { auto a=args(env,info,2); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && s->prepared && !s->pending && !s->closed && !s->uncertain && s->complete==s->rows.size() && s->readers==0);
        const auto index=static_cast<uint32_t>(number(env,a[1],0,s->rows.size()-1)); auto reader=std::make_shared<Reader>(); reader->store=s; reader->index=index; auto value=box(env,reader,readerTag); s->readers=1; return value;
    } catch(...) { return failure(env); }
}
napi_value read(napi_env env,napi_callback_info info) {
    try { auto a=args(env,info,2); auto r=unbox<Reader>(env,a[0],readerTag); need(r->store->env==env && !r->closed && !r->store->pending);
        auto op=std::make_unique<Operation>(); op->env=env; op->store=r->store; op->reader=r; op->action=Action::read; op->maximum=static_cast<uint32_t>(number(env,a[1],1,chunkBytes)); return queue(env,std::move(op));
    } catch(...) { return failure(env); }
}
napi_value closeReader(napi_env env,napi_callback_info info) { try { auto a=args(env,info,1); auto r=unbox<Reader>(env,a[0],readerTag); need(r->store->env==env && !r->closed && !r->store->pending && !r->store->uncertain); r->closed=true; r->store->readers=0; return boolean(env,true); } catch(...) { return failure(env); } }
napi_value discard(napi_env env,napi_callback_info info) {
    try { auto a=args(env,info,1); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && s->fenced && !s->pending && s->readers==0 && !s->uncertain);
        auto op=std::make_unique<Operation>(); op->env=env; op->store=s; op->action=Action::discard; return queue(env,std::move(op));
    } catch(...) { return failure(env); }
}
napi_value init(napi_env env,napi_value exports) {
    const napi_property_descriptor descriptors[] = {
        {"createStore",nullptr,create,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"prepare",nullptr,prepare,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"append",nullptr,append,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"finishFile",nullptr,finish,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"fence",nullptr,fence,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"inspect",nullptr,inspect,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"openReader",nullptr,openReader,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"read",nullptr,read,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"closeReader",nullptr,closeReader,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"discard",nullptr,discard,nullptr,nullptr,nullptr,napi_default,nullptr},
    };
    if(napi_define_properties(env,exports,sizeof(descriptors)/sizeof(descriptors[0]),descriptors)!=napi_ok || napi_object_freeze(env,exports)!=napi_ok) return failure(env);
    return exports;
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
