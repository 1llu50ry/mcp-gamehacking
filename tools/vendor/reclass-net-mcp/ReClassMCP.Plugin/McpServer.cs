using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ReClassMCP
{
    public class McpServer
    {
        private readonly int port;
        private readonly CommandHandler commandHandler;
        private TcpListener listener;
        private volatile bool isRunning;

        public McpServer(int port, CommandHandler commandHandler)
        {
            this.port = port;
            this.commandHandler = commandHandler;
        }

        public void Start()
        {
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                isRunning = true;

                while (isRunning)
                {
                    try
                    {
                        if (listener.Pending())
                        {
                            var client = listener.AcceptTcpClient();
                            var clientThread = new Thread(() => HandleClient(client))
                            {
                                IsBackground = true,
                                Name = "ReClassMCP Client Handler"
                            };
                            clientThread.Start();
                        }
                        else
                        {
                            Thread.Sleep(100);
                        }
                    }
                    catch (SocketException) when (!isRunning)
                    {
                        break;
                    }
                }
            }
            catch (Exception)
            {
                // Server shutdown
            }
        }

        public void Stop()
        {
            isRunning = false;
            listener?.Stop();
        }

        private void HandleClient(TcpClient client)
        {
            try
            {
                var utf8NoBom = new UTF8Encoding(false);
                using (client)
                using (var stream = client.GetStream())
                using (var reader = new StreamReader(stream, utf8NoBom))
                using (var writer = new StreamWriter(stream, utf8NoBom) { AutoFlush = true })
                {
                    client.ReceiveTimeout = 30000;
                    client.SendTimeout = 30000;

                    while (isRunning && client.Connected)
                    {
                        try
                        {
                            var line = reader.ReadLine();
                            if (line == null)
                                break;

                            if (string.IsNullOrWhiteSpace(line))
                                continue;

                            var response = ProcessRequest(line);
                            writer.WriteLine(response);
                        }
                        catch (IOException)
                        {
                            break;
                        }
                        catch (Exception ex)
                        {
                            var errorResponse = new JObject
                            {
                                ["success"] = false,
                                ["error"] = ex.Message
                            };
                            writer.WriteLine(errorResponse.ToString(Formatting.None));
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Client disconnected
            }
        }

        private string ProcessRequest(string requestJson)
        {
            try
            {
                var request = JObject.Parse(requestJson);
                var command = request["command"]?.ToString();
                var args = request["args"] as JObject ?? new JObject();

                if (string.IsNullOrEmpty(command))
                {
                    return JsonConvert.SerializeObject(new
                    {
                        success = false,
                        error = "Missing 'command' field"
                    });
                }

                var result = commandHandler.Execute(command, args);
                return result.ToString(Formatting.None);
            }
            catch (JsonException ex)
            {
                return JsonConvert.SerializeObject(new
                {
                    success = false,
                    error = $"Invalid JSON: {ex.Message}"
                });
            }
            catch (Exception ex)
            {
                return JsonConvert.SerializeObject(new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
