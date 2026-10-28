// mcp-gamehacking :: dnSpy / dnSpyEx extension
// ---------------------------------------------------------------
// Build as a dnSpy extension (net8-windows for dnSpyEx) and drop
// mcp_dnspy_bridge.dll into dnSpy's Extensions/ folder, under its
// own subdirectory with a matching plugin.xml descriptor if your
// dnSpy build requires it.
//
// Starts an HTTP server at 127.0.0.1:48763 (override via
// MCP_DNSPY_PORT env var at process start). Autoload via MEF
// ExportAutoLoaded so no user action is required.
//
//   GET  /healthz       -> {"ok":true,"loaded":N}
//   GET  /ready         -> {"ready":true}
//   POST /tool/modules  {}
//   POST /tool/types    {"module":"<name>"}
//   POST /tool/methods  {"type":"<FullName>"}
//   POST /tool/decompile{"type":"<FullName>","method":"<Name>?"}
//   POST /tool/strings  {"module":"<name>"}
//   POST /tool/il       {"type":"<FullName>","method":"<Name>"}

using System;
using System.ComponentModel.Composition;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnSpy.Contracts.Documents;
using dnSpy.Contracts.Documents.TreeView;
using dnSpy.Contracts.Extension;
using dnSpy.Contracts.Decompiler;

namespace mcp_dnspy_bridge
{
    [ExportAutoLoaded]
    public sealed class McpBridgeAutoLoader : IAutoLoaded
    {
        private const string Host = "127.0.0.1";
        private static readonly int Port = int.TryParse(
            Environment.GetEnvironmentVariable("MCP_DNSPY_PORT"), out var p) ? p : 48763;

        private readonly IDocumentTreeView treeView;
        private readonly IDecompilerService decompilers;
        private HttpListener listener;
        private CancellationTokenSource cts;

        [ImportingConstructor]
        public McpBridgeAutoLoader(IDocumentTreeView treeView, IDecompilerService decompilers)
        {
            this.treeView = treeView;
            this.decompilers = decompilers;
            Start();
        }

        private void Start()
        {
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                _ = Task.Run(() => AcceptLoop(cts.Token));
                Console.WriteLine($"[mcp-bridge] dnSpy MCP on http://{Host}:{Port}");
            }
            catch (Exception ex) { Console.WriteLine($"[mcp-bridge] dnSpy failed: {ex.Message}"); }
        }

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
            var docs = treeView.DocumentService.GetDocuments()
                                               .OfType<IDsDotNetDocument>()
                                               .Where(d => d.ModuleDef != null)
                                               .ToList();
            if (method == "GET" && path == "/healthz")
                return (200, "{\"ok\":true,\"loaded\":" + docs.Count + "}");
            if (method == "GET" && path == "/ready")
                return (200, "{\"ready\":true,\"loaded\":" + docs.Count + "}");
            if (method != "POST") return (405, "{\"error\":\"method not allowed\"}");

            if (path == "/tool/modules")   return (200, ListModules(docs));
            if (path == "/tool/types")     return (200, ListTypes(docs, ParseString(body, "module")));
            if (path == "/tool/methods")   return (200, ListMethods(docs, ParseString(body, "type")));
            if (path == "/tool/decompile") return (200, Decompile(docs, ParseString(body, "type"), ParseString(body, "method")));
            if (path == "/tool/il")        return (200, EmitIl(docs, ParseString(body, "type"), ParseString(body, "method")));
            if (path == "/tool/strings")   return (200, ListStrings(docs, ParseString(body, "module")));
            return (404, "{\"error\":\"unknown path\"}");
        }

        // ----- data ------------------------------------------------
        private static string ListModules(System.Collections.Generic.List<IDsDotNetDocument> docs)
        {
            var sb = new StringBuilder("{\"modules\":[");
            bool first = true;
            foreach (var d in docs)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{")
                  .Append("\"name\":\"").Append(Json(d.ModuleDef.Name)).Append("\",")
                  .Append("\"fullName\":\"").Append(Json(d.ModuleDef.Assembly?.FullName ?? "")).Append("\",")
                  .Append("\"path\":\"").Append(Json(d.Filename ?? "")).Append("\"")
                  .Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static ModuleDef FindModule(System.Collections.Generic.List<IDsDotNetDocument> docs, string name)
        {
            if (string.IsNullOrEmpty(name)) return docs.FirstOrDefault()?.ModuleDef;
            var d = docs.FirstOrDefault(x =>
                x.ModuleDef.Name == name ||
                (x.Filename != null && x.Filename.EndsWith(name, StringComparison.OrdinalIgnoreCase)));
            return d?.ModuleDef;
        }

        private static TypeDef FindType(System.Collections.Generic.List<IDsDotNetDocument> docs, string full)
        {
            foreach (var d in docs)
            {
                var t = d.ModuleDef.GetTypes().FirstOrDefault(ty => ty.FullName == full);
                if (t != null) return t;
            }
            return null;
        }

        private static string ListTypes(System.Collections.Generic.List<IDsDotNetDocument> docs, string moduleName)
        {
            var m = FindModule(docs, moduleName);
            if (m == null) return "{\"error\":\"module not found\"}";
            var sb = new StringBuilder("{\"types\":[");
            bool first = true;
            foreach (var t in m.GetTypes())
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{")
                  .Append("\"full\":\"").Append(Json(t.FullName)).Append("\",")
                  .Append("\"methods\":").Append(t.Methods.Count).Append(",")
                  .Append("\"isNested\":").Append(t.IsNested.ToString().ToLowerInvariant())
                  .Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static string ListMethods(System.Collections.Generic.List<IDsDotNetDocument> docs, string typeName)
        {
            var t = FindType(docs, typeName);
            if (t == null) return "{\"error\":\"type not found\"}";
            var sb = new StringBuilder("{\"methods\":[");
            bool first = true;
            foreach (var m in t.Methods)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{\"name\":\"").Append(Json(m.Name)).Append("\",")
                  .Append("\"signature\":\"").Append(Json(m.FullName)).Append("\",")
                  .Append("\"ilInstructions\":").Append(m.Body?.Instructions?.Count ?? 0)
                  .Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private string Decompile(System.Collections.Generic.List<IDsDotNetDocument> docs, string typeName, string methodName)
        {
            var t = FindType(docs, typeName);
            if (t == null) return "{\"error\":\"type not found\"}";
            var dec = decompilers.AllDecompilers.FirstOrDefault(d => d.GenericNameUI == "C#") ?? decompilers.AllDecompilers.First();
            using var ms = new MemoryStream();
            using var writer = new StreamWriter(ms, Encoding.UTF8);
            var output = new PlainTextOutput(writer);
            try
            {
                if (string.IsNullOrEmpty(methodName))
                    dec.Decompile(t, output, new DecompilationContext { CancellationToken = CancellationToken.None });
                else
                {
                    var method = t.Methods.FirstOrDefault(m => m.Name == methodName);
                    if (method == null) return "{\"error\":\"method not found\"}";
                    dec.Decompile(method, output, new DecompilationContext { CancellationToken = CancellationToken.None });
                }
                writer.Flush();
                var src = Encoding.UTF8.GetString(ms.ToArray());
                return "{\"c#\":\"" + Json(src) + "\"}";
            }
            catch (Exception ex) { return "{\"error\":\"" + Json(ex.Message) + "\"}"; }
        }

        private static string EmitIl(System.Collections.Generic.List<IDsDotNetDocument> docs, string typeName, string methodName)
        {
            var t = FindType(docs, typeName);
            if (t == null) return "{\"error\":\"type not found\"}";
            var m = t.Methods.FirstOrDefault(mm => mm.Name == methodName);
            if (m == null) return "{\"error\":\"method not found\"}";
            if (m.Body == null) return "{\"il\":\"\"}";
            var sb = new StringBuilder("{\"il\":\"");
            foreach (var ins in m.Body.Instructions)
            {
                sb.Append(Json(ins.ToString())).Append("\\n");
            }
            sb.Append("\"}");
            return sb.ToString();
        }

        private static string ListStrings(System.Collections.Generic.List<IDsDotNetDocument> docs, string moduleName)
        {
            var m = FindModule(docs, moduleName);
            if (m == null) return "{\"error\":\"module not found\"}";
            var sb = new StringBuilder("{\"strings\":[");
            bool first = true;
            foreach (var t in m.GetTypes())
            foreach (var method in t.Methods)
            {
                if (method.Body == null) continue;
                foreach (var ins in method.Body.Instructions)
                {
                    if (ins.OpCode.Code == Code.Ldstr && ins.Operand is string s)
                    {
                        if (!first) sb.Append(",");
                        first = false;
                        sb.Append("{")
                          .Append("\"method\":\"").Append(Json(t.FullName + "." + method.Name)).Append("\",")
                          .Append("\"text\":\"").Append(Json(s)).Append("\"")
                          .Append("}");
                    }
                }
            }
            sb.Append("]}");
            return sb.ToString();
        }

        // ----- parse helpers ---------------------------------------
        private static string Json(string s) =>
            (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");

        private static string ParseString(string body, string key)
        {
            var m = Regex.Match(body ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }
    }
}
