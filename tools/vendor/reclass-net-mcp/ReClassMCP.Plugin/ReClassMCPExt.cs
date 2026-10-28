using System;
using System.Drawing;
using System.Threading;
using ReClassNET.Plugins;

namespace ReClassMCP
{
    public class ReClassMCPExt : Plugin
    {
        private IPluginHost host;
        private McpServer server;
        private Thread serverThread;
        private const int DefaultPort = 27015;

        public override Image Icon => null;

        public override bool Initialize(IPluginHost host)
        {
            this.host = host;

            try
            {
                var commandHandler = new CommandHandler(host);
                server = new McpServer(DefaultPort, commandHandler);

                serverThread = new Thread(() => server.Start())
                {
                    IsBackground = true,
                    Name = "ReClassMCP Server"
                };
                serverThread.Start();

                host.Logger.Log(ReClassNET.Logger.LogLevel.Information,
                    $"[ReClassMCP] MCP Server started on port {DefaultPort}");
            }
            catch (Exception ex)
            {
                host.Logger.Log(ex);
                return false;
            }

            return true;
        }

        public override void Terminate()
        {
            try
            {
                server?.Stop();

                if (serverThread != null && serverThread.IsAlive)
                {
                    serverThread.Join(1000);
                }

                host?.Logger.Log(ReClassNET.Logger.LogLevel.Information,
                    "[ReClassMCP] MCP Server stopped");
            }
            catch (Exception ex)
            {
                host?.Logger.Log(ex);
            }
        }
    }
}
