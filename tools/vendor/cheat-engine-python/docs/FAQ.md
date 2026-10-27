# Frequently Asked Questions (FAQ)

## General Questions

### What is the MCP Cheat Engine Server?

**Q: What exactly does this tool do?**

A: The MCP Cheat Engine Server is a safe, educational tool that lets you examine computer memory through AI assistants. It provides similar functionality to Cheat Engine but operates in read-only mode and integrates with AI systems through the Model Context Protocol (MCP).

**Q: Is this tool safe to use?**

A: Yes! The server operates in read-only mode, meaning it can only read and analyze memory - it cannot modify anything. This prevents crashes, system instability, or security issues. All operations are logged for security auditing.

**Q: Do I need Cheat Engine installed to use this?**

A: No! This is a standalone tool that provides memory analysis functionality without requiring Cheat Engine. However, it can import and analyze Cheat Engine table files (.CT files).

**Q: What operating systems are supported?**

A: Primary support is for Windows 10/11. Limited functionality is available on Linux and macOS, but some Windows-specific features won't work on other platforms.

## Installation and Setup

### System Requirements

**Q: What are the minimum system requirements?**

A: You need:
- Windows 10/11 (64-bit recommended)
- Python 3.9 or higher  
- 4GB RAM minimum (8GB recommended)
- Administrator privileges
- 4GB free disk space

**Q: Why do I need Administrator privileges?**

A: Windows requires elevated privileges to read memory from other processes for security reasons. This is a Windows security feature, not a limitation of our tool.

**Q: Can I run this without Administrator rights?**

A: No, memory access operations require Administrator privileges on Windows. This is a fundamental Windows security requirement that cannot be bypassed.

### Installation Issues

**Q: "Python is not recognized" - what does this mean?**

A: This means Python isn't properly installed or isn't in your system PATH. Solutions:
1. Reinstall Python and check "Add to PATH" during installation
2. Restart your computer after installing Python
3. Verify installation by typing `python --version` in Command Prompt

**Q: "pip is not recognized" - how do I fix this?**

A: This usually means Python wasn't installed correctly:
1. Uninstall Python from Control Panel
2. Download fresh Python installer from python.org
3. During installation, check "Add Python to PATH"
4. Restart your computer
5. Test with `pip --version`

**Q: The installation seems to hang or take forever**

A: This is usually normal! The first installation downloads many files:
- Be patient - it can take 5-10 minutes on slow connections
- Don't close the window even if it looks stuck
- If it truly hangs for 30+ minutes, restart and try again

**Q: My antivirus is blocking the installation**

A: Some antivirus programs are overly cautious:
1. Temporarily disable real-time protection during installation
2. Add the server folder to your antivirus exclusions
3. Re-enable protection after installation
4. This is a false positive - the tool is safe

## Usage and Features

### Basic Operations

**Q: What processes should I start with as a beginner?**

A: Start with simple, safe programs:
- Notepad (notepad.exe) - Perfect for learning
- Calculator (calc.exe) - Simple and safe
- Your own test programs
- Avoid games or system processes initially

**Q: How do I know if a process is safe to analyze?**

A: Safe processes are typically:
- Simple applications like text editors
- Your own programs
- Open-source software
- Programs you have permission to analyze

Avoid:
- System critical processes
- Antivirus software
- Online games (may violate terms of service)
- Commercial software without permission

**Q: What's the difference between attaching and detaching?**

A: 
- **Attaching** opens a connection to a process so you can read its memory
- **Detaching** safely closes that connection
- Always detach when finished to free up system resources
- You can only be attached to one process at a time

### Memory Analysis

**Q: What are memory addresses and how do I use them?**

A: Memory addresses are locations in computer memory, like house addresses:
- Format: `0x140000000` (hexadecimal, starting with 0x)
- Each address points to one byte of data
- Valid addresses depend on the specific program
- Use "Get memory regions" to find valid address ranges

**Q: What data types should I use for reading memory?**

A: Choose based on what you're looking for:
- **bytes** - Unknown data, raw analysis
- **string** - Text data  
- **int32/uint32** - Most common for numbers, pointers
- **int64/uint64** - Large numbers, 64-bit pointers
- **float/double** - Decimal numbers

**Q: Why am I getting "Cannot read memory at address" errors?**

A: Common causes:
- Invalid address (doesn't exist in the process)
- Memory is protected (not readable)
- Process has been terminated
- Address is outside valid memory regions

Solution: Use "Get memory regions" first to find readable areas.

**Q: How do pattern searches work?**

A: Pattern searching finds specific byte sequences:
- `41 42 43` - Find exact bytes 0x41, 0x42, 0x43
- `48 ?? 05` - Find 0x48, any byte, 0x05 (wildcard)
- `"Hello"` - Find ASCII text
- `?? ?? ?? ??` - Four unknown bytes

### Advanced Features

**Q: What are pointer chains and how do I use them?**

A: Pointer chains are multiple levels of memory references:
- Base address points to another address
- That address points to another address  
- Continue following until you reach the final value
- Common in games and complex programs
- Example: `[[base + 0x10] + 0x20] + 0x30`

**Q: Can I analyze assembly code?**

A: Yes! The disassembly feature converts machine code to readable assembly:
- Useful for understanding program logic
- Requires some assembly language knowledge
- Best used on executable memory regions
- Shows instruction addresses, opcodes, and mnemonics

**Q: What are Cheat Engine tables and can I use them?**

A: Cheat Engine tables (.CT files) contain memory addresses and scripts:
- You can import and analyze existing .CT files
- The tool extracts addresses and data types
- Lua scripts are analyzed for safety but not executed
- Great for learning from existing research

## Security and Safety

### Read-Only Mode

**Q: What exactly does "read-only mode" mean?**

A: Read-only mode means the tool can:
✅ Read memory contents
✅ Analyze data structures  
✅ Search for patterns
✅ Disassemble code

But it CANNOT:
❌ Modify memory values
❌ Change program behavior
❌ Write to memory
❌ Inject code

**Q: Can this tool crash programs or my computer?**

A: It's extremely unlikely because:
- Read-only operations are generally safe
- No memory modification occurs
- Process attachment is non-invasive
- The tool includes safety checks and timeouts

However, very rarely, even reading certain memory regions might cause instability in poorly written programs.

**Q: Is it legal to use this tool?**

A: Generally yes, for legitimate purposes:
✅ Analyzing your own programs
✅ Educational research  
✅ Security research on permitted software
✅ Debugging and development

⚠️ Be careful with:
- Commercial software (check license terms)
- Online games (may violate terms of service)
- Software you don't own
- Reverse engineering proprietary code without permission

### Process Whitelist

**Q: What is the process whitelist and why do I need it?**

A: The whitelist controls which programs can be analyzed:
- Prevents accidental analysis of system processes
- Reduces security risks
- Forces intentional, deliberate choices
- Can be customized for your needs

**Q: How do I add programs to the whitelist?**

A: Edit `server/config/whitelist.json`:
```json
{
  "processes": [
    {
      "name": "myprogram.exe",
      "allowed": true,
      "description": "My test program"
    }
  ]
}
```

**Q: Can I disable the whitelist?**

A: Not recommended, but you can set `require_whitelist: false` in `server/config/settings.json`. This is less secure and not recommended for beginners.

## Troubleshooting

### Common Errors

**Q: "Access Denied" when attaching to process**

A: This usually means:
1. Not running as Administrator (most common)
2. Process is protected by antivirus
3. Process has higher privileges than your session
4. Process is a system-critical component

**Q: "Process not found" error**

A: Check that:
1. Process is still running (didn't crash/close)
2. You're using the correct Process ID (PID)
3. Process name is spelled correctly
4. Process hasn't changed PID since listing

**Q: Memory reads return empty or invalid data**

A: Possible causes:
1. Memory region is not committed/allocated
2. Data has moved due to program execution
3. Address calculation is incorrect
4. Process memory layout has changed

**Q: Scans find no results even though data should exist**

A: Try:
1. Scanning a smaller memory region
2. Using wildcards in your pattern
3. Checking if the target data format is different
4. Verifying the process has the expected data

### Performance Issues

**Q: Memory scans are very slow**

A: Speed up scans by:
1. Limiting scan regions with start/end addresses
2. Using more specific patterns (fewer wildcards)
3. Increasing alignment values
4. Scanning only readable memory regions

**Q: The tool uses a lot of memory**

A: This is normal for memory analysis tools:
- Close other applications if needed
- Use smaller read sizes
- Limit scan results
- Detach from processes when not needed

**Q: Operations timeout frequently**

A: Increase timeout values in `server/config/settings.json`:
```json
{
  "performance": {
    "scan_timeout": 60,
    "read_timeout": 10
  }
}
```

## Advanced Topics

### Automation and Scripting

**Q: Can I automate memory analysis tasks?**

A: Yes! You can:
- Write Python scripts using the MCP client
- Create batch operations through AI assistants
- Set up automated monitoring workflows
- Build custom analysis tools

**Q: How do I handle large-scale analysis?**

A: For analyzing large programs:
1. Break analysis into smaller chunks
2. Focus on specific memory regions
3. Use pattern scanning to find areas of interest
4. Save intermediate results to files
5. Use the API programmatically for batch operations

### Learning and Education

**Q: I'm new to memory analysis - where should I start?**

A: Learning path for beginners:
1. **Week 1**: Basic concepts, process attachment, simple memory reads
2. **Week 2**: Data types, pattern searching, memory regions
3. **Week 3**: Assembly basics, disassembly, pointer chains
4. **Week 4**: Advanced analysis, automation, real projects

**Q: What background knowledge do I need?**

A: Helpful to know:
- Basic programming concepts
- Understanding of data types (integers, strings, etc.)
- Hexadecimal number system
- Basic computer architecture concepts

But don't worry - you can learn as you go!

**Q: Are there good resources for learning more?**

A: Recommended resources:
- Computer architecture textbooks
- Assembly language tutorials
- Reverse engineering courses
- Cheat Engine forums and tutorials
- Security research blogs

## Getting Help

### When to Ask for Help

**Q: I'm stuck - when should I ask for help?**

A: Ask for help when:
- Error messages don't make sense
- You've tried troubleshooting steps
- You're not sure if something is working correctly
- You want to learn better approaches

**Q: What information should I include when asking for help?**

A: Provide:
- Complete error messages
- Steps you tried
- Your operating system and Python version
- Log files from `logs/` directory
- What you're trying to accomplish

### Self-Help Resources

**Q: How can I debug issues myself?**

A: Self-debugging steps:
1. Check log files in `logs/` directory
2. Enable debug mode: `python server/main.py --debug`
3. Test with simple programs first
4. Verify your configuration files
5. Check that processes are whitelisted

**Q: How do I find more detailed error information?**

A: Enable verbose logging:
1. Set log level to DEBUG in `server/config/settings.json`
2. Run with `--debug` flag
3. Check both console output and log files
4. Look for patterns in repeated errors

Remember: This tool is designed for learning and legitimate analysis. Take your time, experiment safely, and don't hesitate to ask questions!
