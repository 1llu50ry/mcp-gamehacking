// mcp-gamehacking :: ILSpy plugin
// ---------------------------------------------------------------
// ILSpy addin that boots an HTTP server on 127.0.0.1:48764 when
// ILSpy launches. Reference ICSharpCode.Decompiler + ILSpyCommon.
//
//   GET  /healthz                 -> {"ok":true}
//   POST /tool/assemblies         {}
//   POST /tool/types              {"assembly":"..."}
//   POST /tool/decompile          {"type":"<FullName>"}
//   POST /tool/method             {"type":"<FullName>","method":"..."}

using System;
using System.ComponentModel.Composition;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.ILSpy;

namespace mcp_ilspy_bridge
{
    [Export(typeof(IPlugin))]
    public sealed class McpBridgePlugin : IPlugin
    {
        private HttpListener listener;
        private CancellationTokenSource cts;
        private const string Host = "127.0.0.1";
        private const int    Port = 48764;

        public void OnLoaded()
        {
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                Task.Run(() => AcceptLoop(cts.Token));
                Console.WriteLine($"[mcp-bridge] ILSpy MCP on http://{Host}:{Port}");
            }
            catch (Exception ex) { Console.WriteLine($"[mcp-bridge] ILSpy start failed: {ex.Message}"); }
        }

        public void OnUnload()
        {
            cts?.Cancel();
            listener?.Stop();
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
            var assemblies = MainWindow.Instance.CurrentAssemblyList.GetAssemblies().ToList();
            if (method == "GET" && path == "/healthz")
                return (200, "{\"ok\":true,\"loaded\":" + assemblies.Count + "}");
            if (method == "POST" && path == "/tool/assemblies")
            {
                var sb = new StringBuilder("{\"assemblies\":[");
                bool first = true;
                foreach (var a in assemblies)
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.AppendFormat("{{\"name\":\"{0}\",\"path\":\"{1}\"}}",
                        a.ShortName.Replace("\"","\\\""), a.FileName.Replace("\\","\\\\"));
                }
                sb.Append("]}");
                return (200, sb.ToString());
            }
            if (method == "POST" && path == "/tool/types")
            {
                var name = Between(body, "\"assembly\":\"", "\"");
                var a = assemblies.FirstOrDefault(x => x.ShortName == name);
                if (a == null || a.GetPEFileOrNull() == null) return (400, "{\"error\":\"assembly not found\"}");
                var md = a.GetPEFileOrNull().Metadata;
                var sb = new StringBuilder("{\"types\":[");
                bool first = true;
                foreach (var th in md.TypeDefinitions)
                {
                    var td = md.GetTypeDefinition(th);
                    var full = md.GetString(td.Namespace) + "." + md.GetString(td.Name);
                    if (!first) sb.Append(",");
                    first = false;
                    sb.AppendFormat("{{\"full\":\"{0}\"}}", full.Replace("\"","\\\""));
                }
                sb.Append("]}");
                return (200, sb.ToString());
            }
            if (method == "POST" && path == "/tool/decompile")
            {
                var full = Between(body, "\"type\":\"", "\"");
                foreach (var a in assemblies)
                {
                    var pe = a.GetPEFileOrNull(); if (pe == null) continue;
                    var dec = new CSharpDecompiler(pe, new DecompilerSettings { ShowXmlDocumentation = false });
                    try
                    {
                        var src = dec.DecompileTypeAsString(new FullTypeName(full));
                        var esc = src.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\n","\\n");
                        return (200, "{\"c#\":\"" + esc + "\"}");
                    }
                    catch { /* try next assembly */ }
                }
                return (404, "{\"error\":\"type not found\"}");
            }
            return (404, "{\"error\":\"unknown path\"}");
        }

        private static string Between(string s, string a, string b)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var i = s.IndexOf(a); if (i < 0) return "";
            i += a.Length;
            var j = s.IndexOf(b, i);
            return j < 0 ? s.Substring(i) : s.Substring(i, j - i);
        }
    }
}
