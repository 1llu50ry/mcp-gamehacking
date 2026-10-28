// mcp-gamehacking :: ILSpy plugin
// ---------------------------------------------------------------
// Build against ICSharpCode.Decompiler + ILSpy.ILSpyX (ILSpy 9+)
// OR MainWindow (ILSpy 8). The MEF export is the same; the type the
// plugin consumes differs across versions, so we check both at runtime.
//
// Drop built DLL into ILSpy's addins directory (same folder as ILSpy.exe
// is fine; MEF discovers plugins there).
//
// Starts an HTTP server at 127.0.0.1:48764 (override via MCP_ILSPY_PORT).
//
//   GET  /healthz        -> {"ok":true,"loaded":N}
//   GET  /ready          -> {"ready":true}
//   POST /tool/assemblies{}
//   POST /tool/types     {"assembly":"<ShortName>"}
//   POST /tool/decompile {"type":"<FullName>"}
//   POST /tool/method    {"type":"<FullName>","method":"<Name>"}

using System;
using System.ComponentModel.Composition;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;
using ICSharpCode.ILSpy;

namespace mcp_ilspy_bridge
{
    [Export(typeof(IPlugin))]
    public sealed class McpBridgePlugin : IPlugin
    {
        private const string Host = "127.0.0.1";
        private static readonly int Port = int.TryParse(
            Environment.GetEnvironmentVariable("MCP_ILSPY_PORT"), out var p) ? p : 48764;

        private HttpListener listener;
        private CancellationTokenSource cts;

        public void OnLoaded(SessionSettings settings = null)
        {
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                _ = Task.Run(() => AcceptLoop(cts.Token));
                Console.WriteLine($"[mcp-bridge] ILSpy MCP on http://{Host}:{Port}");
            }
            catch (Exception ex) { Console.WriteLine($"[mcp-bridge] ILSpy failed: {ex.Message}"); }
        }

        public void OnUnload() { try { cts?.Cancel(); listener?.Stop(); listener?.Close(); } catch { } }

        private async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var ctx = await listener.GetContextAsync().ConfigureAwait(false);
                    _ = Task.Run(() => Handle(ctx), ct);
                }
                catch { /* shutdown */ }
            }
        }

        private void Handle(HttpListenerContext ctx)
        {
            try
            {
                string body;
                using (var sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                    body = sr.ReadToEnd();
                var (code, payload) = Dispatch(ctx.Request.HttpMethod, ctx.Request.Url.AbsolutePath, body);
                WriteJson(ctx, code, payload);
            }
            catch (Exception ex)
            {
                WriteJson(ctx, 500, "{\"error\":\"" + Json(ex.Message) + "\"}");
            }
        }

        private static void WriteJson(HttpListenerContext ctx, int code, string payload)
        {
            var bytes = Encoding.UTF8.GetBytes(payload);
            ctx.Response.StatusCode = code;
            ctx.Response.ContentType = "application/json";
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.Headers["access-control-allow-origin"] = "*";
            ctx.Response.Headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
            ctx.Response.Headers["access-control-allow-headers"] = "content-type";
            try { ctx.Response.OutputStream.Write(bytes, 0, bytes.Length); }
            finally { ctx.Response.OutputStream.Close(); }
        }

        private (int, string) Dispatch(string method, string path, string body)
        {
            if (method == "OPTIONS") return (204, "{}");
            var assemblies = TryGetAssemblies();
            if (method == "GET" && path == "/healthz")
                return (200, "{\"ok\":true,\"loaded\":" + assemblies.Count + "}");
            if (method == "GET" && path == "/ready")
                return (200, "{\"ready\":true}");
            if (method != "POST") return (405, "{\"error\":\"method not allowed\"}");

            if (path == "/tool/assemblies") return (200, ListAssemblies(assemblies));
            if (path == "/tool/types")     return (200, ListTypes(assemblies, ParseString(body, "assembly")));
            if (path == "/tool/decompile") return (200, Decompile(assemblies, ParseString(body, "type")));
            if (path == "/tool/method")    return (200, DecompileMethod(assemblies, ParseString(body, "type"), ParseString(body, "method")));
            return (404, "{\"error\":\"unknown path\"}");
        }

        // ILSpy's loaded-assemblies accessor has moved between versions.
        // Try the modern path first (CurrentAssemblyList → GetAssemblies())
        // via reflection so this compiles against any version with ILSpy
        // in the reference closure.
        private static System.Collections.Generic.List<LoadedAssembly> TryGetAssemblies()
        {
            try
            {
                var mw = MainWindow.Instance;
                if (mw == null) return new System.Collections.Generic.List<LoadedAssembly>();
                var listProp = mw.GetType().GetProperty("CurrentAssemblyList", BindingFlags.Public | BindingFlags.Instance | BindingFlags.NonPublic);
                var list = listProp?.GetValue(mw);
                if (list == null) return new System.Collections.Generic.List<LoadedAssembly>();
                var getAssemblies = list.GetType().GetMethod("GetAssemblies", BindingFlags.Public | BindingFlags.Instance);
                var arr = (System.Collections.IEnumerable)getAssemblies?.Invoke(list, null);
                if (arr == null) return new System.Collections.Generic.List<LoadedAssembly>();
                return arr.Cast<LoadedAssembly>().ToList();
            }
            catch { return new System.Collections.Generic.List<LoadedAssembly>(); }
        }

        private static PEFile GetPEFile(LoadedAssembly a)
        {
            // Older: GetPEFileOrNull(). Newer: GetMetadataFileAsync().Result as PEFile.
            try
            {
                var m = a.GetType().GetMethod("GetPEFileOrNull", BindingFlags.Public | BindingFlags.Instance);
                if (m != null) return (PEFile)m.Invoke(a, null);
            }
            catch { }
            try
            {
                var m = a.GetType().GetMethod("GetMetadataFileAsync", BindingFlags.Public | BindingFlags.Instance);
                if (m != null)
                {
                    var t = (Task)m.Invoke(a, null);
                    t.GetAwaiter().GetResult();
                    var res = t.GetType().GetProperty("Result")?.GetValue(t);
                    return res as PEFile;
                }
            }
            catch { }
            return null;
        }

        private static string ListAssemblies(System.Collections.Generic.List<LoadedAssembly> assemblies)
        {
            var sb = new StringBuilder("{\"assemblies\":[");
            bool first = true;
            foreach (var a in assemblies)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{")
                  .Append("\"name\":\"").Append(Json(a.ShortName ?? "")).Append("\",")
                  .Append("\"path\":\"").Append(Json(a.FileName ?? "")).Append("\"")
                  .Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static string ListTypes(System.Collections.Generic.List<LoadedAssembly> assemblies, string name)
        {
            var a = string.IsNullOrEmpty(name)
                ? assemblies.FirstOrDefault()
                : assemblies.FirstOrDefault(x => x.ShortName == name);
            if (a == null) return "{\"error\":\"assembly not found\"}";
            var pe = GetPEFile(a);
            if (pe == null) return "{\"error\":\"no PE\"}";
            var md = pe.Metadata;
            var sb = new StringBuilder("{\"types\":[");
            bool first = true;
            foreach (var th in md.TypeDefinitions)
            {
                var td = md.GetTypeDefinition(th);
                var full = md.GetString(td.Namespace);
                if (!string.IsNullOrEmpty(full)) full += ".";
                full += md.GetString(td.Name);
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{\"full\":\"").Append(Json(full)).Append("\"}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static string Decompile(System.Collections.Generic.List<LoadedAssembly> assemblies, string full)
        {
            foreach (var a in assemblies)
            {
                var pe = GetPEFile(a); if (pe == null) continue;
                try
                {
                    var dec = new CSharpDecompiler(pe, new DecompilerSettings { ShowXmlDocumentation = false });
                    var src = dec.DecompileTypeAsString(new FullTypeName(full));
                    return "{\"c#\":\"" + Json(src) + "\"}";
                }
                catch { /* try next */ }
            }
            return "{\"error\":\"type not found\"}";
        }

        private static string DecompileMethod(System.Collections.Generic.List<LoadedAssembly> assemblies, string typeFull, string methodName)
        {
            foreach (var a in assemblies)
            {
                var pe = GetPEFile(a); if (pe == null) continue;
                try
                {
                    var dec = new CSharpDecompiler(pe, new DecompilerSettings { ShowXmlDocumentation = false });
                    var ts  = dec.TypeSystem;
                    var tdef = ts.MainModule.TypeDefinitions.FirstOrDefault(x => x.FullName == typeFull);
                    if (tdef == null) continue;
                    var mdef = tdef.Methods.FirstOrDefault(x => x.Name == methodName);
                    if (mdef == null) return "{\"error\":\"method not found\"}";
                    var src = dec.DecompileAsString(mdef.MetadataToken);
                    return "{\"c#\":\"" + Json(src) + "\"}";
                }
                catch { }
            }
            return "{\"error\":\"not found\"}";
        }

        private static string Json(string s) =>
            (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");

        private static string ParseString(string body, string key)
        {
            var m = Regex.Match(body ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }
    }
}
