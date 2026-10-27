"""
Formatting Utilities
Output formatting and data presentation functions
"""

import struct
import logging
from typing import Any, List, Dict, Optional, Union
from datetime import datetime

logger = logging.getLogger(__name__)

def format_memory_data(data: bytes, data_type: str, address: int, analysis: Optional[Dict] = None) -> str:
    """Format memory data according to the specified type
    
    Args:
        data: Raw memory data
        data_type: Type of formatting to apply
        address: Base address of the data
        analysis: Optional analysis results
        
    Returns:
        Formatted string representation
    """
    try:
        if not data:
            return "No data"
        
        if data_type.lower() == "raw":
            return format_raw_bytes(data, address)
        elif data_type.lower() in ["int32", "uint32", "dword"]:
            return format_integers(data, address, 4, signed=(data_type.lower() == "int32"))
        elif data_type.lower() in ["int64", "uint64", "qword"]:
            return format_integers(data, address, 8, signed=(data_type.lower() == "int64"))
        elif data_type.lower() in ["int16", "uint16", "word"]:
            return format_integers(data, address, 2, signed=(data_type.lower() == "int16"))
        elif data_type.lower() in ["float", "single"]:
            return format_floats(data, address, 4)
        elif data_type.lower() == "double":
            return format_floats(data, address, 8)
        elif data_type.lower() in ["string", "str", "ascii"]:
            return format_strings(data, address, encoding="ascii")
        elif data_type.lower() == "utf16":
            return format_strings(data, address, encoding="utf-16le")
        elif data_type.lower() == "auto":
            return format_auto_detect(data, address)
        elif data_type.lower() in ["structure", "struct"]:
            return format_structure(data, address, analysis)
        else:
            return format_raw_bytes(data, address)
            
    except Exception as e:
        logger.error(f"Error formatting memory data: {e}")
        return f"Error formatting data: {e}"

def format_raw_bytes(data: bytes, address: int, bytes_per_line: int = 16) -> str:
    """Format data as raw hex bytes with ASCII representation"""
    output = []
    output.append(f"Raw memory data at 0x{address:08X} ({len(data)} bytes):")
    output.append("")
    
    for i in range(0, len(data), bytes_per_line):
        chunk = data[i:i+bytes_per_line]
        addr_str = f"0x{address + i:08X}:"
        
        # Hex representation
        hex_str = ' '.join(f"{b:02X}" for b in chunk)
        hex_str = hex_str.ljust(bytes_per_line * 3 - 1)  # Pad for alignment
        
        # ASCII representation
        ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in chunk)
        
        output.append(f"{addr_str} {hex_str} |{ascii_str}|")
    
    return '\n'.join(output)

def format_integers(data: bytes, address: int, size: int, signed: bool = False) -> str:
    """Format data as integers of specified size"""
    if size == 2:
        format_char = '<h' if signed else '<H'
        type_name = "int16" if signed else "uint16"
    elif size == 4:
        format_char = '<i' if signed else '<I'
        type_name = "int32" if signed else "uint32"
    elif size == 8:
        format_char = '<q' if signed else '<Q'
        type_name = "int64" if signed else "uint64"
    else:
        return "Unsupported integer size"
    
    output = []
    output.append(f"{type_name} values at 0x{address:08X}:")
    output.append("")
    
    for i in range(0, len(data) - size + 1, size):
        try:
            value = struct.unpack(format_char, data[i:i+size])[0]
            addr = address + i
            
            if signed:
                output.append(f"0x{addr:08X}: {value:>12} (0x{value & ((1 << (size*8)) - 1):0{size*2}X})")
            else:
                output.append(f"0x{addr:08X}: {value:>12} (0x{value:0{size*2}X})")
                
        except struct.error:
            break
    
    return '\n'.join(output)

def format_floats(data: bytes, address: int, size: int) -> str:
    """Format data as floating-point numbers"""
    if size == 4:
        format_char = '<f'
        type_name = "float"
    elif size == 8:
        format_char = '<d'
        type_name = "double"
    else:
        return "Unsupported float size"
    
    output = []
    output.append(f"{type_name} values at 0x{address:08X}:")
    output.append("")
    
    for i in range(0, len(data) - size + 1, size):
        try:
            value = struct.unpack(format_char, data[i:i+size])[0]
            addr = address + i
            
            # Format with appropriate precision
            if abs(value) < 1e-6 or abs(value) > 1e6:
                formatted_value = f"{value:.6e}"
            else:
                formatted_value = f"{value:.6f}"
            
            output.append(f"0x{addr:08X}: {formatted_value}")
                
        except struct.error:
            break
    
    return '\n'.join(output)

def format_strings(data: bytes, address: int, encoding: str = "ascii", max_length: int = 100) -> str:
    """Format data as strings"""
    output = []
    output.append(f"String data at 0x{address:08X} ({encoding}):")
    output.append("")
    
    # Find strings in the data
    strings_found = []
    current_string = []
    string_start = 0
    
    if encoding == "ascii":
        for i, byte in enumerate(data):
            if 32 <= byte <= 126:  # Printable ASCII
                if not current_string:
                    string_start = i
                current_string.append(chr(byte))
            elif byte == 0 and current_string:  # Null terminator
                if len(current_string) >= 3:  # Minimum string length
                    strings_found.append((string_start, ''.join(current_string)))
                current_string = []
            else:
                if current_string and len(current_string) >= 3:
                    strings_found.append((string_start, ''.join(current_string)))
                current_string = []
    
    elif encoding == "utf-16le":
        i = 0
        while i < len(data) - 1:
            char_bytes = data[i:i+2]
            if len(char_bytes) == 2:
                try:
                    char = char_bytes.decode('utf-16le')
                    if char.isprintable() and char != '\x00':
                        if not current_string:
                            string_start = i
                        current_string.append(char)
                    elif char == '\x00' and current_string:
                        if len(current_string) >= 3:
                            strings_found.append((string_start, ''.join(current_string)))
                        current_string = []
                    else:
                        if current_string and len(current_string) >= 3:
                            strings_found.append((string_start, ''.join(current_string)))
                        current_string = []
                except UnicodeDecodeError:
                    if current_string and len(current_string) >= 3:
                        strings_found.append((string_start, ''.join(current_string)))
                    current_string = []
            i += 2
    
    # Add any remaining string
    if current_string and len(current_string) >= 3:
        strings_found.append((string_start, ''.join(current_string)))
    
    if not strings_found:
        output.append("No strings found")
    else:
        for offset, string_value in strings_found:
            addr = address + offset
            # Truncate long strings
            display_string = string_value[:max_length]
            if len(string_value) > max_length:
                display_string += "..."
            
            output.append(f"0x{addr:08X}: \"{display_string}\"")
    
    return '\n'.join(output)

def format_auto_detect(data: bytes, address: int) -> str:
    """Auto-detect and format data types"""
    output = []
    output.append(f"Auto-detected data at 0x{address:08X}:")
    output.append("=" * 50)
    
    # Check for strings first
    string_result = format_strings(data, address)
    if "No strings found" not in string_result:
        output.append("Strings found:")
        output.append(string_result)
        output.append("")
    
    # Check for potential pointers (4-byte aligned values in reasonable ranges)
    output.append("Potential pointers:")
    pointer_count = 0
    for i in range(0, len(data) - 3, 4):
        try:
            value = struct.unpack('<I', data[i:i+4])[0]
            if 0x00400000 <= value <= 0x7FFFFFFF:  # Typical user space
                addr = address + i
                output.append(f"0x{addr:08X}: 0x{value:08X}")
                pointer_count += 1
                if pointer_count >= 10:  # Limit output
                    output.append("... (more pointers found)")
                    break
        except struct.error:
            break
    
    if pointer_count == 0:
        output.append("No obvious pointers found")
    
    output.append("")
    
    # Show first few bytes as hex/ASCII
    output.append("Raw bytes (first 64 bytes):")
    preview_data = data[:64]
    hex_preview = format_raw_bytes(preview_data, address)
    output.append(hex_preview)
    
    return '\n'.join(output)

def format_structure(data: bytes, address: int, analysis: Optional[Dict] = None) -> str:
    """Format data as a structured analysis"""
    output = []
    output.append(f"Structure analysis at 0x{address:08X}:")
    output.append("=" * 50)
    
    if analysis and 'fields' in analysis:
        output.append(f"Detected structure (confidence: {analysis.get('confidence', 0):.1%}):")
        output.append("")
        output.append(f"{'Offset':<8} {'Type':<12} {'Name':<20} {'Value'}")
        output.append("-" * 60)
        
        for field in analysis['fields']:
            offset_str = f"+0x{field['offset']:X}"
            confidence_indicator = "*" if field.get('confidence', 0) > 0.7 else " "
            output.append(f"{offset_str:<8} {field['type']:<12} {field['name']:<20} {field['value']}{confidence_indicator}")
    
    else:
        # Fallback to simple hex dump with annotations
        output.append("Basic structure view:")
        output.append("")
        
        for i in range(0, min(len(data), 128), 4):  # Show first 128 bytes in 4-byte chunks
            chunk = data[i:i+4]
            addr = address + i
            
            if len(chunk) == 4:
                # Try to interpret as different types
                try:
                    uint_val = struct.unpack('<I', chunk)[0]
                    int_val = struct.unpack('<i', chunk)[0]
                    float_val = struct.unpack('<f', chunk)[0]
                    
                    annotations = []
                    
                    # Check if it looks like a pointer
                    if 0x00400000 <= uint_val <= 0x7FFFFFFF:
                        annotations.append(f"ptr: 0x{uint_val:08X}")
                    
                    # Check if it's a reasonable integer
                    if -1000000 <= int_val <= 1000000:
                        annotations.append(f"int: {int_val}")
                    
                    # Check if it's a reasonable float
                    if -1000000.0 <= float_val <= 1000000.0 and not (float_val != float_val):  # Not NaN
                        annotations.append(f"float: {float_val:.3f}")
                    
                    hex_bytes = ' '.join(f"{b:02X}" for b in chunk)
                    annotation_str = " | ".join(annotations[:2])  # Limit annotations
                    
                    output.append(f"+0x{i:02X}: {hex_bytes} - {annotation_str}")
                    
                except struct.error:
                    hex_bytes = ' '.join(f"{b:02X}" for b in chunk)
                    output.append(f"+0x{i:02X}: {hex_bytes}")
    
    return '\n'.join(output)

def format_process_info(processes: List[Dict], detailed: bool = False) -> str:
    """Format process information for display"""
    if not processes:
        return "No processes found"
    
    output = []
    
    if detailed and len(processes) == 1:
        # Detailed view for single process
        proc = processes[0]
        output.append(f"Process Details:")
        output.append("=" * 40)
        output.append(f"PID:          {proc['pid']}")
        output.append(f"Name:         {proc['name']}")
        output.append(f"Path:         {proc.get('exe_path', 'N/A')}")
        output.append(f"Architecture: {proc.get('architecture', 'Unknown')}")
        output.append(f"Status:       {proc.get('status', 'Unknown')}")
        
        if 'memory_info' in proc:
            mem_info = proc['memory_info']
            output.append(f"Memory (RSS): {format_size(mem_info.get('rss', 0))}")
            output.append(f"Memory (VMS): {format_size(mem_info.get('vms', 0))}")
            output.append(f"Memory %:     {mem_info.get('percent', 0):.1f}%")
        
        if 'num_threads' in proc:
            output.append(f"Threads:      {proc['num_threads']}")
        
        if 'modules_count' in proc:
            output.append(f"Modules:      {proc['modules_count']}")
    
    else:
        # List view
        output.append(f"Found {len(processes)} processes:")
        output.append("")
        output.append(f"{'PID':<8} {'Name':<25} {'Arch':<6} {'Memory':<10}")
        output.append("-" * 55)
        
        for proc in processes:
            pid = proc['pid']
            name = proc['name'][:24]  # Truncate long names
            arch = proc.get('architecture', 'N/A')[:5]
            memory = format_size(proc.get('memory_usage', 0))
            
            output.append(f"{pid:<8} {name:<25} {arch:<6} {memory:<10}")
    
    return '\n'.join(output)

def format_size(size_bytes: int) -> str:
    """Format a size in bytes to human-readable format"""
    if size_bytes == 0:
        return "0 B"
    
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    unit_index = 0
    size = float(size_bytes)
    
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    
    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    else:
        return f"{size:.1f} {units[unit_index]}"

def format_timestamp(timestamp: Optional[float] = None) -> str:
    """Format a timestamp for display"""
    if timestamp is None:
        timestamp = datetime.now().timestamp()
    
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def format_hex_dump(data: bytes, address: int = 0, width: int = 16) -> str:
    """Format data as a hex dump with ASCII representation"""
    output = []
    
    for i in range(0, len(data), width):
        chunk = data[i:i+width]
        addr_str = f"{address + i:08X}:"
        
        # Hex bytes
        hex_part = ' '.join(f"{b:02X}" for b in chunk)
        hex_part = hex_part.ljust(width * 3 - 1)  # Pad for alignment
        
        # ASCII representation
        ascii_part = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in chunk)
        
        output.append(f"{addr_str} {hex_part} |{ascii_part}|")
    
    return '\n'.join(output)

def format_error_message(error: Exception, context: str = "") -> str:
    """Format an error message for user display"""
    error_type = type(error).__name__
    error_msg = str(error)
    
    if context:
        return f"Error in {context}: {error_type} - {error_msg}"
    else:
        return f"{error_type}: {error_msg}"

def format_scan_results(results: List[int], pattern: str, limit: int = 50) -> str:
    """Format memory scan results"""
    if not results:
        return f"No matches found for pattern: {pattern}"
    
    output = []
    output.append(f"Found {len(results)} matches for pattern '{pattern}':")
    output.append("")
    
    displayed = min(len(results), limit)
    for i in range(displayed):
        output.append(f"{i+1:4d}: 0x{results[i]:08X}")
    
    if len(results) > limit:
        output.append(f"... and {len(results) - limit} more matches")
    
    return '\n'.join(output)
