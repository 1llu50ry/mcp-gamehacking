// mcp-gamehacking :: ReClass.NET plugin
// ---------------------------------------------------------------
// Build against ReClass.NET's plugin SDK (reference ReClass.NET.exe).
// Drop the resulting ReClassNET-MCP.dll into <ReClass.NET>/Plugins/.
// Exposes HTTP MCP on 127.0.0.1:48762.
//
//   GET  /healthz        -> {"ok":true,"project":"<name>"}
//   POST /tool/classes   {}                                 — list classes
//   POST /tool/nodes     {"class":"<name>"}                  — nodes of one class
//   POST /tool/cpp       {"namespace":"sdk"}                 — emit C++ header
//
// The last two forward through the project's XmlSerializer so we never
// re-implement reading on this side — ReClass.NET itself owns the model.

using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ReClassNET.Core;              // IPluginHost, Project, Node interfaces
using ReClassNET.Plugins;

namespace ReClassNET.MCP
{
    public sealed class MCPBridgePlugin : Plugin
    {
        private const string Host = "127.0.0.1";
        private const int    Port = 48762;

        private HttpListener listener;
        private CancellationTokenSource cts;
        private IPluginHost host;

        public override Image Icon => null; // optional

        public override bool Initialize(IPluginHost host)
        {
            this.host = host;
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                Task.Run(() => AcceptLoop(cts.Token));
                Console.WriteLine($"[mcp-bridge] ReClass.NET MCP on http://{Host}:{Port}");
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[mcp-bridge] FAILED to start: {ex.Message}");
                return false;
            }
        }

        public override void Terminate()
        {
            cts?.Cancel();
            listener?.Stop();
            listener?.Close();
        }

        private async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var ctx = await listener.GetContextAsync();
                    _ = Task.Run(() => Handle(ctx), ct);
                }
                catch { /* shutting down */ }
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
                var err = Encoding.UTF8.GetBytes("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
                ctx.Response.OutputStream.Write(err, 0, err.Length);
            }
            finally { ctx.Response.OutputStream.Close(); }
        }

        private (int, string) Dispatch(string method, string path, string body)
        {
            if (method == "GET" && path == "/healthz")
                return (200, "{\"ok\":true,\"project\":\"" + (host.ActiveProject?.Name ?? "") + "\"}");
            if (method == "POST" && path == "/tool/classes")
                return (200, ListClasses());
            if (method == "POST" && path == "/tool/nodes")
                return (200, ListNodes(body));
            if (method == "POST" && path == "/tool/cpp")
                return (200, EmitCpp(body));
            return (404, "{\"error\":\"unknown path\"}");
        }

        private string ListClasses()
        {
            var project = host.ActiveProject;
            if (project == null) return "{\"classes\":[]}";
            var sb = new StringBuilder("{\"classes\":[");
            bool first = true;
            foreach (var cls in project.Classes)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.AppendFormat("{{\"name\":\"{0}\",\"uuid\":\"{1}\"}}",
                    cls.Name.Replace("\"", "\\\""), cls.Uuid);
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private string ListNodes(string body)
        {
            // Minimal parse: {"class":"..."} — avoid pulling in a JSON lib
            var name = Between(body, "\"class\":\"", "\"");
            var project = host.ActiveProject;
            var cls = project?.Classes.FirstOrDefault(c => c.Name == name);
            if (cls == null) return "{\"error\":\"class not found\"}";
            var sb = new StringBuilder("{\"nodes\":[");
            bool first = true;
            foreach (var n in cls.Nodes)
            {
                if (!first) sb.Append(",");
                first = false;
                sb.AppendFormat("{{\"type\":\"{0}\",\"name\":\"{1}\",\"offset\":{2}}}",
                    n.GetType().Name, n.Name.Replace("\"", "\\\""), n.Offset.ToInt64());
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private string EmitCpp(string body)
        {
            // We just forward raw XML — the TS side has reclass_to_cpp
            // which already does the C++ emission. This endpoint simply
            // serializes the live project to the same XML format ReClass
            // writes to disk.
            var project = host.ActiveProject;
            if (project == null) return "{\"error\":\"no project\"}";
            using var ms = new MemoryStream();
            project.Save(ms); // writes the standard .rcnet XML
            var xml = Encoding.UTF8.GetString(ms.ToArray()).Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n");
            return "{\"xml\":\"" + xml + "\"}";
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
