# API Reference

## MCP Tools Overview

The MCP Cheat Engine Server provides 10 tools accessible through the Model Context Protocol:

| Tool | Purpose | Input Parameters | Return Type |
|------|---------|------------------|-------------|
| `list_processes` | Enumerate running processes | None | ProcessList |
| `attach_to_process` | Attach to target process | process_id: int | AttachResult |
| `detach_from_process` | Detach from current process | None | DetachResult |
| `read_memory_region` | Read memory data | address, size, data_type | MemoryData |
| `scan_memory` | Search for patterns | pattern, start_address, end_address | ScanResults |
| `analyze_structure` | Analyze data structures | address, size | StructureInfo |
| `resolve_pointer_chain` | Follow pointer chains | base_address, offsets[] | ResolvedAddress |
| `disassemble_code` | Disassemble assembly | address, size, architecture | AssemblyCode |
| `import_cheat_table` | Import CE table file | file_path | CheatTableInfo |
| `execute_lua_script` | Execute Lua script safely | script_content, safe_mode | LuaResult |

## Tool Specifications

### list_processes

Lists all running processes that can be analyzed.

**Parameters:** None

**Returns:**
```json
{
  "processes": [
    {
      "pid": 1234,
      "name": "notepad.exe",
      "memory_usage": 12345678,
      "accessible": true,
      "architecture": "x64",
      "path": "C:\\Windows\\System32\\notepad.exe"
    }
  ],
  "total_count": 42,
  "accessible_count": 15
}
```

**Error Conditions:**
- Permission denied (not running as administrator)
- Process enumeration failed

---

### attach_to_process

Attaches to a specific process for memory analysis.

**Parameters:**
```json
{
  "process_id": 1234
}
```

**Returns:**
```json
{
  "success": true,
  "process_info": {
    "pid": 1234,
    "name": "notepad.exe",
    "base_address": "0x140000000",
    "modules": [
      {
        "name": "notepad.exe",
        "base_address": "0x140000000",
        "size": 123456,
        "path": "C:\\Windows\\System32\\notepad.exe"
      }
    ]
  },
  "handle": "internal_handle_id"
}
```

**Error Conditions:**
- Process not found
- Process not in whitelist
- Access denied
- Already attached to another process

---

### detach_from_process

Safely detaches from the currently attached process.

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "message": "Successfully detached from process 1234 (notepad.exe)"
}
```

**Error Conditions:**
- No process currently attached
- Detach operation failed

---

### read_memory_region

Reads memory data from the attached process.

**Parameters:**
```json
{
  "address": "0x140000000",
  "size": 64,
  "data_type": "bytes"
}
```

**Supported Data Types:**
- `bytes` - Raw binary data
- `string` - ASCII/UTF-8 text
- `int8`, `uint8` - 8-bit integers
- `int16`, `uint16` - 16-bit integers  
- `int32`, `uint32` - 32-bit integers
- `int64`, `uint64` - 64-bit integers
- `float` - 32-bit floating point
- `double` - 64-bit floating point

**Returns:**
```json
{
  "address": "0x140000000",
  "size": 64,
  "data_type": "bytes",
  "data": "4D5A90000300000004000000FFFF0000...",
  "formatted_data": "MZ.............",
  "region_info": {
    "protect": "PAGE_EXECUTE_READ",
    "state": "MEM_COMMIT",
    "type": "MEM_IMAGE"
  }
}
```

**Error Conditions:**
- No process attached
- Invalid memory address
- Memory not readable
- Size too large (>1MB default limit)

---

### scan_memory

Searches for byte patterns in process memory.

**Parameters:**
```json
{
  "pattern": "48 8B 05 ?? ?? ?? ??",
  "start_address": "0x140000000",
  "end_address": "0x141000000",
  "alignment": 1
}
```

**Pattern Format:**
- Hex bytes: `41 42 43`
- Wildcards: `?? ?? ??` or `?`
- ASCII text: `"Hello World"`
- Mixed: `48 65 6C 6C 6F ?? ?? ??`

**Returns:**
```json
{
  "pattern": "48 8B 05 ?? ?? ?? ??",
  "matches": [
    {
      "address": "0x140001234",
      "bytes": "488B0512345678",
      "context": "Previous and following bytes for context"
    }
  ],
  "total_matches": 5,
  "scan_time": 0.123,
  "memory_scanned": 16777216
}
```

**Error Conditions:**
- Invalid pattern format
- No process attached
- Memory region not accessible
- Scan timeout exceeded

---

### analyze_structure

Analyzes memory to identify probable data structures.

**Parameters:**
```json
{
  "address": "0x200000000",
  "size": 256
}
```

**Returns:**
```json
{
  "address": "0x200000000",
  "size": 256,
  "fields": [
    {
      "offset": 0,
      "size": 4,
      "type": "uint32",
      "value": 12345,
      "description": "Probable counter or ID"
    },
    {
      "offset": 8,
      "size": 8,
      "type": "pointer",
      "value": "0x140002000",
      "description": "Pointer to code section"
    }
  ],
  "alignment": 8,
  "probable_type": "C++ class instance",
  "confidence": 0.85
}
```

**Error Conditions:**
- No process attached
- Invalid memory address
- Analysis failed

---

### resolve_pointer_chain

Follows a chain of pointers to resolve the final address.

**Parameters:**
```json
{
  "base_address": "0x140000000",
  "offsets": [16, 32, 48]
}
```

**Returns:**
```json
{
  "base_address": "0x140000000",
  "offsets": [16, 32, 48],
  "steps": [
    {
      "step": 1,
      "address": "0x140000010",
      "value": "0x200000000",
      "description": "Read pointer at base + 0x10"
    },
    {
      "step": 2,
      "address": "0x200000020",
      "value": "0x300000000",
      "description": "Read pointer at previous + 0x20"
    }
  ],
  "final_address": "0x300000030",
  "success": true
}
```

**Error Conditions:**
- No process attached
- Invalid base address
- Null pointer encountered
- Memory access failed

---

### disassemble_code

Disassembles assembly code from memory.

**Parameters:**
```json
{
  "address": "0x140001000",
  "size": 100,
  "architecture": "x64"
}
```

**Supported Architectures:**
- `x86` - 32-bit x86
- `x64` - 64-bit x86-64
- `arm` - ARM (limited support)
- `arm64` - ARM64 (limited support)

**Returns:**
```json
{
  "address": "0x140001000",
  "size": 100,
  "architecture": "x64",
  "instructions": [
    {
      "address": "0x140001000",
      "bytes": "488B0512345678",
      "mnemonic": "mov",
      "operands": "rax, qword ptr [rip + 0x78563412]",
      "full_instruction": "mov rax, qword ptr [rip + 0x78563412]"
    }
  ],
  "instruction_count": 15,
  "analysis": {
    "has_calls": true,
    "has_jumps": true,
    "probable_function": true
  }
}
```

**Error Conditions:**
- No process attached
- Invalid memory address
- Memory not executable
- Disassembly failed

---

### import_cheat_table

Imports and parses a Cheat Engine table (.CT) file.

**Parameters:**
```json
{
  "file_path": "C:\\path\\to\\table.CT"
}
```

**Returns:**
```json
{
  "file_path": "C:\\path\\to\\table.CT",
  "table_info": {
    "version": "6.8.3",
    "process_name": "target.exe",
    "entries": [
      {
        "id": 1,
        "description": "Health",
        "address": "0x140001234",
        "type": "4 Bytes",
        "value": "100"
      }
    ]
  },
  "lua_scripts": [
    {
      "name": "Auto-attach",
      "content": "-- Lua script content",
      "safe_to_execute": false
    }
  ],
  "generated_tools": [
    {
      "name": "read_health",
      "description": "Read health value",
      "address": "0x140001234"
    }
  ]
}
```

**Error Conditions:**
- File not found
- Invalid .CT format
- Parse error
- File too large

---

### execute_lua_script

Analyzes and optionally executes Lua scripts safely.

**Parameters:**
```json
{
  "script_content": "print('Hello from Lua')",
  "safe_mode": true,
  "context_variables": {
    "health": 100,
    "max_health": 200
  }
}
```

**Returns:**
```json
{
  "script_analysis": {
    "safe_to_execute": true,
    "variables": ["health", "damage"],
    "functions": ["calculateDamage"],
    "dependencies": [],
    "dangerous_operations": []
  },
  "execution_result": {
    "success": true,
    "output": "Hello from Lua",
    "variables": {
      "result": 42
    },
    "execution_time": 0.001
  }
}
```

**Error Conditions:**
- Script marked as unsafe
- Lua interpreter not available
- Execution timeout
- Runtime error

## Data Types

### ProcessInfo
```typescript
interface ProcessInfo {
  pid: number;
  name: string;
  memory_usage: number;
  accessible: boolean;
  architecture: "x86" | "x64" | "arm" | "arm64";
  path: string;
  modules?: ModuleInfo[];
}
```

### MemoryRegion
```typescript
interface MemoryRegion {
  base_address: string;
  size: number;
  protect: string;
  state: string;
  type: string;
  readable: boolean;
  writable: boolean;
  executable: boolean;
}
```

### ScanMatch
```typescript
interface ScanMatch {
  address: string;
  bytes: string;
  context?: string;
  region_info?: MemoryRegion;
}
```

### Instruction
```typescript
interface Instruction {
  address: string;
  bytes: string;
  mnemonic: string;
  operands: string;
  full_instruction: string;
  comment?: string;
}
```

## Error Handling

All tools return errors in a consistent format:

```json
{
  "error": true,
  "error_type": "ValidationError",
  "message": "Invalid memory address format",
  "details": {
    "provided_address": "invalid_address",
    "expected_format": "Hexadecimal string starting with 0x"
  },
  "suggestions": [
    "Use format like: 0x140000000",
    "Ensure address is valid for target process"
  ]
}
```

### Error Types
- `ValidationError` - Invalid input parameters
- `ProcessError` - Process-related issues
- `MemoryError` - Memory access problems
- `SecurityError` - Security policy violations
- `TimeoutError` - Operation timeout
- `InternalError` - Server internal errors

## Configuration

### Server Settings
Configuration is managed through JSON files in `server/config/`:

#### settings.json
```json
{
  "security": {
    "read_only_mode": true,
    "require_whitelist": true,
    "log_all_operations": true,
    "max_memory_read": 1048576,
    "scan_timeout": 30
  },
  "performance": {
    "max_scan_results": 1000,
    "cache_memory_regions": true,
    "enable_disassembly_cache": true
  },
  "logging": {
    "level": "INFO",
    "file_path": "logs/server.log",
    "max_file_size": 10485760,
    "backup_count": 5
  }
}
```

#### whitelist.json
```json
{
  "processes": [
    {
      "name": "notepad.exe",
      "allowed": true,
      "description": "Windows Notepad"
    },
    {
      "pattern": "test_*.exe",
      "allowed": true,
      "description": "Test applications"
    }
  ],
  "default_policy": "deny"
}
```

## Integration Examples

### Python Client
```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def analyze_process():
    server_params = StdioServerParameters(
        command="python",
        args=["server/main.py"]
    )
    
    async with stdio_client(server_params) as client:
        # List processes
        result = await client.call_tool("list_processes", {})
        processes = result.content[0].text
        
        # Attach to process
        await client.call_tool("attach_to_process", {
            "process_id": 1234
        })
        
        # Read memory
        memory_data = await client.call_tool("read_memory_region", {
            "address": "0x140000000",
            "size": 64,
            "data_type": "bytes"
        })
        
        # Detach
        await client.call_tool("detach_from_process", {})

asyncio.run(analyze_process())
```

### Rate Limiting
The server implements rate limiting to prevent abuse:
- Maximum 100 requests per minute per client
- Memory read operations limited to 1MB per request
- Scan operations timeout after 30 seconds
- Maximum 1000 results per scan

### Security Considerations
- All operations are logged for audit purposes
- Process whitelist prevents unauthorized access
- Read-only mode prevents memory modification
- Input validation prevents injection attacks
- Administrator privileges required for memory access
