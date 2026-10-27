# Cheat Table Filesystem Integration

## Overview

The MCP Cheat Engine Server has been enhanced with comprehensive filesystem integration capabilities for directly reading and managing cheat table (.CT) files from the file system. This enhancement allows seamless access to cheat tables stored in standard directories like `C:\Users\benam\Documents\My Cheat Tables\`.

## Key Features

### 1. **Direct Filesystem Access**
- **Browse Directories**: Navigate and explore cheat table directories
- **File Discovery**: Automatically detect and list all .CT files 
- **File Metadata**: Get detailed information including file size, modification dates, and paths
- **Directory Analysis**: Comprehensive directory structure analysis with statistics

### 2. **Cheat Table Parsing**
- **Multi-Format Support**: Handle both XML and binary .CT file formats
- **Complete Address Extraction**: Parse and extract all memory addresses from cheat tables
- **Metadata Parsing**: Extract table titles, target processes, and configuration information
- **Entry Details**: Get descriptions, addresses, types, values, and enabled states

### 3. **Flexible Output Formats**
- **Detailed Format**: Complete address listings with full metadata
- **CSV Format**: Comma-separated values for spreadsheet integration
- **Simple Format**: Compact address-description pairs
- **Custom Formatting**: Extensible format system for specific use cases

## Available MCP Tools

### `browse_cheat_tables_directory`
**Purpose**: Browse and analyze cheat table directories

**Parameters**:
- `directory_path` (optional): Directory to browse (defaults to `C:\Users\benam\Documents\My Cheat Tables`)

**Returns**: Comprehensive directory listing with:
- Directory size and statistics
- Cheat table files with metadata
- Other files summary
- Modification timestamps

**Example Usage**:
```python
result = await session.call_tool("browse_cheat_tables_directory", {})
```

### `list_cheat_tables`
**Purpose**: List all .CT files in a directory with detailed information

**Parameters**:
- `directory_path` (optional): Directory to search (defaults to standard cheat tables directory)

**Returns**: Formatted list showing:
- File names and paths
- File sizes in bytes
- Last modification timestamps
- Total file count

**Example Usage**:
```python
result = await session.call_tool("list_cheat_tables", {
    "directory_path": "C:\\Custom\\Path\\To\\Tables"
})
```

### `load_cheat_table`
**Purpose**: Load and parse a specific .CT file

**Parameters**:
- `file_path` (required): Full path to the .CT file

**Returns**: Complete cheat table information including:
- Table title and target process
- Total entry count
- Full address list with descriptions, addresses, types, values, and states

**Example Usage**:
```python
result = await session.call_tool("load_cheat_table", {
    "file_path": "C:\\Users\\benam\\Documents\\My Cheat Tables\\Diablo II.CT"
})
```

### `extract_cheat_table_addresses`
**Purpose**: Extract addresses in specific formats

**Parameters**:
- `file_path` (required): Path to the .CT file
- `address_format` (optional): Output format - "detailed", "csv", or "simple" (default: "detailed")

**Returns**: Formatted address information based on selected format

**Example Usage**:
```python
# Detailed format
result = await session.call_tool("extract_cheat_table_addresses", {
    "file_path": "C:\\Path\\To\\Table.CT",
    "address_format": "detailed"
})

# CSV format for spreadsheet import
result = await session.call_tool("extract_cheat_table_addresses", {
    "file_path": "C:\\Path\\To\\Table.CT",
    "address_format": "csv"
})

# Simple format for quick reference
result = await session.call_tool("extract_cheat_table_addresses", {
    "file_path": "C:\\Path\\To\\Table.CT",
    "address_format": "simple"
})
```

### `quick_load_diablo2_cheat_table`
**Purpose**: Convenience function for quickly loading the Diablo II cheat table

**Parameters**: None

**Returns**: Complete address list from `Diablo II.CT` in detailed format

**Example Usage**:
```python
result = await session.call_tool("quick_load_diablo2_cheat_table", {})
```

## Output Format Examples

### Detailed Format
```
Complete Address List from Diablo II.CT:
============================================================

 1. Description: Player Health
    Address:     0x7FF6ABC12340
    Type:        4 Bytes  
    Value:       1000
    Enabled:     False

 2. Description: Player Mana
    Address:     0x7FF6ABC12344
    Type:        4 Bytes
    Value:       500
    Enabled:     True
```

### CSV Format
```
Description,Address,Type,Value,Enabled
"Player Health",0x7FF6ABC12340,4 Bytes,1000,False
"Player Mana",0x7FF6ABC12344,4 Bytes,500,True
"Player Experience",0x7FF6ABC12348,4 Bytes,50000,False
```

### Simple Format
```
Addresses from Diablo II.CT:
0x7FF6ABC12340 - Player Health
0x7FF6ABC12344 - Player Mana
0x7FF6ABC12348 - Player Experience
```

## File System Structure Support

The enhancement supports the standard Cheat Engine file organization:

```
C:\Users\[Username]\Documents\My Cheat Tables\
├── Diablo II.CT                    # Main game tables
├── D2LoD1.14b.CT                  # Version-specific tables  
├── Starcraft II_25.02.2021.CT     # Dated tables
├── Custom_Game.ct                  # Custom tables
└── [Additional .CT files]          # Various cheat tables
```

## Integration Benefits

### 1. **Seamless Workflow**
- Direct access to cheat tables without manual file handling
- Automated discovery of available tables
- Instant parsing and address extraction

### 2. **Enhanced Productivity**
- Quick access to frequently used tables (Diablo II convenience function)
- Multiple output formats for different use cases
- Comprehensive metadata for informed decision making

### 3. **Robust File Handling**
- Support for both XML and binary .CT formats
- Error handling for missing or corrupted files
- File system validation and safety checks

### 4. **Extensible Architecture**
- Easy addition of new output formats
- Customizable directory paths
- Modular design for future enhancements

## Technical Implementation

### Core Components
- **CheatTableParser**: Enhanced binary and XML parsing engine
- **Filesystem Tools**: Direct file system integration layer
- **MCP Integration**: RESTful tool interface for client access
- **Format Engine**: Multi-format output generation system

### Error Handling
- File not found validation
- Parsing error recovery
- Directory access validation
- Graceful degradation for unsupported formats

### Performance Optimization
- Efficient file parsing algorithms
- Minimal memory footprint for large tables
- Cached directory scanning
- Optimized metadata extraction

## Usage Examples

### Python Client Integration
```python
import asyncio
from mcp.client.stdio import stdio_client

async def analyze_cheat_tables():
    # Browse available tables
    tables = await session.call_tool("list_cheat_tables", {})
    print("Available tables:", tables)
    
    # Load specific table
    diablo_data = await session.call_tool("load_cheat_table", {
        "file_path": "C:\\Users\\benam\\Documents\\My Cheat Tables\\Diablo II.CT"
    })
    
    # Extract in CSV format for analysis
    csv_data = await session.call_tool("extract_cheat_table_addresses", {
        "file_path": "C:\\Users\\benam\\Documents\\My Cheat Tables\\Diablo II.CT",
        "address_format": "csv"
    })
    
    # Save to file for external analysis
    with open("diablo_addresses.csv", "w") as f:
        f.write(csv_data)
```

### Command Line Usage
```bash
# Start the enhanced MCP server
python server/main.py

# Run filesystem test client
python clients/cheat_table_filesystem_client.py
```

## Future Enhancements

### Planned Features
- **Watch Mode**: Monitor directory for new cheat tables
- **Backup Integration**: Automatic versioning and backup of tables
- **Template System**: Generate cheat tables from templates
- **Batch Processing**: Process multiple tables simultaneously
- **Enhanced Metadata**: Extract more detailed table information

### Integration Opportunities
- **External Tools**: Integration with other cheat engine utilities
- **Cloud Storage**: Support for cloud-based cheat table repositories
- **Database Integration**: Store and index cheat table metadata
- **Web Interface**: Browser-based cheat table management

## Conclusion

The filesystem integration enhancement transforms the MCP Cheat Engine Server from a memory analysis tool into a comprehensive cheat table management platform. By providing direct filesystem access, multiple output formats, and seamless integration capabilities, it enables efficient workflow automation and powerful analysis capabilities for cheat engine users and developers.
