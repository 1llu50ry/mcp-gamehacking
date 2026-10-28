using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using ReClassNET.Memory;
using ReClassNET.Nodes;
using ReClassNET.Plugins;

namespace ReClassMCP
{
    public class CommandHandler
    {
        private readonly IPluginHost host;

        public CommandHandler(IPluginHost host)
        {
            this.host = host;
        }

        public JObject Execute(string command, JObject args)
        {
            try
            {
                switch (command.ToLowerInvariant())
                {
                    case "ping":
                        return Success(new JObject { ["message"] = "pong" });

                    case "get_status":
                        return GetStatus();

                    case "read_memory":
                        return ReadMemory(args);

                    case "write_memory":
                        return WriteMemory(args);

                    case "get_classes":
                        return GetClasses();

                    case "get_class":
                        return GetClass(args);

                    case "get_nodes":
                        return GetNodes(args);

                    case "get_modules":
                        return GetModules();

                    case "get_sections":
                        return GetSections();

                    case "parse_address":
                        return ParseAddress(args);

                    case "create_class":
                        return CreateClass(args);

                    case "add_node":
                        return AddNode(args);

                    case "rename_node":
                        return RenameNode(args);

                    case "set_comment":
                        return SetComment(args);

                    case "change_node_type":
                        return ChangeNodeType(args);

                    case "get_process_info":
                        return GetProcessInfo();

                    default:
                        return Error($"Unknown command: {command}");
                }
            }
            catch (Exception ex)
            {
                return Error(ex.Message);
            }
        }

        private JObject Success(JObject data = null)
        {
            var result = new JObject { ["success"] = true };
            if (data != null)
            {
                foreach (var prop in data.Properties())
                {
                    result[prop.Name] = prop.Value;
                }
            }
            return result;
        }

        private JObject Error(string message)
        {
            return new JObject
            {
                ["success"] = false,
                ["error"] = message
            };
        }

        private JObject GetStatus()
        {
            var isAttached = host.Process?.IsValid ?? false;
            var processName = host.Process?.UnderlayingProcess?.Name ?? "";
            var processId = host.Process?.UnderlayingProcess?.Id.ToInt64() ?? 0;

            return Success(new JObject
            {
                ["attached"] = isAttached,
                ["process_name"] = processName,
                ["process_id"] = processId
            });
        }

        private JObject ReadMemory(JObject args)
        {
            if (!host.Process.IsValid)
                return Error("No process attached");

            var addressStr = args["address"]?.ToString();
            var sizeStr = args["size"]?.ToString();

            if (string.IsNullOrEmpty(addressStr))
                return Error("Missing 'address' parameter");

            if (string.IsNullOrEmpty(sizeStr) || !int.TryParse(sizeStr, out var size))
                return Error("Missing or invalid 'size' parameter");

            if (size <= 0 || size > 0x10000)
                return Error("Size must be between 1 and 65536 bytes");

            IntPtr address;
            if (addressStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                address = (IntPtr)Convert.ToInt64(addressStr.Substring(2), 16);
            }
            else if (long.TryParse(addressStr, out var dec))
            {
                address = (IntPtr)dec;
            }
            else
            {
                // Try parsing as formula/expression
                address = ParseAddressFormula(addressStr);
            }

            var buffer = host.Process.ReadRemoteMemory(address, size);
            if (buffer == null)
                return Error("Failed to read memory");

            return Success(new JObject
            {
                ["address"] = $"0x{address.ToInt64():X}",
                ["size"] = size,
                ["data"] = BitConverter.ToString(buffer).Replace("-", "")
            });
        }

        private JObject WriteMemory(JObject args)
        {
            if (!host.Process.IsValid)
                return Error("No process attached");

            var addressStr = args["address"]?.ToString();
            var dataStr = args["data"]?.ToString();

            if (string.IsNullOrEmpty(addressStr))
                return Error("Missing 'address' parameter");

            if (string.IsNullOrEmpty(dataStr))
                return Error("Missing 'data' parameter");

            IntPtr address;
            if (addressStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                address = (IntPtr)Convert.ToInt64(addressStr.Substring(2), 16);
            }
            else
            {
                address = (IntPtr)Convert.ToInt64(addressStr);
            }

            // Parse hex string to bytes
            var data = new byte[dataStr.Length / 2];
            for (int i = 0; i < data.Length; i++)
            {
                data[i] = Convert.ToByte(dataStr.Substring(i * 2, 2), 16);
            }

            var success = host.Process.WriteRemoteMemory(address, data);
            return success ? Success() : Error("Failed to write memory");
        }

        private JObject GetClasses()
        {
            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            var classes = new JArray();
            foreach (var cls in project.Classes)
            {
                classes.Add(new JObject
                {
                    ["uuid"] = cls.Uuid.ToString(),
                    ["name"] = cls.Name,
                    ["address"] = cls.AddressFormula,
                    ["size"] = cls.MemorySize,
                    ["node_count"] = cls.Nodes.Count,
                    ["comment"] = cls.Comment ?? ""
                });
            }

            return Success(new JObject { ["classes"] = classes });
        }

        private JObject GetClass(JObject args)
        {
            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            var identifier = args["id"]?.ToString() ?? args["name"]?.ToString();
            if (string.IsNullOrEmpty(identifier))
                return Error("Missing 'id' or 'name' parameter");

            ClassNode classNode = null;

            // Try by UUID
            if (Guid.TryParse(identifier, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }

            // Try by name
            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(identifier, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {identifier}");

            return Success(new JObject
            {
                ["uuid"] = classNode.Uuid.ToString(),
                ["name"] = classNode.Name,
                ["address"] = classNode.AddressFormula,
                ["size"] = classNode.MemorySize,
                ["comment"] = classNode.Comment ?? "",
                ["nodes"] = SerializeNodes(classNode.Nodes)
            });
        }

        private JObject GetNodes(JObject args)
        {
            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            var classId = args["class_id"]?.ToString() ?? args["class_name"]?.ToString();
            if (string.IsNullOrEmpty(classId))
                return Error("Missing 'class_id' or 'class_name' parameter");

            ClassNode classNode = null;

            if (Guid.TryParse(classId, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }

            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(classId, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {classId}");

            return Success(new JObject { ["nodes"] = SerializeNodes(classNode.Nodes) });
        }

        private JArray SerializeNodes(IReadOnlyList<BaseNode> nodes)
        {
            var result = new JArray();
            foreach (var node in nodes)
            {
                var nodeObj = new JObject
                {
                    ["type"] = node.GetType().Name,
                    ["name"] = node.Name,
                    ["offset"] = node.Offset,
                    ["size"] = node.MemorySize,
                    ["comment"] = node.Comment ?? ""
                };

                // Add type-specific information
                if (node is BaseContainerNode container)
                {
                    nodeObj["children"] = SerializeNodes(container.Nodes);
                }
                else if (node is BaseWrapperNode wrapper && wrapper.InnerNode != null)
                {
                    nodeObj["inner_type"] = wrapper.InnerNode.GetType().Name;
                }

                result.Add(nodeObj);
            }
            return result;
        }

        private JObject GetModules()
        {
            if (!host.Process.IsValid)
                return Error("No process attached");

            var modules = new JArray();
            foreach (var module in host.Process.Modules)
            {
                modules.Add(new JObject
                {
                    ["name"] = module.Name,
                    ["path"] = module.Path,
                    ["start"] = $"0x{module.Start.ToInt64():X}",
                    ["end"] = $"0x{module.End.ToInt64():X}",
                    ["size"] = module.Size.ToInt64()
                });
            }

            return Success(new JObject { ["modules"] = modules });
        }

        private JObject GetSections()
        {
            if (!host.Process.IsValid)
                return Error("No process attached");

            var sections = new JArray();
            foreach (var section in host.Process.Sections)
            {
                sections.Add(new JObject
                {
                    ["name"] = section.Name,
                    ["category"] = section.Category.ToString(),
                    ["protection"] = section.Protection.ToString(),
                    ["type"] = section.Type.ToString(),
                    ["start"] = $"0x{section.Start.ToInt64():X}",
                    ["end"] = $"0x{section.End.ToInt64():X}",
                    ["size"] = section.Size.ToInt64(),
                    ["module"] = section.ModuleName ?? ""
                });
            }

            return Success(new JObject { ["sections"] = sections });
        }

        private JObject ParseAddress(JObject args)
        {
            var formula = args["formula"]?.ToString();
            if (string.IsNullOrEmpty(formula))
                return Error("Missing 'formula' parameter");

            try
            {
                var address = ParseAddressFormula(formula);
                return Success(new JObject
                {
                    ["address"] = $"0x{address.ToInt64():X}",
                    ["decimal"] = address.ToInt64()
                });
            }
            catch (Exception ex)
            {
                return Error($"Failed to parse address: {ex.Message}");
            }
        }

        private IntPtr ParseAddressFormula(string formula)
        {
            // Simple hex parsing
            if (formula.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                return (IntPtr)Convert.ToInt64(formula.Substring(2), 16);
            }

            // Try as module+offset (e.g., "game.exe+0x1234")
            if (formula.Contains("+"))
            {
                var parts = formula.Split(new[] { '+' }, 2);
                var moduleName = parts[0].Trim();
                var offsetStr = parts[1].Trim();

                var module = host.Process.Modules.FirstOrDefault(m =>
                    m.Name.Equals(moduleName, StringComparison.OrdinalIgnoreCase));

                if (module != null)
                {
                    long offset;
                    if (offsetStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                    {
                        offset = Convert.ToInt64(offsetStr.Substring(2), 16);
                    }
                    else
                    {
                        offset = Convert.ToInt64(offsetStr);
                    }

                    return (IntPtr)(module.Start.ToInt64() + offset);
                }
            }

            // Try as decimal
            if (long.TryParse(formula, out var dec))
            {
                return (IntPtr)dec;
            }

            throw new ArgumentException($"Unable to parse address formula: {formula}");
        }

        private JObject CreateClass(JObject args)
        {
            var name = args["name"]?.ToString();
            var address = args["address"]?.ToString();

            if (string.IsNullOrEmpty(name))
                return Error("Missing 'name' parameter");

            ClassNode classNode = null;

            InvokeOnMainThread(() =>
            {
                // ClassNode.Create() triggers ClassCreated event which auto-adds to project
                classNode = ClassNode.Create();
                classNode.Name = name;

                if (!string.IsNullOrEmpty(address))
                {
                    classNode.AddressFormula = address;
                }
            });

            if (classNode == null)
                return Error("Failed to create class");

            return Success(new JObject
            {
                ["uuid"] = classNode.Uuid.ToString(),
                ["name"] = classNode.Name,
                ["address"] = classNode.AddressFormula
            });
        }

        private JObject AddNode(JObject args)
        {
            var classId = args["class_id"]?.ToString() ?? args["class_name"]?.ToString();
            var nodeType = args["type"]?.ToString();
            var nodeName = args["name"]?.ToString();

            if (string.IsNullOrEmpty(classId))
                return Error("Missing 'class_id' or 'class_name' parameter");

            if (string.IsNullOrEmpty(nodeType))
                return Error("Missing 'type' parameter");

            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            ClassNode classNode = null;
            if (Guid.TryParse(classId, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }
            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(classId, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {classId}");

            var nodeTypeObj = GetNodeType(nodeType);
            if (nodeTypeObj == null)
                return Error($"Unknown node type: {nodeType}");

            BaseNode newNode = null;

            InvokeOnMainThread(() =>
            {
                newNode = BaseNode.CreateInstanceFromType(nodeTypeObj);
                if (newNode != null)
                {
                    if (!string.IsNullOrEmpty(nodeName))
                    {
                        newNode.Name = nodeName;
                    }
                    classNode.AddNode(newNode);
                }
            });

            if (newNode == null)
                return Error("Failed to create node");

            return Success(new JObject
            {
                ["type"] = newNode.GetType().Name,
                ["name"] = newNode.Name,
                ["offset"] = newNode.Offset,
                ["size"] = newNode.MemorySize
            });
        }

        private JObject RenameNode(JObject args)
        {
            var classId = args["class_id"]?.ToString() ?? args["class_name"]?.ToString();
            var nodeIndex = args["node_index"];
            var newName = args["name"]?.ToString();

            if (string.IsNullOrEmpty(classId))
                return Error("Missing 'class_id' or 'class_name' parameter");

            if (nodeIndex == null)
                return Error("Missing 'node_index' parameter");

            if (string.IsNullOrEmpty(newName))
                return Error("Missing 'name' parameter");

            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            ClassNode classNode = null;
            if (Guid.TryParse(classId, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }
            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(classId, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {classId}");

            var index = nodeIndex.Value<int>();
            if (index < 0 || index >= classNode.Nodes.Count)
                return Error($"Invalid node index: {index}");

            var node = classNode.Nodes[index];

            InvokeOnMainThread(() =>
            {
                node.Name = newName;
            });

            return Success(new JObject
            {
                ["name"] = node.Name,
                ["offset"] = node.Offset
            });
        }

        private JObject SetComment(JObject args)
        {
            var classId = args["class_id"]?.ToString() ?? args["class_name"]?.ToString();
            var nodeIndex = args["node_index"];
            var comment = args["comment"]?.ToString() ?? "";

            if (string.IsNullOrEmpty(classId))
                return Error("Missing 'class_id' or 'class_name' parameter");

            if (nodeIndex == null)
                return Error("Missing 'node_index' parameter");

            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            ClassNode classNode = null;
            if (Guid.TryParse(classId, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }
            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(classId, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {classId}");

            var index = nodeIndex.Value<int>();
            if (index < 0 || index >= classNode.Nodes.Count)
                return Error($"Invalid node index: {index}");

            var node = classNode.Nodes[index];

            InvokeOnMainThread(() =>
            {
                node.Comment = comment;
            });

            return Success();
        }

        private JObject ChangeNodeType(JObject args)
        {
            var classId = args["class_id"]?.ToString() ?? args["class_name"]?.ToString();
            var nodeIndex = args["node_index"];
            var newType = args["type"]?.ToString();

            if (string.IsNullOrEmpty(classId))
                return Error("Missing 'class_id' or 'class_name' parameter");

            if (nodeIndex == null)
                return Error("Missing 'node_index' parameter");

            if (string.IsNullOrEmpty(newType))
                return Error("Missing 'type' parameter");

            var project = GetCurrentProject();
            if (project == null)
                return Error("No project loaded");

            ClassNode classNode = null;
            if (Guid.TryParse(classId, out var guid))
            {
                classNode = project.Classes.FirstOrDefault(c => c.Uuid == guid);
            }
            if (classNode == null)
            {
                classNode = project.Classes.FirstOrDefault(c =>
                    c.Name.Equals(classId, StringComparison.OrdinalIgnoreCase));
            }

            if (classNode == null)
                return Error($"Class not found: {classId}");

            var index = nodeIndex.Value<int>();
            if (index < 0 || index >= classNode.Nodes.Count)
                return Error($"Invalid node index: {index}");

            var nodeTypeObj = GetNodeType(newType);
            if (nodeTypeObj == null)
                return Error($"Unknown node type: {newType}");

            var oldNode = classNode.Nodes[index];
            BaseNode newNode = null;

            InvokeOnMainThread(() =>
            {
                newNode = BaseNode.CreateInstanceFromType(nodeTypeObj);
                if (newNode != null)
                {
                    classNode.ReplaceChildNode(oldNode, newNode);
                }
            });

            if (newNode == null)
                return Error("Failed to change node type");

            return Success(new JObject
            {
                ["type"] = newNode.GetType().Name,
                ["name"] = newNode.Name,
                ["offset"] = newNode.Offset,
                ["size"] = newNode.MemorySize
            });
        }

        private JObject GetProcessInfo()
        {
            if (!host.Process.IsValid)
                return Error("No process attached");

            var proc = host.Process.UnderlayingProcess;
            return Success(new JObject
            {
                ["id"] = proc.Id.ToInt64(),
                ["name"] = proc.Name,
                ["path"] = proc.Path,
                ["is_valid"] = host.Process.IsValid
            });
        }

        private Type GetNodeType(string typeName)
        {
            var nodeTypes = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase)
            {
                // Numeric types
                { "int8", typeof(Int8Node) },
                { "int16", typeof(Int16Node) },
                { "int32", typeof(Int32Node) },
                { "int64", typeof(Int64Node) },
                { "uint8", typeof(UInt8Node) },
                { "uint16", typeof(UInt16Node) },
                { "uint32", typeof(UInt32Node) },
                { "uint64", typeof(UInt64Node) },
                { "float", typeof(FloatNode) },
                { "double", typeof(DoubleNode) },
                // Hex types
                { "hex8", typeof(Hex8Node) },
                { "hex16", typeof(Hex16Node) },
                { "hex32", typeof(Hex32Node) },
                { "hex64", typeof(Hex64Node) },
                // Text types
                { "utf8text", typeof(Utf8TextNode) },
                { "utf16text", typeof(Utf16TextNode) },
                { "utf32text", typeof(Utf32TextNode) },
                { "utf8textptr", typeof(Utf8TextPtrNode) },
                { "utf16textptr", typeof(Utf16TextPtrNode) },
                { "utf32textptr", typeof(Utf32TextPtrNode) },
                // Vector types
                { "vector2", typeof(Vector2Node) },
                { "vector3", typeof(Vector3Node) },
                { "vector4", typeof(Vector4Node) },
                // Matrix types
                { "matrix3x3", typeof(Matrix3x3Node) },
                { "matrix3x4", typeof(Matrix3x4Node) },
                { "matrix4x4", typeof(Matrix4x4Node) },
                // Pointer type
                { "pointer", typeof(PointerNode) },
                // Function types
                { "function", typeof(FunctionNode) },
                { "functionptr", typeof(FunctionPtrNode) },
                // Virtual method
                { "virtualmethodtable", typeof(VirtualMethodTableNode) },
                // Bool
                { "bool", typeof(BoolNode) },
            };

            // Try direct lookup
            if (nodeTypes.TryGetValue(typeName, out var type))
                return type;

            // Try with "Node" suffix stripped
            if (typeName.EndsWith("Node", StringComparison.OrdinalIgnoreCase))
            {
                var baseName = typeName.Substring(0, typeName.Length - 4);
                if (nodeTypes.TryGetValue(baseName, out type))
                    return type;
            }

            return null;
        }

        private ReClassNET.Project.ReClassNetProject GetCurrentProject()
        {
            ReClassNET.Project.ReClassNetProject project = null;

            if (host.MainWindow.InvokeRequired)
            {
                host.MainWindow.Invoke(new Action(() =>
                {
                    project = host.MainWindow.CurrentProject;
                }));
            }
            else
            {
                project = host.MainWindow.CurrentProject;
            }

            return project;
        }

        private void InvokeOnMainThread(Action action)
        {
            if (host.MainWindow.InvokeRequired)
            {
                host.MainWindow.Invoke(action);
            }
            else
            {
                action();
            }
        }
    }
}
