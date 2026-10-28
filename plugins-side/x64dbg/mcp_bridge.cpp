// mcp-gamehacking :: x64dbg plugin
// ---------------------------------------------------------------
// Build as a standard x64dbg plugin (link against pluginsdk/x64dbg.lib
// and x64bridge.lib). Drop mcp_bridge.dp64 into x64dbg/x64/plugins/
// (and .dp32 under x32/).
//
// Exposes HTTP MCP on 127.0.0.1:48765. Minimal socket server using
// winsock2 — no boost / asio deps.
//
//   GET  /healthz        -> {"ok":true,"state":"paused|running|notarget"}
//   POST /tool/state     {}
//   POST /tool/bp        {"ea":"0x401000","op":"set|clear"}
//   POST /tool/readmem   {"ea":"0x401000","size":256}
//   POST /tool/writemem  {"ea":"0x401000","bytes":"90 90 90 90"}
//   POST /tool/registers {}
//   POST /tool/step      {"mode":"into|over|out"}
//   POST /tool/cmd       {"line":"<x64dbg script line>"}

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <string>
#include <sstream>
#include <thread>
#include <atomic>
#include "pluginsdk/_plugins.h"
#include "pluginsdk/_dbgfunctions.h"
#include "pluginsdk/bridgemain.h"

#pragma comment(lib, "ws2_32.lib")

#define MCP_HOST "127.0.0.1"
#define MCP_PORT 48765

static std::atomic<bool> g_running{true};
static int               g_plugin_handle = 0;

static std::string between(const std::string& s, const std::string& a, const std::string& b) {
    auto i = s.find(a); if (i == std::string::npos) return "";
    i += a.size();
    auto j = s.find(b, i);
    return j == std::string::npos ? s.substr(i) : s.substr(i, j - i);
}

static std::string json_state() {
    if (!DbgIsDebugging())          return R"({"state":"notarget"})";
    if (DbgIsRunning())             return R"({"state":"running"})";
    return R"({"state":"paused"})";
}

static std::string json_registers() {
    REGDUMP r{};
    DbgGetRegDumpEx(&r, sizeof(r));
    std::ostringstream s;
    s << R"({"rax":")" << std::hex << r.regcontext.cax
      << R"(","rbx":")" << r.regcontext.cbx
      << R"(","rcx":")" << r.regcontext.ccx
      << R"(","rdx":")" << r.regcontext.cdx
      << R"(","rsi":")" << r.regcontext.csi
      << R"(","rdi":")" << r.regcontext.cdi
      << R"(","rbp":")" << r.regcontext.cbp
      << R"(","rsp":")" << r.regcontext.csp
      << R"(","rip":")" << r.regcontext.cip
      << R"("})";
    return s.str();
}

static std::string json_readmem(duint ea, duint size) {
    if (size == 0 || size > 0x100000) size = 0x100;
    std::vector<unsigned char> buf(size);
    if (!DbgMemRead(ea, buf.data(), size)) return R"({"error":"read failed"})";
    std::ostringstream s;
    s << R"({"hex":")";
    static const char hex[] = "0123456789ABCDEF";
    for (auto b : buf) { s << hex[b >> 4] << hex[b & 0xf] << " "; }
    s << R"("})";
    return s.str();
}

static std::string json_writemem(duint ea, const std::string& bytes) {
    std::vector<unsigned char> raw;
    for (size_t i = 0; i + 1 < bytes.size(); i += 3) {
        auto hi = bytes[i], lo = bytes[i + 1];
        auto to4 = [](char c) { return (c <= '9') ? c - '0' : (c & 0xDF) - 'A' + 10; };
        raw.push_back((unsigned char)((to4(hi) << 4) | to4(lo)));
    }
    bool ok = DbgMemWrite(ea, raw.data(), raw.size());
    std::ostringstream s;
    s << R"({"wrote":)" << raw.size() << R"(,"ok":)" << (ok ? "true" : "false") << "}";
    return s.str();
}

static std::string dispatch(const std::string& method, const std::string& path, const std::string& body) {
    if (method == "GET" && path == "/healthz") {
        return R"({"ok":true,)" + json_state().substr(1);  // merge
    }
    if (path == "/tool/state") return R"({"state":")" + json_state().substr(10,8) + R"("})";
    if (path == "/tool/registers") return json_registers();
    if (path == "/tool/bp") {
        auto ea_s = between(body, "\"ea\":\"", "\"");
        auto op   = between(body, "\"op\":\"", "\"");
        duint ea = (duint)strtoull(ea_s.c_str(), nullptr, 0);
        char cmd[64];
        snprintf(cmd, sizeof(cmd), "%s 0x%llx", op == "clear" ? "bc" : "bp", (unsigned long long)ea);
        DbgCmdExec(cmd);
        return R"({"ok":true})";
    }
    if (path == "/tool/readmem") {
        auto ea_s   = between(body, "\"ea\":\"", "\"");
        auto size_s = between(body, "\"size\":", ",");
        if (size_s.empty()) size_s = between(body, "\"size\":", "}");
        duint ea = (duint)strtoull(ea_s.c_str(), nullptr, 0);
        duint sz = (duint)strtoull(size_s.c_str(), nullptr, 10);
        return json_readmem(ea, sz);
    }
    if (path == "/tool/writemem") {
        auto ea_s = between(body, "\"ea\":\"", "\"");
        auto hex  = between(body, "\"bytes\":\"", "\"");
        duint ea = (duint)strtoull(ea_s.c_str(), nullptr, 0);
        return json_writemem(ea, hex);
    }
    if (path == "/tool/step") {
        auto mode = between(body, "\"mode\":\"", "\"");
        if (mode == "into") DbgCmdExec("sti");
        else if (mode == "out") DbgCmdExec("rtr");
        else DbgCmdExec("sto");
        return R"({"ok":true})";
    }
    if (path == "/tool/cmd") {
        auto line = between(body, "\"line\":\"", "\"");
        DbgCmdExec(line.c_str());
        return R"({"ok":true})";
    }
    return R"({"error":"unknown path"})";
}

static void handle_client(SOCKET s) {
    char buf[4096];
    int n = recv(s, buf, sizeof(buf) - 1, 0);
    if (n <= 0) { closesocket(s); return; }
    buf[n] = 0;
    std::string req(buf);
    auto end_of_line = req.find("\r\n");
    std::string first = req.substr(0, end_of_line);
    std::istringstream iss(first);
    std::string method, path, ver;
    iss >> method >> path >> ver;
    auto hdr_end = req.find("\r\n\r\n");
    std::string body = (hdr_end != std::string::npos) ? req.substr(hdr_end + 4) : "";
    std::string payload = dispatch(method, path, body);
    std::ostringstream resp;
    resp << "HTTP/1.1 200 OK\r\n"
         << "content-type: application/json\r\n"
         << "content-length: " << payload.size() << "\r\n"
         << "connection: close\r\n\r\n" << payload;
    auto s2 = resp.str();
    send(s, s2.c_str(), (int)s2.size(), 0);
    closesocket(s);
}

static void server_loop() {
    WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
    SOCKET srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(MCP_PORT);
    inet_pton(AF_INET, MCP_HOST, &a.sin_addr);
    bind(srv, (sockaddr*)&a, sizeof(a));
    listen(srv, 8);
    _plugin_logprintf("[mcp-bridge] x64dbg MCP on http://" MCP_HOST ":48765\n");
    while (g_running) {
        SOCKET c = accept(srv, nullptr, nullptr);
        if (c == INVALID_SOCKET) break;
        std::thread(handle_client, c).detach();
    }
    closesocket(srv);
    WSACleanup();
}

extern "C" __declspec(dllexport) bool pluginit(PLUG_INITSTRUCT* initStruct) {
    initStruct->pluginVersion = 1;
    initStruct->sdkVersion    = PLUG_SDKVERSION;
    strncpy_s(initStruct->pluginName, "mcp-bridge", _TRUNCATE);
    g_plugin_handle = initStruct->pluginHandle;
    std::thread(server_loop).detach();
    return true;
}

extern "C" __declspec(dllexport) bool plugstop() {
    g_running = false;
    return true;
}

extern "C" __declspec(dllexport) void plugsetup(PLUG_SETUPSTRUCT*) {}
