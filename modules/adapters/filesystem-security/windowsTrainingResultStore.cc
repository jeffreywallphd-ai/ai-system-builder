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
    uint64_t size = 0, written = 0, offset = 0;
    uint16_t group = 0;
    unsigned char role = 0, name = 0;
    std::array<unsigned char, 32> sha{};
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
    HANDLE token = INVALID_HANDLE_VALUE, container = INVALID_HANDLE_VALUE;
    std::array<unsigned char, 24> containerIdentity{};
    std::vector<unsigned char> principal, sealedAcl;
    std::vector<Row> rows;
    std::vector<unsigned char> prefix, footer;
    uint64_t payloadBytes = 0, footerOffset = 0, physicalLength = 0, currentLength = 0, physicalAllocation = 0;
    std::atomic<bool> finalized{false};
    std::shared_ptr<Frame> frame;
    std::shared_ptr<Operation> unacknowledged;
    WorkFrame* unretiredFrame = nullptr; // Retained if native work deletion fails.
    uint64_t allocationUnit = 0;
    bool effects = false;
};
struct Reader { std::shared_ptr<Store> store; uint32_t index; uint64_t offset = 0; bool closed = false; };
template<class T> struct Box { std::shared_ptr<T> value; };
std::mutex registryMutex;
std::vector<std::shared_ptr<Store>> registry;

uint32_t u32(const unsigned char* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
uint16_t u16(const unsigned char* p) { uint16_t v; std::memcpy(&v, p, 2); return v; }
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
std::vector<unsigned char> acl(const std::vector<unsigned char>& principal) {
    const std::array<unsigned char,12> world{1,1,0,0,0,0,0,1,0,0,0,0}, owner{1,1,0,0,0,0,0,3,4,0,0,0};
    std::vector<unsigned char> result(sizeof(ACL)); auto* head = reinterpret_cast<ACL*>(result.data());
    head->AclRevision = ACL_REVISION; head->AceCount = 3; head->AclSize = static_cast<WORD>(56 + principal.size());
    auto ace = [&](BYTE type, DWORD mask, const auto& sid) {
        bytes(result, type); bytes(result, BYTE{0}); bytes(result, static_cast<WORD>(8 + sid.size())); bytes(result, mask); result.insert(result.end(), sid.begin(), sid.end());
    };
    // Fresh private results are read only through their original capability.
    // Sharing mode alone did not deny secondary path reads on Windows.
    ace(ACCESS_DENIED_ACE_TYPE, 0xD0157UL, world);
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
    s.sealedAcl = acl(s.principal);
}
void permissions(Store& s, HANDLE h) {
    PSID owner = nullptr; PACL observed = nullptr; PSECURITY_DESCRIPTOR descriptor = nullptr;
    const DWORD status = GetSecurityInfo(h, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr, &observed, nullptr, &descriptor);
    // A known return never leaves an asynchronous borrower of this allocation.
    bool correct = false;
    s.permissionBits=0; s.permissionControl=0;
    if (status == ERROR_SUCCESS && descriptor != nullptr && owner != nullptr && observed != nullptr && IsValidSecurityDescriptor(descriptor) && IsValidSid(owner) && IsValidAcl(observed)) {
        SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision = 0; const auto& expected = s.sealedAcl;
        const bool haveControl=GetSecurityDescriptorControl(descriptor,&control,&revision)!=FALSE;
        s.permissionControl=haveControl?static_cast<uint32_t>(control & 0x150c):0;
        const uint32_t bits=1U | (EqualSid(owner,s.principal.data())?2U:0U)
            | (observed->AclSize==expected.size() && std::memcmp(observed,expected.data(),expected.size())==0?4U:0U)
            | (haveControl && (control & 0x150c)==0x1004?8U:0U);
        s.permissionBits=bits; correct=bits==15;
    }
    if (descriptor != nullptr) need(LocalFree(descriptor) == nullptr); need(correct);
}
void securityDescriptor(Store& s, SECURITY_DESCRIPTOR& descriptor) {
    const auto& policy=s.sealedAcl;
    need(InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION)
        && SetSecurityDescriptorOwner(&descriptor,s.principal.data(),FALSE)
        && SetSecurityDescriptorDacl(&descriptor,TRUE,reinterpret_cast<PACL>(const_cast<unsigned char*>(policy.data())),FALSE)
        && SetSecurityDescriptorControl(&descriptor,0x1500,0x1000)
        && IsValidSecurityDescriptor(&descriptor));
}
void creatorAccess(Store& s,HANDLE h,ACCESS_MASK expected) {
    s.sealStep=2; std::array<DWORD,14> basic{}; ULONG length=0;
    const NTSTATUS status=NtQueryObject(h,ObjectBasicInformation,basic.data(),static_cast<ULONG>(sizeof(basic)),&length);
    if(status!=0) s.sealStatus=static_cast<uint32_t>(status);
    need(status==0 && length==sizeof(basic)); s.sealAccess=basic[1]; need(basic[1]==expected);
}
HANDLE open(Store& s, HANDLE parent, const std::wstring& name, bool directory, bool fresh, uint64_t allocation = 0) {
    need(s.frame == nullptr); s.frame = std::make_shared<Frame>(); auto& f = *s.frame; f.name = name;
    f.string.Length = static_cast<USHORT>(name.size()*2); f.string.MaximumLength = f.string.Length; f.string.Buffer = f.name.data();
    f.attributes.Length = sizeof(OBJECT_ATTRIBUTES); f.attributes.RootDirectory = parent; f.attributes.ObjectName = &f.string; f.attributes.Attributes = 0x40;
    if (fresh) {
        securityDescriptor(s,f.security);
        f.attributes.SecurityDescriptor = &f.security; s.effects = true;
    }
    f.allocation.QuadPart = static_cast<LONGLONG>(allocation);
    // The final OWNER_RIGHTS policy removes WRITE_DAC even from creation.
    // Request only the existing creator profile minus that unavailable right.
    const ACCESS_MASK access = fresh ? (directory ? 0x1301a7UL : 0x13019fUL) : 0x1200a1UL;
    s.sealStep=1;
    const NTSTATUS status = NtCreateFile(&f.handle, access, &f.attributes, &f.io, allocation ? &f.allocation : nullptr,
        FILE_ATTRIBUTE_NORMAL, fresh ? 0 : FILE_SHARE_READ, fresh ? 2 : 1, 0x200000 | 0x20 | (directory ? 1 : 0x40), nullptr, 0);
    s.sealStatus=static_cast<uint32_t>(status);
    // No retry, destructor or GC may free an original unknown native frame.
    need(status == 0 && f.io.Status == 0 && f.io.Information == static_cast<ULONG_PTR>(fresh ? 2 : 1) && valid(f.handle));
    const HANDLE result = f.handle;
    // Register the returned creator BEFORE any inspecting native call.
    if (!fresh) s.ancestors.push_back(result);
    else { need(!directory && !valid(s.container)); s.container = result; }
    s.frame.reset(); kind(result, directory);
    if(fresh) { creatorAccess(s,result,access); s.sealStep=3; permissions(s,result); }
    return result;
}
void verifySealed(Store& s,HANDLE h,HANDLE parent,const std::wstring& name,bool directory) {
    const auto id=identity(h); creatorAccess(s,h,directory?0x1301a7UL:0x13019fUL);
    s.sealStep=3; permissions(s,h);
    // Neither a control-only nor a least-right data read may reopen the file.
    // These probes precede private metadata. Unknown original output slots and
    // any unexpectedly returned handle stay retained; no permission is changed.
    const std::array<std::pair<ACCESS_MASK,uint32_t>,2> probes{{
        {READ_CONTROL|WRITE_DAC|SYNCHRONIZE,4}, {FILE_READ_DATA|SYNCHRONIZE,5}}};
    for(const auto& probe:probes) {
        need(s.frame==nullptr);s.frame=std::make_shared<Frame>();auto& f=*s.frame;f.name=name;
        f.string.Length=static_cast<USHORT>(name.size()*2);f.string.MaximumLength=f.string.Length;f.string.Buffer=f.name.data();
        f.attributes.Length=sizeof(OBJECT_ATTRIBUTES);f.attributes.RootDirectory=parent;f.attributes.ObjectName=&f.string;f.attributes.Attributes=0x40;
        s.sealStep=probe.second;
        const NTSTATUS status=NtCreateFile(&f.handle,probe.first,&f.attributes,&f.io,nullptr,
            FILE_ATTRIBUTE_NORMAL,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,1,0x200000|0x20|(directory?1:0x40),nullptr,0);
        if(static_cast<uint32_t>(status)!=0xC0000022U || valid(f.handle)) {s.sealStatus=static_cast<uint32_t>(status);throw Denied{};}
        s.frame.reset();
    }
    s.sealStep=6;need(identity(h)==id);permissions(s,h);
}
void facts(Store& s) {
    kind(s.container, false); FILE_STANDARD_INFO info{};
    need(GetFileInformationByHandleEx(s.container, FileStandardInfo, &info, sizeof(info)) && !info.DeletePending && !info.Directory && info.NumberOfLinks == 1
        && info.EndOfFile.QuadPart == static_cast<LONGLONG>(s.currentLength) && info.AllocationSize.QuadPart >= 0
        && static_cast<uint64_t>(info.AllocationSize.QuadPart) == s.physicalAllocation);
    alignas(8) std::array<unsigned char,4096> stream{};
    need(GetFileInformationByHandleEx(s.container, FileStreamInfo, stream.data(), static_cast<DWORD>(stream.size())));
    need(u32(stream.data()) == 0 && u32(stream.data()+4) == 14 && u64(stream.data()+8) == s.currentLength
         && u64(stream.data()+16) == static_cast<uint64_t>(info.AllocationSize.QuadPart) && std::memcmp(stream.data()+24,L"::$DATA",14) == 0);
    need(identity(s.container) == s.containerIdentity); permissions(s,s.container);
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
uint64_t add(uint64_t a,uint64_t b) { need(a<=safeInteger && b<=safeInteger-a); return a+b; }
uint64_t align8(uint64_t value) { return add(value,7)&~uint64_t{7}; }
template<class T> void put(std::vector<unsigned char>& out,size_t offset,T value) {
    need(offset<=out.size() && sizeof(value)<=out.size()-offset); std::memcpy(out.data()+offset,&value,sizeof(value));
}
std::array<unsigned char,32> hashBytes(const unsigned char* data,size_t length) {
    Hash hash; for(size_t p=0;p<length;p+=chunkBytes) hash.add(data+p,std::min(chunkBytes,length-p)); return hash.finish();
}
void layout(Store& s,std::vector<Row>& rows,uint64_t total) {
    // Explicit little-endian Windows x64 codec; never a serialized C++ struct.
    const uint64_t prefixBytes=256+64*rows.size(); uint64_t cursor=prefixBytes;
    for(auto& row:rows) { row.offset=align8(cursor); cursor=add(row.offset,row.size); }
    const auto footerOffset=align8(cursor), physicalLength=add(footerOffset,256);
    need(physicalLength>=total && physicalLength-total<=s.maximumMetadata);
    std::vector<unsigned char> prefix(static_cast<size_t>(prefixBytes),0);
    for(uint32_t i=0;i<rows.size();++i) {
        const auto& row=rows[i];const size_t at=256+64*static_cast<size_t>(i);
        put(prefix,at,i);put(prefix,at+4,row.group);prefix[at+6]=row.role;prefix[at+7]=row.name;
        put(prefix,at+8,row.offset);put(prefix,at+16,row.size);std::memcpy(prefix.data()+at+24,row.sha.data(),32);
    }
    const auto indexHash=hashBytes(prefix.data()+256,prefix.size()-256);
    std::memcpy(prefix.data(),"ASBTRC01",8);put(prefix,8,uint32_t{1});put(prefix,12,uint32_t{256});
    for(size_t i=0;i<16;++i) prefix[16+i]=static_cast<unsigned char>((nibble(s.publication[2*i])<<4)|nibble(s.publication[2*i+1]));
    std::memcpy(prefix.data()+32,s.scope.data(),32);put(prefix,64,static_cast<uint32_t>(rows.size()));put(prefix,68,uint32_t{64});
    put(prefix,72,prefixBytes-256);put(prefix,80,total);put(prefix,88,footerOffset);put(prefix,96,physicalLength);
    std::memcpy(prefix.data()+104,indexHash.data(),32);
    s.prefix=std::move(prefix);s.payloadBytes=total;s.footerOffset=footerOffset;s.physicalLength=physicalLength;
}
enum class Action { prepare, append, finish, read, discard };
struct Operation {
    napi_env env; napi_deferred deferred = nullptr; napi_async_work work = nullptr;
    std::shared_ptr<Store> store; std::shared_ptr<Reader> reader; Action action;
    uint32_t index = 0, maximum = 0; std::vector<unsigned char> data;
    ULONGLONG started = 0; bool success = false, entered = false;
    void guard(bool allowFence = false) { need(!store->uncertain && !store->closed && (allowFence || !store->fenced) && GetTickCount64()-started < store->maximumMs); }
    void readExact(unsigned char* destination,size_t size) {
        guard(action==Action::read); DWORD count=0; need(size<=chunkBytes && ReadFile(store->container,destination,static_cast<DWORD>(size),&count,nullptr) && count==size);
    }
    void verifyBytes(uint64_t offset,const std::vector<unsigned char>& expected) {
        seek(store->container,offset);std::array<unsigned char,chunkBytes> part{};
        for(size_t p=0;p<expected.size();p+=chunkBytes) {
            const size_t count=std::min(chunkBytes,expected.size()-p);readExact(part.data(),count);
            need(std::memcmp(part.data(),expected.data()+p,count)==0);
        }
    }
    std::array<unsigned char,32> hashRange(uint64_t offset,uint64_t length) {
        seek(store->container,offset);Hash hash;std::array<unsigned char,chunkBytes> part{};
        while(length) {const auto count=static_cast<size_t>(std::min<uint64_t>(length,chunkBytes));readExact(part.data(),count);hash.add(part.data(),count);length-=count;}
        return hash.finish();
    }
    void appendPhysical(const unsigned char* content,size_t size) {
        auto& s=*store;guard();need(size>0 && size<=chunkBytes && add(s.currentLength,size)<=s.physicalLength);facts(s);
        seek(s.container,s.currentLength);guard();write(s.container,content,size);s.currentLength=add(s.currentLength,size);facts(s);
    }
    void padTo(uint64_t offset) {
        auto& s=*store;need(offset>=s.currentLength && offset-s.currentLength<=7 && offset<=s.footerOffset);
        if(offset!=s.currentLength) {std::array<unsigned char,8> zeros{};appendPhysical(zeros.data(),static_cast<size_t>(offset-s.currentLength));}
    }
    std::array<unsigned char,32> verifyPrefix() {
        auto& s=*store;need(s.currentLength==s.footerOffset);seek(s.container,0);Hash all;
        std::array<unsigned char,chunkBytes> part{};uint64_t cursor=0;
        auto observe=[&](uint64_t size,const unsigned char* expected,bool zeros,Hash* rowHash) {
            uint64_t offset=0;
            while(offset<size) {
                const auto count=static_cast<size_t>(std::min<uint64_t>(size-offset,chunkBytes));readExact(part.data(),count);
                if(expected) need(std::memcmp(part.data(),expected+static_cast<size_t>(offset),count)==0);
                if(zeros) need(std::all_of(part.begin(),part.begin()+count,[](unsigned char value){return value==0;}));
                all.add(part.data(),count);if(rowHash)rowHash->add(part.data(),count);offset+=count;cursor=add(cursor,count);
            }
        };
        observe(s.prefix.size(),s.prefix.data(),false,nullptr);
        for(const auto& row:s.rows) {
            need(row.offset>=cursor && row.offset-cursor<=7);observe(row.offset-cursor,nullptr,true,nullptr);
            Hash hash;observe(row.size,nullptr,false,&hash);need(hash.finish()==row.sha);
        }
        need(s.footerOffset>=cursor && s.footerOffset-cursor<=7);observe(s.footerOffset-cursor,nullptr,true,nullptr);
        need(cursor==s.footerOffset);return all.finish();
    }
    void prepare() {
        auto& s=*store;guard();s.stage=1;principal(s);s.stage=2;
        need(GetDriveTypeW(s.parent.substr(0,3).c_str())==DRIVE_FIXED);
        HANDLE parent=open(s,nullptr,L"\\??\\"+s.parent.substr(0,3),true,false);
        wchar_t filesystem[32]{};DWORD flags=0;
        need(GetVolumeInformationByHandleW(parent,nullptr,0,nullptr,nullptr,&flags,filesystem,32) && std::wcscmp(filesystem,L"NTFS")==0 && (flags&FILE_PERSISTENT_ACLS));
        for(size_t start=3;start<s.parent.size();) {
            guard();const auto end=s.parent.find(L'\\',start);parent=open(s,parent,s.parent.substr(start,end==std::wstring::npos?end:end-start),true,false);
            if(end==std::wstring::npos)break;start=end+1;
        }
        s.stage=3;need(s.frame==nullptr);s.frame=std::make_shared<Frame>();auto& query=*s.frame;auto& volume=query.volume;
        need(NtQueryVolumeInformationFile(parent,&query.io,&volume,sizeof(volume),3)==0 && query.io.Status==0 && query.io.Information==sizeof(volume)
            && volume.sectors>=1 && volume.sectors<=65536 && volume.bytes>=512 && volume.bytes<=65536
            && volume.available.QuadPart>=0 && volume.available.QuadPart<=volume.total.QuadPart);
        s.allocationUnit=static_cast<uint64_t>(volume.sectors)*volume.bytes;
        need(s.allocationUnit<=1024*1024 && (s.allocationUnit&(s.allocationUnit-1))==0);
        s.physicalAllocation=add(s.physicalLength,s.allocationUnit-1)/s.allocationUnit*s.allocationUnit;
        need(s.physicalAllocation<=safeInteger && s.physicalAllocation>=s.payloadBytes
            && s.physicalAllocation-s.payloadBytes<=s.maximumMetadata
            && s.physicalAllocation/s.allocationUnit<=static_cast<uint64_t>(volume.available.QuadPart));
        // Observed free space and this preallocation are not the shared quota.
        // A trusted app still needs actual reservation and qualified parent custody.
        s.frame.reset();guard();s.stage=4;open(s,parent,s.publication+L".asbtr",false,true,s.physicalAllocation);
        s.containerIdentity=identity(s.container);s.stage=6;
        verifySealed(s,s.container,s.ancestors.back(),s.publication+L".asbtr",false);
        s.stage=7;facts(s);guard(); // Original grant/identity/default-stream/allocation precede private metadata.
        for(size_t p=0;p<s.prefix.size();p+=chunkBytes) appendPhysical(s.prefix.data()+p,std::min(chunkBytes,s.prefix.size()-p));
        need(FlushFileBuffers(s.container));verifyBytes(0,s.prefix);facts(s);guard();s.prepared=true;s.stage=8;
    }
    void finish() {
        auto& s=*store;auto& row=s.rows[index];guard();s.stage=10;
        need(row.written==row.size && s.currentLength==add(row.offset,row.size) && FlushFileBuffers(s.container));facts(s);
        need(hashRange(row.offset,row.size)==row.sha);facts(s);row.finished=true;s.complete.fetch_add(1);
        if(s.complete!=s.rows.size()) {padTo(s.rows[index+1].offset);return;}
        s.stage=11;padTo(s.footerOffset);const auto contentHash=verifyPrefix();
        std::vector<unsigned char> footer(256,0);std::memcpy(footer.data(),"ASBTRF01",8);
        put(footer,8,uint32_t{1});put(footer,12,uint32_t{256});put(footer,16,s.physicalLength);put(footer,24,static_cast<uint32_t>(s.rows.size()));
        std::memcpy(footer.data()+32,s.prefix.data()+104,32);std::memcpy(footer.data()+64,contentHash.data(),32);
        std::memcpy(footer.data()+96,s.prefix.data()+16,16);std::memcpy(footer.data()+112,s.scope.data(),32);
        appendPhysical(footer.data(),footer.size());need(FlushFileBuffers(s.container));facts(s);
        need(hashRange(0,s.footerOffset)==contentHash);verifyBytes(s.footerOffset,footer);facts(s);
        need(s.currentLength==s.physicalLength);s.footer=std::move(footer);guard();s.finalized=true;
    }
    void discard() {
        auto& s=*store; guard(true); need(s.fenced && s.readers==0 && !s.uncertain && s.frame==nullptr);
        s.stage=13;
        auto remove=[&](HANDLE& h) { if (!valid(h)) return; guard(true); FILE_DISPOSITION_INFO disposition{TRUE}; need(SetFileInformationByHandle(h,FileDispositionInfo,&disposition,sizeof(disposition))); need(CloseHandle(h)); h=INVALID_HANDLE_VALUE; };
        // Only exact original creators from this live episode. No path deletion,
        // old-root adoption, ACL restoration or accounting credit exists here.
        remove(s.container);
        for(auto i=s.ancestors.rbegin();i!=s.ancestors.rend();++i) { guard(true); need(CloseHandle(*i)); *i=INVALID_HANDLE_VALUE; }
        if(valid(s.token)) { need(CloseHandle(s.token)); s.token=INVALID_HANDLE_VALUE; }
        s.closed=true; s.stage=14; std::lock_guard lock(registryMutex); registry.erase(std::remove(registry.begin(),registry.end(),store),registry.end());
    }
    void execute() {
        entered=true;
        try {
            if(action==Action::prepare) prepare();
            else if(action==Action::discard) discard();
            else if(action==Action::append) { guard(); store->stage=9; auto& row=store->rows[index]; need(store->currentLength==add(row.offset,row.written)); appendPhysical(data.data(),data.size()); row.written=add(row.written,data.size()); guard(); }
            else if(action==Action::finish) finish();
            else {
                guard(true); store->stage=12; need(store->finalized); auto& r=store->rows[reader->index]; need(reader->offset<=r.size);facts(*store);seek(store->container,add(r.offset,reader->offset));data.resize(static_cast<size_t>(std::min<uint64_t>(maximum,r.size-reader->offset)));
                if(!data.empty()) { readExact(data.data(),data.size());reader->offset+=data.size(); }
                guard(true);facts(*store);
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
            else {
                owner->uncertain=true; owner->fenced=true; owner->unacknowledged=original;
                // The original async-work data slot cannot be freed while
                // its settlement/deletion outcome is unknown, even after IO.
                owner->unretiredFrame=frame.release();
            }
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
        const auto data=buffer(env,a[1],12,12+48*fileLimit);need(std::memcmp(data.data(),"ASBTRS02",8)==0);const uint32_t count=u32(data.data()+8);
        need(count>0 && count<=s->maximumFiles && data.size()==12+48*count);std::vector<Row> rows;uint64_t total=0;uint16_t group=0;
        std::array<std::array<bool,14>,256> seen{};
        for(uint32_t i=0;i<count;++i) {
            const auto* p=data.data()+12+48*i;Row row;need(u32(p)==i);row.group=u16(p+4);row.role=p[6];row.name=p[7];row.size=u64(p+8);
            need(row.group<256 && (row.group==group || i>0 && row.group==static_cast<uint32_t>(group)+1)
                && (i>0 || row.group==0) && (row.role==1 || row.role==2) && row.name>=1 && row.name<=13
                && !seen[row.group][row.name] && row.size>0 && row.size<=s->maximumFile && row.size<=s->maximumTotal-total);
            seen[row.group][row.name]=true;group=row.group;total=add(total,row.size);std::memcpy(row.sha.data(),p+16,32);rows.push_back(row);
        }
        need(std::all_of(rows.begin(),rows.end(),[&](const Row& row){return row.role==(row.group==group?2:1);}));
        layout(*s,rows,total);auto op=std::make_unique<Operation>();op->env=env;op->store=s;op->action=Action::prepare;s->rows=std::move(rows);return queue(env,std::move(op));
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
    try { auto a=args(env,info,2); auto s=unbox<Store>(env,a[0],storeTag); need(s->env==env && s->prepared && s->finalized && !s->pending && !s->closed && !s->uncertain && s->complete==s->rows.size() && s->readers==0);
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
