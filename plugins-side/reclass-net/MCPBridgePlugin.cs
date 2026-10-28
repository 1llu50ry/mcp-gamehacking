// mcp-gamehacking :: ReClass.NET plugin
// ---------------------------------------------------------------
// Build against ReClass.NET's plugin SDK (reference ReClass.NET.exe
// and ReClass.NET.Core.dll). Drop the resulting ReClassNET-MCP.dll
// into <ReClass.NET>/Plugins/.
//
//   GET  /healthz        -> {"ok":true,"project":"<name>","classes":<n>}
//   GET  /ready          -> {"ready":true}
//   POST /tool/classes   {}                            — list classes
//   POST /tool/nodes     {"class":"<name>"}            — nodes of one class
//   POST /tool/xml       {}                            — serialise project to XML
//   POST /tool/pid       {}                            — attached process pid
//   POST /tool/attach    {"process":"<name|pid>"}      — attach to process
//   POST /tool/readmem   {"ea":"0x7FF...","size":256}  — process memory read
//
// CORS enabled; HttpListener runs on a background Task. Exceptions are
// mapped to 500 + {"error": ...}. The ReClass.NET SDK's model is
// single-threaded on the UI thread; we use ReClassNET's Invoke pattern
// via `ReClassForm.Invoke` to run the handler on that thread.

using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;

using ReClassNET;                          // ReClassNET.ReClassNetProject
using ReClassNET.Core;                     // CoreFunctions, memory helpers
using ReClassNET.Memory;                   // RemoteProcess
using ReClassNET.Nodes;                    // ClassNode, BaseNode
using ReClassNET.Plugins;                  // Plugin, IPluginHost

namespace ReClassNET.MCP
{
    public sealed class MCPBridgePlugin : Plugin
    {
        private const string Host = "127.0.0.1";
        private const int    Port = 48762;

        private HttpListener listener;
        private CancellationTokenSource cts;
        private IPluginHost host;

        public override Image Icon => null;

        public override bool Initialize(IPluginHost host)
        {
            this.host = host;
            cts = new CancellationTokenSource();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://{Host}:{Port}/");
            try
            {
                listener.Start();
                _ = Task.Run(() => AcceptLoop(cts.Token));
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
            try { cts?.Cancel(); listener?.Stop(); listener?.Close(); } catch { }
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
            if (method == "GET" && path == "/healthz") return (200, Healthz());
            if (method == "GET" && path == "/ready")   return (200, "{\"ready\":true}");
            if (method != "POST") return (405, "{\"error\":\"method not allowed\"}");

            if (path == "/tool/classes") return (200, ListClasses());
            if (path == "/tool/nodes")   return (200, ListNodes(ParseString(body, "class")));
            if (path == "/tool/xml")     return (200, ExportXml());
            if (path == "/tool/pid")     return (200, ProcessPid());
            if (path == "/tool/attach")  return (200, Attach(ParseString(body, "process")));
            if (path == "/tool/readmem") return (200, ReadMem(ParseString(body, "ea"), ParseLong(body, "size", 256)));
            return (404, "{\"error\":\"unknown path\"}");
        }

        // ----- data helpers (run on UI thread via Invoke) ----------
        private T OnUi<T>(Func<T> fn)
        {
            if (host.MainForm.InvokeRequired)
                return (T)host.MainForm.Invoke(fn);
            return fn();
        }

        private string Healthz()
        {
            return OnUi(() =>
            {
                var proj = host.CurrentProject;
                var count = proj?.Classes?.Count ?? 0;
                var name  = proj?.Path ?? "";
                return $"{{\"ok\":true,\"project\":\"{Json(name)}\",\"classes\":{count}}}";
            });
        }

        private string ListClasses()
        {
            return OnUi(() =>
            {
                var proj = host.CurrentProject;
                if (proj == null) return "{\"classes\":[]}";
                var sb = new StringBuilder("{\"classes\":[");
                bool first = true;
                foreach (var cls in proj.Classes)
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append("{")
                      .Append("\"name\":\"").Append(Json(cls.Name)).Append("\",")
                      .Append("\"uuid\":\"").Append(cls.Uuid.ToString()).Append("\",")
                      .Append("\"size\":").Append(cls.MemorySize)
                      .Append("}");
                }
                sb.Append("]}");
                return sb.ToString();
            });
        }

        private string ListNodes(string className)
        {
            return OnUi(() =>
            {
                var proj = host.CurrentProject;
                var cls = proj?.Classes.FirstOrDefault(c => c.Name == className);
                if (cls == null) return "{\"error\":\"class not found\"}";
                var sb = new StringBuilder("{\"nodes\":[");
                bool first = true;
                foreach (var n in cls.Nodes)
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append("{")
                      .Append("\"type\":\"").Append(Json(n.GetType().Name)).Append("\",")
                      .Append("\"name\":\"").Append(Json(n.Name ?? "")).Append("\",")
                      .Append("\"offset\":").Append(n.Offset.ToInt64()).Append(",")
                      .Append("\"size\":").Append(n.MemorySize)
                      .Append("}");
                }
                sb.Append("]}");
                return sb.ToString();
            });
        }

        private string ExportXml()
        {
            return OnUi(() =>
            {
                var proj = host.CurrentProject;
                if (proj == null) return "{\"error\":\"no project\"}";
                try
                {
                    using var ms = new MemoryStream();
                    proj.Save(ms, host.Logger);
                    var xml = Encoding.UTF8.GetString(ms.ToArray());
                    return "{\"xml\":\"" + Json(xml) + "\"}";
                }
                catch (Exception ex) { return "{\"error\":\"" + Json(ex.Message) + "\"}"; }
            });
        }

        private string ProcessPid()
        {
            return OnUi(() =>
            {
                var proc = host.Process;
                if (proc == null || !proc.IsValid) return "{\"pid\":null}";
                return $"{{\"pid\":{proc.UnderlayingProcess.Id},\"name\":\"{Json(proc.UnderlayingProcess.Name)}\"}}";
            });
        }

        private string Attach(string procName)
        {
            return OnUi(() =>
            {
                try
                {
                    // ReClass.NET exposes an attach dialog but no plain name-based
                    // attach API in all versions. We trigger the attach dialog so
                    // the user confirms, then report back the current process.
                    host.MainForm.AttachToProcessPaused(procName);
                    return ProcessPid();
                }
                catch (Exception ex) { return "{\"error\":\"" + Json(ex.Message) + "\"}"; }
            });
        }

        private string ReadMem(string eaStr, long size)
        {
            return OnUi(() =>
            {
                try
                {
                    var proc = host.Process;
                    if (proc == null || !proc.IsValid) return "{\"error\":\"not attached\"}";
                    var ea = ParseHex(eaStr);
                    var buf = new byte[Math.Max(1, Math.Min(size, 1 << 20))];
                    proc.ReadRemoteMemoryIntoBuffer(new IntPtr((long)ea), buf);
                    var sb = new StringBuilder("{\"hex\":\"");
                    foreach (var b in buf) sb.Append(b.ToString("X2")).Append(' ');
                    sb.Append("\"}");
                    return sb.ToString();
                }
                catch (Exception ex) { return "{\"error\":\"" + Json(ex.Message) + "\"}"; }
            });
        }

        // ----- parse helpers --------------------------------------
        private static string Json(string s) =>
            (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");

        private static string ParseString(string body, string key)
        {
            var m = Regex.Match(body ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }

        private static long ParseLong(string body, string key, long def)
        {
            var m = Regex.Match(body ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
            return m.Success && long.TryParse(m.Groups[1].Value, out var v) ? v : def;
        }

        private static ulong ParseHex(string s)
        {
            s = (s ?? "").Trim();
            if (s.StartsWith("0x") || s.StartsWith("0X")) s = s.Substring(2);
            return ulong.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out var v) ? v : 0UL;
        }
    }
}
