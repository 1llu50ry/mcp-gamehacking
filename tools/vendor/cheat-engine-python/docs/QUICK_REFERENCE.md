# Quick Reference Guide

## Essential Commands

### Getting Started
```
"List all running processes"
"Attach to process with ID 1234"
"Detach from current process"
```

### Basic Memory Operations
```
"Read 64 bytes from address 0x140000000"
"Read string data at address 0x200000000"
"Get memory regions for current process"
```

### Pattern Searching
```
"Scan memory for pattern: 41 42 43"
"Search for text 'Hello World' in memory"
"Find pattern with wildcards: 48 ?? 05 ?? ?? ?? ??"
```

### Code Analysis
```
"Disassemble 100 bytes at address 0x140001000"
"Analyze data structure at 0x300000000, size 256"
"Resolve pointer chain from 0x140000000 with offsets [16, 32, 48]"
```

## Data Types Quick Reference

| Type | Size | Use For | Example |
|------|------|---------|---------|
| `bytes` | Variable | Raw data, unknown format | Binary analysis |
| `string` | Variable | Text data | Messages, names |
| `int32` | 4 bytes | Standard integers | Counters, IDs |
| `uint32` | 4 bytes | Positive integers | Memory addresses (32-bit) |
| `int64` | 8 bytes | Large integers | Timestamps |
| `uint64` | 8 bytes | Large positive integers | Memory addresses (64-bit) |
| `float` | 4 bytes | Decimal numbers | Coordinates, percentages |
| `double` | 8 bytes | High precision decimals | Scientific calculations |

## Common Memory Patterns

### Finding Text
```
Pattern: "Hello World"
Use: Finding string literals in memory
```

### Finding Integers
```
Pattern: Little-endian bytes
Value 1000 (0x3E8) = "E8 03 00 00"
Value 256 (0x100) = "00 01 00 00"
```

### Finding Code Patterns
```
x64 function prologue: "48 89 5C 24 ??"
x64 function epilogue: "48 8B 5C 24 ??"
Call instruction: "E8 ?? ?? ?? ??"
```

## Memory Protection Types

| Protection | Meaning | Can Read | Can Write | Can Execute |
|------------|---------|----------|-----------|-------------|
| `PAGE_READONLY` | Read-only data | ✅ | ❌ | ❌ |
| `PAGE_READWRITE` | Data section | ✅ | ✅ | ❌ |
| `PAGE_EXECUTE_READ` | Code section | ✅ | ❌ | ✅ |
| `PAGE_EXECUTE_READWRITE` | Self-modifying code | ✅ | ✅ | ✅ |
| `PAGE_NOACCESS` | Protected memory | ❌ | ❌ | ❌ |

## Address Format Examples

### Valid Formats
- `0x140000000` - Standard hex format
- `0x7FF123456789` - 64-bit address
- `0x00400000` - 32-bit style address

### Invalid Formats
- `140000000` - Missing 0x prefix
- `0x140000000G` - Invalid hex character
- `random_text` - Not a hex number

## Error Messages & Solutions

| Error | Most Likely Cause | Quick Fix |
|-------|------------------|-----------|
| "Access Denied" | Not Administrator | Run PowerShell as Admin |
| "Process not found" | Wrong PID or process closed | Use `list_processes` again |
| "Cannot read memory" | Invalid address | Check with `get_memory_regions` |
| "Process not in whitelist" | Security restriction | Add to `whitelist.json` |
| "Pattern not found" | Wrong pattern or region | Try broader search area |

## Configuration Files

### `server/config/settings.json`
```json
{
  "security": {
    "read_only_mode": true,
    "require_whitelist": true,
    "max_memory_read": 1048576
  }
}
```

### `server/config/whitelist.json`  
```json
{
  "processes": [
    {"name": "notepad.exe", "allowed": true},
    {"name": "calc.exe", "allowed": true}
  ]
}
```

## Assembly Basics

### Common x64 Instructions
- `mov rax, rbx` - Move data between registers
- `add rax, 10` - Add 10 to rax register
- `cmp rax, rbx` - Compare two values
- `je label` - Jump if equal
- `call function` - Call a function
- `ret` - Return from function

### Register Names (x64)
- `rax, rbx, rcx, rdx` - General purpose (64-bit)
- `eax, ebx, ecx, edx` - General purpose (32-bit)
- `rsp` - Stack pointer
- `rip` - Instruction pointer

## Useful Patterns for Games

### Health/Mana Values
```
Pattern: Look for 4-byte integers
Range: 0-1000 typically
Search: Convert to hex, scan memory
```

### Player Coordinates
```
Pattern: Float values
Typical: X, Y, Z as sequential floats
Size: 12 bytes (3 × 4-byte floats)
```

### String Tables
```
Pattern: Null-terminated strings
Format: "Text\x00" in memory
Search: Direct ASCII text search
```

## Command Examples by Use Case

### Debugging Your Program
```
1. "List processes and find MyProgram.exe"
2. "Attach to MyProgram.exe process"
3. "Get memory regions for current process"
4. "Read 1024 bytes from main module base address"
5. "Search for my variable name in memory"
```

### Learning Assembly
```
1. "Attach to simple program like calculator"
2. "Find executable memory regions"
3. "Disassemble 200 bytes from executable region"
4. "Look for function call patterns"
```

### Analyzing Data Structures
```
1. "Read 256 bytes from suspected structure address"
2. "Analyze structure at address with size 256"
3. "Look for pointer patterns in the data"
4. "Follow pointers with resolve_pointer_chain"
```

## Safety Checklist

### Before Starting
- [ ] Running as Administrator
- [ ] Process is in whitelist
- [ ] Using safe test programs
- [ ] Have backup of important work

### During Analysis  
- [ ] Start with small memory reads
- [ ] Test patterns on known data first
- [ ] Don't analyze critical system processes
- [ ] Save interesting findings to files

### After Analysis
- [ ] Detach from all processes
- [ ] Review logs for any issues
- [ ] Document findings
- [ ] Close unnecessary programs

## Performance Tips

### Faster Memory Scans
- Limit scan regions with start/end addresses
- Use specific patterns instead of wildcards
- Increase alignment for faster scanning
- Focus on readable memory regions only

### Efficient Analysis
- Read larger chunks instead of many small reads
- Cache memory region information
- Use appropriate data types for your needs
- Batch similar operations together

## Getting Help

### Debug Information
```
python server/main.py --debug
```

### Log Files Location
```
logs/server.log - General operations
logs/errors.log - Error details
logs/operations.log - Security audit
```

### Common Questions
- Check FAQ.md for detailed troubleshooting
- Review API_REFERENCE.md for technical details
- See USER_GUIDE.md for step-by-step tutorials

## Version Information

This quick reference is for MCP Cheat Engine Server v0.1.0
- Compatible with Python 3.9+
- Requires Windows 10/11 for full functionality
- Uses MCP protocol for AI integration
- Read-only mode for safety

Remember: This tool is for educational and legitimate debugging purposes only. Always respect software licenses and terms of service.
