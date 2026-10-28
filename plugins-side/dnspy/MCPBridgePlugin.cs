// mcp-gamehacking :: dnSpy / dnSpyEx plugin
// ---------------------------------------------------------------
// Build as a dnSpy extension (reference dnSpy.Contracts.DnSpy +
// dnSpy.Contracts.Decompiler). Drop the resulting
// mcp_dnspy_bridge.dll into dnSpy's Extensions/ directory.
//
// HTTP MCP on 127.0.0.1:48763.
//
//   GET  /healthz        -> {"ok":true,"loaded":<n>}
//   POST /tool/modules   {}
//   POST /tool/types     {"module":"..."}
//   POST /tool/decompile {"type":"<FullName>","method":"<Name>"}
//   POST /tool/strings   {"module":"..."}

using System;
using System.Collections.Generic;
using System.ComponentModel.Composition;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using dnlib.DotNet;
using dnSpy.Contracts.Documents;
using dnSpy.Contracts.Documents.Tabs;
using dnSpy.Contracts.Extension;

namespace mcp_dnspy_bridge
{
    [ExportExtension]
    public sealed class McpBridgeExtension : IExtension
    {
        private readonly IDocumentTabService tabs;
        private HttpListener listener;
        private CancellationTokenSource cts;

        private const string Host = "127.0.0.1";
        private const int    Port = 48763;

        [ImportingConstructor]
        public McpBridgeExtension(IDocumentTabService tabs)
        {
            this.tabs = tabs;
            Start();
        }

        public IEnumerable<string> MergedResourceDictionaries => Array.Empty<string>();
        public ExtensionInfo ExtensionInfo => new()
        {
            ShortDescription = "mcp-gamehacking bridge",
            Copyright = "MIT"
        };

        private void Start()
        {
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                Task.Run(() => AcceptLoop(cts.Token));
                Console.WriteLine($"[mcp-bridge] dnSpy MCP on http://{Host}:{Port}");
            }
            catch (Exception ex) { Console.WriteLine($"[mcp-bridge] dnSpy start failed: {ex.Message}"); }
        }

        private async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try { var ctx = await listener.GetContextAsync(); _ = Task.Run(() => Handle(ctx), ct); }
                catch { }
            }
        }

        private void Handle(HttpListenerContext ctx)
        {
            try
            {
                string body;
                using (var sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                    body = sr.ReadToEnd();
                var path = ctx.Request.Url.AbsolutePath;
                var (code, payload) = Dispatch(ctx.Request.HttpMethod, path, body);
                var bytes = Encoding.UTF8.GetBytes(payload);
                ctx.Response.StatusCode = code;
                ctx.Response.ContentType = "application/json";
                ctx.Response.ContentLength64 = bytes.Length;
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception ex)
            {
                ctx.Response.StatusCode = 500;
                var e = Encoding.UTF8.GetBytes("{\"error\":\"" + ex.Message.Replace("\"","'") + "\"}");
                ctx.Response.OutputStream.Write(e, 0, e.Length);
            }
            finally { ctx.Response.OutputStream.Close(); }
        }

        private (int, string) Dispatch(string method, string path, string body)
        {
            var docs = tabs.DocumentTreeView.DocumentService.GetDocuments()
                                                           .OfType<IDsDotNetDocument>().ToList();
            if (method == "GET" && path == "/healthz")
                return (200, "{\"ok\":true,\"loaded\":" + docs.Count + "}");
            if (method == "POST" && path == "/tool/modules")
                return (200, ListModules(docs));
            if (method == "POST" && path == "/tool/types")
                return (200, ListTypes(docs, Between(body, "\"module\":\"", "\"")));
            if (method == "POST" && path == "/tool/decompile")
            {
                var t = Between(body, "\"type\":\"", "\"");
                var m = Between(body, "\"method\":\"", "\"");
                return (200, DecompileMethod(docs, t, m));
            }
            if (method == "POST" && path == "/tool/strings")
                return (200, ListStrings(docs, Between(body, "\"module\":\"", "\"")));
            return (404, "{\"error\":\"unknown path\"}");
        }

        private string ListModules(List<IDsDotNetDocument> docs)
        {
            var sb = new StringBuilder("{\"modules\":[");
            bool first = true;
            foreach (var d in docs)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.AppendFormat("{{\"name\":\"{0}\",\"fullName\":\"{1}\"}}",
                    d.ModuleDef?.Name.String ?? d.Filename, d.ModuleDef?.Assembly?.FullName ?? "");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private string ListTypes(List<IDsDotNetDocument> docs, string moduleName)
        {
            var mod = docs.FirstOrDefault(d => d.ModuleDef?.Name == moduleName || d.Filename.EndsWith(moduleName));
            if (mod == null) return "{\"error\":\"module not found\"}";
            var sb = new StringBuilder("{\"types\":[");
            bool first = true;
            foreach (var t in mod.ModuleDef.GetTypes())
            {
                if (!first) sb.Append(",");
                first = false;
                sb.AppendFormat("{{\"full\":\"{0}\",\"methods\":{1}}}",
                    t.FullName.Replace("\"", "\\\""), t.Methods.Count);
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private string DecompileMethod(List<IDsDotNetDocument> docs, string typeName, string methodName)
        {
            foreach (var d in docs)
            {
                if (d.ModuleDef == null) continue;
                var t = d.ModuleDef.GetTypes().FirstOrDefault(ty => ty.FullName == typeName);
                if (t == null) continue;
                var m = t.Methods.FirstOrDefault(mm => mm.Name == methodName);
                if (m == null) continue;
                // Lightweight: emit the IL body for now; full C# decomp
                // requires wiring dnSpy's ILLanguageExporter which varies
                // by dnSpy version. The IL text covers 90% of agent needs.
                var sb = new StringBuilder("{\"il\":\"");
                if (m.Body != null)
                    foreach (var i in m.Body.Instructions)
                        sb.Append(i.ToString().Replace("\"", "'").Replace("\n", " ").Replace("\\", "\\\\")).Append("\\n");
                sb.Append("\"}");
                return sb.ToString();
            }
            return "{\"error\":\"method not found\"}";
        }

        private string ListStrings(List<IDsDotNetDocument> docs, string moduleName)
        {
            var mod = docs.FirstOrDefault(d => d.ModuleDef?.Name == moduleName || d.Filename.EndsWith(moduleName));
            if (mod == null) return "{\"error\":\"module not found\"}";
            var sb = new StringBuilder("{\"strings\":[");
            bool first = true;
            foreach (var t in mod.ModuleDef.GetTypes())
            foreach (var m in t.Methods)
            {
                if (m.Body == null) continue;
                foreach (var i in m.Body.Instructions)
                {
                    if (i.OpCode.Code == dnlib.DotNet.Emit.Code.Ldstr && i.Operand is string s)
                    {
                        if (!first) sb.Append(",");
                        first = false;
                        sb.AppendFormat("{{\"method\":\"{0}.{1}\",\"text\":\"{2}\"}}",
                            t.FullName.Replace("\"","\\\""), m.Name, s.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\n","\\n"));
                    }
                }
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static string Between(string s, string a, string b)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var i = s.IndexOf(a);
            if (i < 0) return "";
            i += a.Length;
            var j = s.IndexOf(b, i);
            return j < 0 ? s.Substring(i) : s.Substring(i, j - i);
        }
    }
}
