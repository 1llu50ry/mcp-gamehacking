# ReClass.NET MCP Integration

This project provides an MCP (Model Context Protocol) integration for ReClass.NET, allowing Claude Code to interact with ReClass.NET for memory analysis and reverse engineering tasks.

## Components

### 1. ReClassMCP.Plugin (C#)

A ReClass.NET plugin that:
- Starts a TCP server on port 27015 when ReClass.NET loads
- Exposes ReClass.NET functionality via JSON-RPC over TCP
- Handles memory reading/writing, class/node management, and process inspection

### 2. ReClassMCP.Server (Python)

An MCP server that:
- Connects to the ReClass.NET plugin via TCP
- Translates MCP protocol to plugin commands
- Exposes tools for Claude Code to use

## Installation

### Getting the Plugin

**Option 1: Download Pre-built Release (Recommended)**

1. Download `ReClassMCP.zip` from the [Releases](../../releases) page
2. Extract and copy the contents of the `x64/` or `x86/` folder (match your ReClass.NET version) to your ReClass.NET `Plugins` folder
3. The `MCP-Server/` folder contains the Python MCP server

**Option 2: Build from Source**

1. Clone this repo and ReClass.NET:
   ```bash
   git clone https://github.com/NateWeav/ReClassMCP.git
   cd ReClassMCP
   git clone https://github.com/ReClassNET/ReClass.NET.git
   ```
2. Open the solution in Visual Studio 2019+ or run `build.ps1`
3. Copy `ReClassMCP.dll` and `Newtonsoft.Json.dll` from the build output to ReClass.NET's `Plugins` folder

### Installing the MCP Server

1. Install Python 3.10 or later
2. Install the MCP server dependencies:

```bash
cd ReClassMCP.Server
pip install -r requirements.txt
```

### Configuring Claude Code

Add the following to your Claude Code MCP configuration file (`~/.claude/mcp.json` or project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "reclass": {
      "command": "python",
      "args": ["/path/to/ReClassMCP/ReClassMCP.Server/reclass_mcp_server.py"],
      "env": {}
    }
  }
}
```

Or using `uv`:

```json
{
  "mcpServers": {
    "reclass": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/ReClassMCP/ReClassMCP.Server", "python", "reclass_mcp_server.py"],
      "env": {}
    }
  }
}
```

## Available MCP Tools

### Connection & Status

| Tool | Description |
|------|-------------|
| `IsConnected` | Check if ReClass.NET plugin is available |
| `GetStatus` | Get current status including attached process info |
| `GetProcessInfo` | Get detailed process information |

### Memory Operations

| Tool | Description |
|------|-------------|
| `ReadMemory` | Read memory from the attached process |
| `WriteMemory` | Write memory to the attached process |
| `ParseAddress` | Parse an address formula (e.g., `module.exe+0x1234`) |

### Module & Section Info

| Tool | Description |
|------|-------------|
| `GetModules` | List all loaded modules in the process |
| `GetSections` | List all memory sections |

### Class/Structure Management

| Tool | Description |
|------|-------------|
| `GetClasses` | List all classes in the project |
| `GetClass` | Get detailed info about a specific class |
| `GetNodes` | Get all nodes/fields in a class |
| `CreateClass` | Create a new class/structure |
| `AddNode` | Add a new field to a class |
| `RenameNode` | Rename a field |
| `SetComment` | Set a comment on a field |
| `ChangeNodeType` | Change a field's type |

### Supported Node Types

- **Numeric**: `int8`, `int16`, `int32`, `int64`, `uint8`, `uint16`, `uint32`, `uint64`, `float`, `double`
- **Hex**: `hex8`, `hex16`, `hex32`, `hex64`
- **Text**: `utf8text`, `utf16text`, `utf32text`, `utf8textptr`, `utf16textptr`, `utf32textptr`
- **Vector**: `vector2`, `vector3`, `vector4`
- **Matrix**: `matrix3x3`, `matrix3x4`, `matrix4x4`
- **Other**: `pointer`, `function`, `functionptr`, `virtualmethodtable`, `bool`

## Usage Example

Once configured, you can ask Claude Code to:

```
"Connect to ReClass.NET and show me the current classes"

"Read 64 bytes of memory at 0x7FF12345"

"Create a new class called 'ConfigData' and add fields for flags (uint32) and count (int32)"

"Analyze the memory at 0x7FF12345 and suggest appropriate field types"
```

## License

MIT License
