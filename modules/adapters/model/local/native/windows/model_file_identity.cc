// Private read-only Windows mechanism. This is not model ownership/deletion.
// RootDirectory + FILE_OPEN_REPARSE_POINT: Microsoft NtCreateFile documentation.
// READ_CONTROL is required by GetSecurityInfo; no privileges are enabled here.
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <aclapi.h>
#include <fcntl.h>
#include <io.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {
constexpr size_t kMaxFrame = 131200;  // Encoded maximum native UTF16 path.
constexpr size_t kMaxHandles = 64;    // Private inspection profile, not a model quota.
constexpr DWORD kLeaseMilliseconds = 60000;
struct Denied {};
void require(bool value) { if (!value) throw Denied{}; }

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE input = INVALID_HANDLE_VALUE) : value(input) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) {
        require(close()); value = std::exchange(other.value, INVALID_HANDLE_VALUE); return *this;
    }
    bool valid() const { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    bool close() {
        if (!valid()) return true;
        if (!CloseHandle(value)) return false;
        value = INVALID_HANDLE_VALUE;
        return true;
    }
    ~Handle() { close(); }
};

class Watchdog {
    Handle stopped_;
    Handle main_;
    std::thread thread_;
public:
    Watchdog() : stopped_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
        require(stopped_.valid());
        HANDLE duplicate = nullptr;
        require(DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(),
                                &duplicate, THREAD_TERMINATE | SYNCHRONIZE, FALSE, 0) != FALSE);
        main_.value = duplicate;
        thread_ = std::thread([this] {
            const DWORD wait = WaitForSingleObject(stopped_.value, kLeaseMilliseconds);
            if (wait == WAIT_OBJECT_0) return;
            CancelSynchronousIo(main_.value);
            // Cancellation is not completion. A stalled helper may terminate only itself.
            if (WaitForSingleObject(stopped_.value, 2000) != WAIT_OBJECT_0)
                TerminateProcess(GetCurrentProcess(), 9);
        });
    }
    ~Watchdog() { SetEvent(stopped_.value); if (thread_.joinable()) thread_.join(); }
};

class Frames {
    std::string pending_;
    size_t frames_ = 0;
public:
    std::string next() {
        require(++frames_ <= kMaxHandles + 2);
        for (;;) {
            const size_t newline = pending_.find('\n');
            if (newline != std::string::npos) {
                require(newline <= kMaxFrame);
                std::string line = pending_.substr(0, newline);
                pending_.erase(0, newline + 1);
                require(line.find('\r') == std::string::npos && line.find('\0') == std::string::npos);
                return line;
            }
            require(pending_.size() <= kMaxFrame);
            std::array<char, 4096> buffer{};
            DWORD count = 0;
            require(ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer.data(),
                             static_cast<DWORD>(buffer.size()), &count, nullptr) && count > 0);
            pending_.append(buffer.data(), count);
        }
    }
};

std::vector<std::string> fields(const std::string& line) {
    std::vector<std::string> result;
    size_t begin = 0;
    for (;;) {
        const size_t end = line.find('\t', begin);
        result.push_back(line.substr(begin, end == std::string::npos ? end : end - begin));
        require(result.size() <= 7);
        if (end == std::string::npos) return result;
        begin = end + 1;
    }
}

int nibble(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    throw Denied{};
}
std::string hex(const void* data, size_t count) {
    constexpr char digits[] = "0123456789abcdef";
    const auto* bytes = static_cast<const unsigned char*>(data);
    std::string result;
    for (size_t i = 0; i < count; ++i) {
        result.push_back(digits[bytes[i] >> 4]); result.push_back(digits[bytes[i] & 15]);
    }
    return result;
}
std::wstring root_path(const std::string& encoded) {
    require(!encoded.empty() && encoded.size() % 4 == 0 && encoded.size() / 4 <= 32760);
    std::wstring path;
    for (size_t i = 0; i < encoded.size(); i += 4) {
        const int low = nibble(encoded[i]) * 16 + nibble(encoded[i + 1]);
        const int high = nibble(encoded[i + 2]) * 16 + nibble(encoded[i + 3]);
        const wchar_t value = static_cast<wchar_t>(low | (high << 8));
        require(value >= 32 && value != L'/' && value != L'"' && value != L'<' && value != L'>' && value != L'|' && value != L'?' && value != L'*');
        path.push_back(value);
    }
    require(path.size() >= 3 && ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && path[2] == L'\\');
    require(path.find(L':', 2) == std::wstring::npos);
    size_t begin = 3;
    while (begin < path.size()) {
        const size_t end = path.find(L'\\', begin);
        const auto part = path.substr(begin, end == std::wstring::npos ? end : end - begin);
        require(!part.empty() && part.size() <= 255 && part != L"." && part != L".." && part.back() != L'.' && part.back() != L' ');
        if (end == std::wstring::npos) break;
        begin = end + 1;
    }
    return L"\\\\?\\" + path;
}
std::wstring child_name(const std::string& name) {
    require(!name.empty() && name.size() <= 255 && name != "." && name != ".." && name.back() != '.' && name.back() != ' ');
    std::string lower;
    for (char c : name) {
        require((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-');
        lower.push_back(c >= 'A' && c <= 'Z' ? static_cast<char>(c + ('a' - 'A')) : c);
    }
    const auto stem = lower.substr(0, lower.find('.'));
    require(stem != "con" && stem != "prn" && stem != "aux" && stem != "nul" &&
            !(stem.size() == 4 && (stem.substr(0, 3) == "com" || stem.substr(0, 3) == "lpt") && stem[3] >= '1' && stem[3] <= '9'));
    return std::wstring(name.begin(), name.end());
}
size_t index(const std::string& text) {
    require(!text.empty() && text.size() <= 2 && (text.size() == 1 || text[0] != '0'));
    size_t value = 0;
    for (char c : text) { require(c >= '0' && c <= '9'); value = value * 10 + static_cast<size_t>(c - '0'); }
    require(value < kMaxHandles); return value;
}

struct Facts {
    FILE_ID_INFO id{};
    bool directory = false;
    DWORD links = 0;
    bool current_owner = false;
    bool dacl_present = false;
    bool dacl_protected = false;
    WORD ace_count = 0;
    std::vector<unsigned char> owner;
    std::vector<unsigned char> dacl;
};
Facts facts(HANDLE handle, PSID user) {
    require(GetFileType(handle) == FILE_TYPE_DISK);
    Facts result;
    FILE_ATTRIBUTE_TAG_INFO tag{}; FILE_STANDARD_INFO standard{};
    require(GetFileInformationByHandleEx(handle, FileIdInfo, &result.id, sizeof(result.id)) &&
            GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag)) &&
            GetFileInformationByHandleEx(handle, FileStandardInfo, &standard, sizeof(standard)));
    require(!(tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && !standard.DeletePending);
    result.directory = standard.Directory != FALSE; result.links = standard.NumberOfLinks;
    require(result.links > 0 && (result.directory || result.links == 1));
    require(result.id.VolumeSerialNumber != 0 && std::any_of(std::begin(result.id.FileId.Identifier), std::end(result.id.FileId.Identifier), [](BYTE b) { return b != 0; }));
    PSID owner = nullptr; PACL dacl = nullptr; PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                            &owner, nullptr, &dacl, nullptr, &descriptor) == ERROR_SUCCESS);
    struct Local { PSECURITY_DESCRIPTOR value; ~Local() { LocalFree(value); } } allocation{descriptor};
    require(owner && IsValidSid(owner));
    const DWORD length = GetLengthSid(owner); require(length > 0 && length <= SECURITY_MAX_SID_SIZE);
    const auto* bytes = static_cast<const unsigned char*>(owner); result.owner.assign(bytes, bytes + length);
    result.current_owner = EqualSid(owner, user) != FALSE;
    SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision = 0;
    require(GetSecurityDescriptorControl(descriptor, &control, &revision) != FALSE);
    result.dacl_present = dacl != nullptr; result.dacl_protected = (control & SE_DACL_PROTECTED) != 0;
    if (dacl) {
        require(IsValidAcl(dacl) && dacl->AclSize >= sizeof(ACL));
        const auto* acl_bytes = reinterpret_cast<const unsigned char*>(dacl);
        result.dacl.assign(acl_bytes, acl_bytes + dacl->AclSize); result.ace_count = dacl->AceCount;
    }
    return result;
}
bool same(const Facts& a, const Facts& b) {
    return a.id.VolumeSerialNumber == b.id.VolumeSerialNumber &&
        std::memcmp(a.id.FileId.Identifier, b.id.FileId.Identifier, 16) == 0 &&
        a.directory == b.directory && a.links == b.links && a.owner == b.owner &&
        a.dacl == b.dacl && a.dacl_present == b.dacl_present && a.dacl_protected == b.dacl_protected;
}
void expected(const Facts& value, const std::string& volume, const std::string& file) {
    if (volume == "probe" && file == "probe") return; // Read-only fixture/broker discovery, never ownership.
    require(volume.size() == 16 && file.size() == 32 &&
            volume == hex(&value.id.VolumeSerialNumber, 8) && file == hex(value.id.FileId.Identifier, 16));
}
void emit(size_t number, const Facts& value) {
    std::cout << "OPEN\t" << number << '\t' << hex(&value.id.VolumeSerialNumber, 8) << '\t'
        << hex(value.id.FileId.Identifier, 16) << '\t' << (value.directory ? 'D' : 'F') << '\t'
        << value.links << '\t' << value.current_owner << '\t' << value.dacl_present << '\t'
        << value.dacl_protected << '\t' << value.ace_count << std::endl;
}
struct Object {
    Handle handle;
    Facts initial;
    Object(Handle&& input, Facts value) : handle(std::move(input)), initial(std::move(value)) {}
    Object(Object&&) noexcept = default;
    Object(const Object&) = delete;
};

Handle relative_open(HANDLE parent, std::wstring& name, bool directory, ULONG sharing = FILE_SHARE_READ) {
    UNICODE_STRING relative{}; relative.Buffer = name.data();
    relative.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); relative.MaximumLength = relative.Length;
    OBJECT_ATTRIBUTES attributes{}; attributes.Length = sizeof(attributes); attributes.RootDirectory = parent;
    attributes.ObjectName = &relative; attributes.Attributes = OBJ_CASE_INSENSITIVE;
    IO_STATUS_BLOCK status{}; HANDLE raw = INVALID_HANDLE_VALUE;
    // Metadata-only handles do not participate in all Windows sharing checks.
    // Request read-data/list access so denied write/delete sharing is effective.
    const NTSTATUS code = NtCreateFile(&raw, FILE_READ_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE | (directory ? FILE_TRAVERSE : 0),
        &attributes, &status, nullptr, 0, sharing, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT | (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE), nullptr, 0);
    Handle result(raw); require(code >= 0 && result.valid()); return result;
}

int run() {
    std::cout << "aisb-file-id-v1\t" << GetCurrentProcessId() << std::endl;
    Watchdog watchdog;
    HANDLE token_raw = nullptr;
    require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token_raw) != FALSE);
    Handle token(token_raw); DWORD token_bytes = 0;
    GetTokenInformation(token.value, TokenUser, nullptr, 0, &token_bytes);
    require(token_bytes > 0 && token_bytes <= 4096);
    std::vector<unsigned char> user_bytes(token_bytes);
    require(GetTokenInformation(token.value, TokenUser, user_bytes.data(), token_bytes, &token_bytes) != FALSE);
    const PSID user = reinterpret_cast<TOKEN_USER*>(user_bytes.data())->User.Sid;
    require(IsValidSid(user) != FALSE);
    Frames input; std::vector<Object> opened; opened.reserve(kMaxHandles);
    std::vector<Object> ancestors; ancestors.reserve(128);
    auto root = fields(input.next()); require(root.size() == 4 && root[0] == "ROOT");
    const auto path = root_path(root[1]);
    const auto drive = path.substr(0, 7); // Only the drive root uses a pathname.
    Handle root_handle(CreateFileW(drive.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE | FILE_TRAVERSE,
        FILE_SHARE_READ | (path.size() > 7 ? FILE_SHARE_WRITE : 0), nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(root_handle.valid());
    wchar_t filesystem[16]{}; DWORD flags = 0;
    require(GetVolumeInformationByHandleW(root_handle.value, nullptr, 0, nullptr, nullptr, &flags, filesystem, 16) &&
            std::wstring(filesystem) == L"NTFS" && (flags & FILE_PERSISTENT_ACLS));
    auto root_facts = facts(root_handle.value, user); require(root_facts.directory);
    size_t begin = 7;
    while (begin < path.size()) {
        require(ancestors.size() < 128);
        const size_t end = path.find(L'\\', begin);
        auto part = path.substr(begin, end == std::wstring::npos ? end : end - begin);
        const bool terminal = end == std::wstring::npos || end + 1 == path.size();
        auto next = relative_open(root_handle.value, part, true, FILE_SHARE_READ | (terminal ? 0 : FILE_SHARE_WRITE));
        auto next_facts = facts(next.value, user);
        require(next_facts.directory && next_facts.id.VolumeSerialNumber == root_facts.id.VolumeSerialNumber);
        ancestors.emplace_back(std::move(root_handle), std::move(root_facts));
        root_handle = std::move(next);
        root_facts = std::move(next_facts);
        if (terminal) break;
        begin = end + 1;
    }
    expected(root_facts, root[2], root[3]);
    opened.emplace_back(std::move(root_handle), std::move(root_facts)); emit(0, opened[0].initial);
    for (;;) {
        const auto request = fields(input.next());
        if (request.size() == 1 && request[0] == "RELEASE") {
            for (auto& object : opened) require(same(object.initial, facts(object.handle.value, user)));
            for (auto& object : ancestors) require(same(object.initial, facts(object.handle.value, user)));
            bool closed = true;
            for (auto it = opened.rbegin(); it != opened.rend(); ++it) closed = it->handle.close() && closed;
            for (auto it = ancestors.rbegin(); it != ancestors.rend(); ++it) closed = it->handle.close() && closed;
            require(closed); std::cout << "released" << std::endl; return 0;
        }
        require(request.size() == 6 && request[0] == "CHILD" && opened.size() < kMaxHandles);
        const size_t parent = index(request[1]); require(parent < opened.size() && opened[parent].initial.directory);
        const bool directory = request[3] == "D"; require(directory || request[3] == "F");
        auto name = child_name(request[2]);
        auto child = relative_open(opened[parent].handle.value, name, directory);
        auto child_facts = facts(child.value, user);
        require(child_facts.directory == directory && child_facts.id.VolumeSerialNumber == opened[0].initial.id.VolumeSerialNumber);
        expected(child_facts, request[4], request[5]);
        opened.emplace_back(std::move(child), std::move(child_facts)); emit(opened.size() - 1, opened.back().initial);
    }
}
} // namespace

int main() {
    try { require(_setmode(_fileno(stdout), _O_BINARY) != -1); return run(); }
    catch (...) { std::cout << "unavailable" << std::endl; return 2; }
}
