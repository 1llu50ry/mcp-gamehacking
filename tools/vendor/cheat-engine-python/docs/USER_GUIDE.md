# User Guide: MCP Cheat Engine Server

## Getting Started in 5 Minutes

### What is This?
The MCP Cheat Engine Server lets you safely explore and analyze computer memory through your AI assistant. Think of it as a safe, read-only window into how programs use memory.

### Who Should Use This?
- Software developers debugging their programs
- Students learning about computer memory
- Security researchers analyzing software
- Anyone curious about how programs work

## Quick Setup

### Step 1: Install Python
Download Python 3.9 or newer from [python.org](https://python.org)

### Step 2: Download Dependencies
Open PowerShell as Administrator and run:
```powershell
cd path\to\cheat-engine-server-python
pip install -r requirements.txt
```

### Step 3: Test It Works
```powershell
python server/main.py --test
```
You should see: "MCP Cheat Engine Server initialized successfully"

## Your First Memory Analysis

### Example 1: Analyzing Notepad

1. **Open Notepad** and type some text
2. **Ask your AI assistant**: "List all running processes"
3. **Find Notepad** in the results (look for `notepad.exe`)
4. **Attach to it**: "Attach to the notepad process"
5. **Read some memory**: "Read 100 bytes from the main module"
6. **Detach safely**: "Detach from the current process"

### Example 2: Finding Text in Memory

1. **Open Calculator** 
2. **Attach to calculator process**
3. **Search for patterns**: "Scan memory for the text 'Calculator'"
4. **Analyze results**: Look at the addresses where the text was found
5. **Read around those addresses**: "Read 200 bytes starting at [address]"

## Common Tasks

### Finding a Specific Value
```
"Scan memory for the 4-byte integer value 12345"
```

### Looking at Assembly Code
```
"Disassemble 50 bytes of code starting at address 0x140001000"
```

### Following Pointers
```
"Resolve pointer chain starting at 0x140000000 with offsets [16, 32, 48]"
```

### Analyzing Data Structures
```
"Analyze the data structure at address 0x200000000, size 256 bytes"
```

## Safety Features

### Read-Only Mode
✅ **Can do**: Read memory, analyze data, disassemble code
❌ **Cannot do**: Modify memory, change program behavior, crash programs

### Process Whitelist
Only approved programs can be analyzed. Edit `server/config/whitelist.json` to add programs:
```json
{
  "processes": [
    {"name": "notepad.exe", "allowed": true},
    {"name": "calculator.exe", "allowed": true}
  ]
}
```

### Automatic Logging
All operations are logged for security. Check `logs/operations.log` to see what was done.

## Understanding the Results

### Memory Addresses
- `0x140000000` - Hexadecimal address (starts with 0x)
- Usually 64-bit on modern systems
- Each address points to 1 byte of memory

### Data Types
- **bytes** - Raw binary data (shows as hex: `41 42 43`)
- **string** - Text data (shows as: `"Hello World"`)
- **int32** - 32-bit number (shows as: `12345`)
- **float** - Decimal number (shows as: `3.14159`)

### Memory Protection
- **Readable** - Can read data from this region
- **Writable** - Program can modify this region
- **Executable** - Contains program code

## Troubleshooting

### "Access Denied" Error
**Solution**: Run PowerShell as Administrator

### "Process not in whitelist" Error
**Solution**: Add the process to `server/config/whitelist.json`

### "Cannot read memory at address" Error
**Solution**: The address might be invalid. Use "Get memory regions" first to find valid addresses

### "Module not found" Error
**Solution**: Run `pip install -r requirements.txt` again

## Best Practices

### Start Simple
- Begin with basic programs like Notepad or Calculator
- Avoid complex programs or games initially
- Test each feature one at a time

### Be Patient
- Memory analysis can take time
- Large memory scans may take several seconds
- Wait for one operation to complete before starting another

### Stay Safe
- Only analyze programs you own or have permission to examine
- Respect software licenses and terms of service
- Use this for educational and legitimate purposes only

### Learn Gradually
1. **Week 1**: Basic process attachment and memory reading
2. **Week 2**: Pattern scanning and data type conversion
3. **Week 3**: Assembly disassembly and pointer chains
4. **Week 4**: Advanced analysis and automation

## Example Workflows

### Debugging Your Own Program
1. Compile your program with debug symbols
2. Run it and reproduce the issue
3. Attach to the process
4. Read memory around key variables
5. Look for unexpected values or corruption

### Learning Assembly
1. Write a simple C program
2. Compile it and run it
3. Attach to the process
4. Find the main function in memory
5. Disassemble and study the assembly code

### Understanding Data Structures
1. Create a program with known data structures
2. Attach and find the structures in memory
3. Use "Analyze structure" to see how data is laid out
4. Compare with your source code

## Getting Help

### Debug Mode
Run with extra logging:
```powershell
python server/main.py --debug
```

### Check Logs
Look in the `logs/` directory for detailed error information.

### Test Configuration
Verify your setup:
```powershell
python -c "import mcp, trio, psutil, capstone; print('OK')"
```

### Common Solutions
- **Restart as Administrator** - Fixes most permission issues
- **Update Python packages** - `pip install --upgrade -r requirements.txt`
- **Check antivirus** - May block memory access
- **Use simple test programs** - Start with Notepad before complex software

## Advanced Features

### Cheat Engine Tables
Import existing .CT files:
```
"Import the cheat table from C:\path\to\table.CT"
```

### Lua Scripts
Analyze Cheat Engine Lua scripts safely:
```
"Analyze this Lua script: [paste script content]"
```

### Custom Patterns
Search with wildcards:
```
"Scan for pattern: 48 8B 05 ?? ?? ?? ??"
```
(The `??` means "any byte")

### Memory Maps
Get the full memory layout:
```
"Show me all memory regions for this process"
```

## Remember

- **This is a learning tool** - Use it to understand how software works
- **Safety first** - Read-only mode protects your system
- **Be patient** - Memory analysis takes practice to master
- **Ask questions** - Your AI assistant can guide you through complex analyses
- **Respect others** - Only analyze software you're authorized to examine

Happy memory exploring! 🔍
