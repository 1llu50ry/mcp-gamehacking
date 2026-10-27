"""
Cheat Engine Table Parser
Handles reading, writing, and parsing .CT (Cheat Table) files
Supports backup creation and comprehensive file operations
"""

import struct
import logging
import shutil
import time
from typing import Dict, List, Optional, Any, BinaryIO
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET
from datetime import datetime

logger = logging.getLogger(__name__)

@dataclass
class CheatEntry:
    """Represents a single cheat entry"""
    id: str
    description: str
    address: Optional[int] = None
    address_string: Optional[str] = None  # For module+offset addresses like "D2GAME.dll+1107B8"
    offsets: List[int] = None
    variable_type: str = "4 Bytes"
    value: Any = None
    enabled: bool = False
    hotkey: Optional[str] = None
    script: Optional[str] = None
    group_header: bool = False
    
    def __post_init__(self):
        if self.offsets is None:
            self.offsets = []

@dataclass
class StructureElement:
    """Represents a single element in a structure"""
    offset: int
    vartype: str
    bytesize: int
    description: str
    display_method: str = "unsigned integer"
    child_struct: Optional[str] = None

@dataclass
class Structure:
    """Represents a cheat engine structure definition"""
    name: str
    auto_fill: bool = False
    auto_create: bool = True
    default_hex: bool = False
    auto_destroy: bool = False
    elements: List[StructureElement] = None
    
    def __post_init__(self):
        if self.elements is None:
            self.elements = []

@dataclass
class DisassemblerComment:
    """Represents a disassembler comment"""
    address: str
    comment: str

@dataclass
class CheatTable:
    """Represents a complete cheat table with all components preserved"""
    title: str = "Cheat Table"
    target_process: str = ""
    entries: List[CheatEntry] = None
    structures: List[Structure] = None
    lua_script: Optional[str] = None
    disassembler_comments: List[DisassemblerComment] = None
    # Preserve the original XML tree for exact reconstruction
    _original_xml_root: Optional[ET.Element] = None
    _original_xml_content: Optional[str] = None
    
    def __post_init__(self):
        if self.entries is None:
            self.entries = []
        if self.structures is None:
            self.structures = []
        if self.disassembler_comments is None:
            self.disassembler_comments = []

@dataclass
class AddressList:
    """Collection of cheat entries and enhanced data"""
    entries: List[CheatEntry]
    title: str = "Cheat Table"
    target_process: str = ""
    structures: List[Structure] = None
    lua_script: Optional[str] = None
    disassembler_comments: List[DisassemblerComment] = None
    
    def __post_init__(self):
        if self.entries is None:
            self.entries = []
        if self.structures is None:
            self.structures = []
        if self.disassembler_comments is None:
            self.disassembler_comments = []

class CheatTableParser:
    """Parser for Cheat Engine .CT files with complete XML preservation"""
    
    def __init__(self):
        self.type_map = {
            "Binary": "binary",
            "Byte": "byte", 
            "2 Bytes": "word",
            "4 Bytes": "dword",
            "8 Bytes": "qword",
            "Float": "float",
            "Double": "double",
            "String": "string",
            "Array of byte": "aob",
        }
    
    def parse_file(self, file_path: str) -> Optional['CheatTable']:
        """
        Parse a .CT file and return a complete CheatTable object
        Preserves all original XML structure for exact reconstruction
        
        Args:
            file_path: Path to the .CT file
            
        Returns:
            CheatTable object or None if parsing failed
        """
        try:
            if not Path(file_path).exists():
                logger.error(f"Cheat table file not found: {file_path}")
                return None
            
            # Try to determine if it's binary or XML format
            with open(file_path, 'rb') as f:
                header = f.read(1024)  # Read more data for better detection
                f.seek(0)
                
                # Check for XML indicators
                if (b'<?xml' in header or 
                    b'<CheatTable' in header or 
                    b'<CheatEntries' in header):
                    # XML format (newer CE versions)
                    return self._parse_xml_format(f)
                else:
                    # Binary format (older CE versions)
                    return self._parse_binary_format_to_cheattable(f)
                    
        except Exception as e:
            logger.error(f"Error parsing cheat table {file_path}: {e}")
            return None
    
    def _parse_xml_format(self, file_handle: BinaryIO) -> Optional['CheatTable']:
        """Parse XML format .CT file and preserve complete structure"""
        try:
            # Read the entire file as text for XML parsing
            file_handle.seek(0)
            content = file_handle.read().decode('utf-8', errors='ignore')
            
            # Parse XML
            root = ET.fromstring(content)
            
            # Find CheatTable root element
            if root.tag != 'CheatTable':
                cheat_table = root.find('.//CheatTable')
                if cheat_table is None:
                    logger.error("No CheatTable element found")
                    return None
                root = cheat_table
            
            # Create CheatTable object and preserve original XML
            cheat_table = CheatTable()
            cheat_table._original_xml_root = root
            cheat_table._original_xml_content = content
            
            # Parse header information
            title = "Cheat Table"
            target_process = ""
            
            # Look for table info
            for child in root:
                if child.tag == 'CheatTableInfo':
                    title_elem = child.find('Title')
                    if title_elem is not None and title_elem.text:
                        title = title_elem.text
                
                elif child.tag == 'Options':
                    # Parse options if available
                    pass
            
            cheat_table.title = title
            cheat_table.target_process = target_process
            
            # Parse cheat entries
            entries = []
            
            # Look for CheatEntries container or direct CheatEntry elements
            cheat_entries_elem = root.find('CheatEntries')
            if cheat_entries_elem is not None:
                # Entries are in a CheatEntries container
                entry_elements = cheat_entries_elem.findall('CheatEntry')
            else:
                # Look for direct CheatEntry elements
                entry_elements = root.findall('CheatEntry')
            
            logger.info(f"Found {len(entry_elements)} cheat entries to parse")
            
            for entry_elem in entry_elements:
                entry = self._parse_xml_entry(entry_elem)
                if entry:
                    entries.append(entry)
                    
                    # Also parse child entries if they exist
                    child_entries = self._parse_xml_child_entries(entry_elem)
                    if child_entries:
                        entries.extend(child_entries)
            
            cheat_table.entries = entries
            
            # Parse structures
            structures = []
            structures_elem = root.find('Structures')
            if structures_elem is not None:
                logger.info("Found Structures section")
                structures = self._parse_structures(structures_elem)
            
            cheat_table.structures = structures
            
            # Parse Lua script
            lua_script = None
            lua_elem = root.find('LuaScript')
            if lua_elem is not None and lua_elem.text:
                lua_script = lua_elem.text.strip()
                logger.info(f"Found Lua script: {len(lua_script)} characters")
            
            cheat_table.lua_script = lua_script
            
            # Parse disassembler comments
            disassembler_comments = []
            comments_elem = root.find('DisassemblerComments')
            if comments_elem is not None:
                logger.info("Found DisassemblerComments section")
                disassembler_comments = self._parse_disassembler_comments(comments_elem)
            
            cheat_table.disassembler_comments = disassembler_comments
            
            logger.info(f"Successfully parsed cheat table: {len(entries)} entries, {len(structures)} structures, "
                       f"lua_script: {'yes' if lua_script else 'no'}, {len(disassembler_comments)} comments")
            
            return cheat_table
            
        except Exception as e:
            logger.error(f"Error parsing XML format: {e}")
            return None
    
    def _parse_binary_format_to_cheattable(self, file_handle: BinaryIO) -> Optional['CheatTable']:
        """Parse binary format .CT file and convert to CheatTable"""
        # Use existing binary parsing logic and convert to CheatTable
        address_list = self._parse_binary_format(file_handle)
        if address_list:
            cheat_table = CheatTable(
                title=address_list.title,
                target_process=address_list.target_process,
                entries=address_list.entries
            )
            if hasattr(address_list, 'structures'):
                cheat_table.structures = address_list.structures
            if hasattr(address_list, 'lua_script'):
                cheat_table.lua_script = address_list.lua_script
            if hasattr(address_list, 'disassembler_comments'):
                cheat_table.disassembler_comments = address_list.disassembler_comments
            return cheat_table
        return None
        """Parse a .CT file and return the address list
        
        Args:
            file_path: Path to the .CT file
            
        Returns:
            AddressList object or None if parsing failed
        """
        try:
            if not Path(file_path).exists():
                logger.error(f"Cheat table file not found: {file_path}")
                return None
            
            # Try to determine if it's binary or XML format
            with open(file_path, 'rb') as f:
                header = f.read(1024)  # Read more data for better detection
                f.seek(0)
                
                # Check for XML indicators
                if (b'<?xml' in header or 
                    b'<CheatTable' in header or 
                    b'<CheatEntries' in header):
                    # XML format (newer CE versions)
                    return self._parse_xml_format(f)
                else:
                    # Binary format (older CE versions)
                    return self._parse_binary_format(f)
                    
        except Exception as e:
            logger.error(f"Error parsing cheat table {file_path}: {e}")
            return None
    
    
    def _parse_xml_child_entries(self, parent_elem: ET.Element) -> List[CheatEntry]:
        """Parse child cheat entries from XML elements"""
        entries = []
        
        child_entries_elem = parent_elem.find('CheatEntries')
        if child_entries_elem is not None:
            for entry_elem in child_entries_elem.findall('CheatEntry'):
                entry = self._parse_xml_entry(entry_elem)
                if entry:
                    entries.append(entry)
                    
                    # Recursively parse nested child entries
                    nested_entries = self._parse_xml_child_entries(entry_elem)
                    if nested_entries:
                        entries.extend(nested_entries)
        
        return entries
    
    def _parse_structures(self, structures_elem: ET.Element) -> List[Structure]:
        """Parse structures from XML elements"""
        structures = []
        
        for struct_elem in structures_elem.findall('Structure'):
            try:
                name = struct_elem.get('Name', 'Unknown')
                auto_fill = struct_elem.get('AutoFill', '0') == '1'
                auto_create = struct_elem.get('AutoCreate', '1') == '1'
                default_hex = struct_elem.get('DefaultHex', '0') == '1'
                auto_destroy = struct_elem.get('AutoDestroy', '0') == '1'
                
                # Parse elements
                elements = []
                elements_elem = struct_elem.find('Elements')
                if elements_elem is not None:
                    for element_elem in elements_elem.findall('Element'):
                        try:
                            offset_str = element_elem.get('Offset', '0')
                            # Handle hexadecimal offsets (e.g., '0x0', '0x10', etc.)
                            if offset_str.startswith('0x'):
                                offset = int(offset_str, 16)
                            else:
                                offset = int(offset_str)
                            vartype = element_elem.get('Vartype', '4 Bytes')
                            bytesize = int(element_elem.get('Bytesize', '4'))
                            description = element_elem.get('Description', 'Unknown')
                            display_method = element_elem.get('DisplayMethod', 'unsigned integer')
                            child_struct = element_elem.get('ChildStruct')
                            
                            element = StructureElement(
                                offset=offset,
                                vartype=vartype,
                                bytesize=bytesize,
                                description=description,
                                display_method=display_method,
                                child_struct=child_struct
                            )
                            elements.append(element)
                            
                        except (ValueError, TypeError) as e:
                            logger.warning(f"Error parsing structure element: {e}")
                            continue
                
                structure = Structure(
                    name=name,
                    auto_fill=auto_fill,
                    auto_create=auto_create,
                    default_hex=default_hex,
                    auto_destroy=auto_destroy,
                    elements=elements
                )
                structures.append(structure)
                
            except Exception as e:
                logger.warning(f"Error parsing structure: {e}")
                continue
        
        return structures
    
    def _parse_disassembler_comments(self, disassembler_elem: ET.Element) -> List[DisassemblerComment]:
        """Parse disassembler comments from XML elements"""
        comments = []
        
        for comment_elem in disassembler_elem.findall('DisassemblerComment'):
            try:
                address_elem = comment_elem.find('Address')
                comment_text_elem = comment_elem.find('Comment')
                
                if address_elem is not None and comment_text_elem is not None:
                    address = address_elem.text.strip() if address_elem.text else ""
                    comment_text = comment_text_elem.text.strip() if comment_text_elem.text else ""
                    
                    # Clean up address format (remove quotes)
                    address = address.strip('"\'')
                    
                    comment = DisassemblerComment(
                        address=address,
                        comment=comment_text
                    )
                    comments.append(comment)
                    
            except Exception as e:
                logger.warning(f"Error parsing disassembler comment: {e}")
                continue
        
        return comments
    
    def _parse_xml_entry(self, entry_elem: ET.Element) -> Optional[CheatEntry]:
        """Parse a single cheat entry from XML"""
        try:
            # Get basic attributes
            entry_id = self._get_xml_text(entry_elem, 'ID', '')
            description = self._get_xml_text(entry_elem, 'Description', 'Unknown')
            
            # Remove quotes from description if present
            description = description.strip('"\'')
            
            # Check if it's a group header
            group_header = entry_elem.get('GroupHeader', '0') == '1'
            
            # Parse address information
            address_text = self._get_xml_text(entry_elem, 'Address')
            address = None
            address_string = None
            
            if address_text:
                # Handle module-relative addresses like "D2GAME.dll+1107B8"
                if '+' in address_text:
                    # Store the original address text for module+offset addresses
                    address_string = address_text
                else:
                    # Try to parse as direct address
                    address = self._parse_address(address_text)
            
            # Parse offsets
            offsets = []
            offsets_elem = entry_elem.find('Offsets')
            if offsets_elem is not None:
                for offset_elem in offsets_elem.findall('Offset'):
                    if offset_elem.text and offset_elem.text.strip():
                        try:
                            offset_text = offset_elem.text.strip()
                            if offset_text.startswith('0x'):
                                offset_val = int(offset_text, 16)
                            else:
                                offset_val = int(offset_text, 16)  # Assume hex without 0x prefix
                            offsets.append(offset_val)
                        except ValueError:
                            logger.warning(f"Failed to parse offset: {offset_elem.text}")
                            continue
            
            # Parse variable type
            var_type = self._get_xml_text(entry_elem, 'VariableType', '4 Bytes')
            
            # Parse ShowAsSigned
            show_signed = self._get_xml_text(entry_elem, 'ShowAsSigned', '0') == '1'
            
            # Parse ShowAsHex
            show_hex = self._get_xml_text(entry_elem, 'ShowAsHex', '0') == '1'
            
            # Parse value
            value = None
            value_elem = entry_elem.find('LastState')
            if value_elem is not None and value_elem.get('Value'):
                value = value_elem.get('Value')
            
            # Parse enabled state
            enabled = entry_elem.get('Enabled', '0') == '1'
            
            # Parse hotkey
            hotkey = None
            hotkey_elem = entry_elem.find('Hotkeys/Hotkey')
            if hotkey_elem is not None:
                hotkey = hotkey_elem.get('Keys', '')
            
            # Parse script
            script = None
            script_elem = entry_elem.find('LuaScript')
            if script_elem is not None and script_elem.text:
                script = script_elem.text.strip()
            
            # Create entry with additional metadata
            entry = CheatEntry(
                id=entry_id,
                description=description,
                address=address,
                address_string=address_string,
                offsets=offsets,
                variable_type=var_type,
                value=value,
                enabled=enabled,
                hotkey=hotkey,
                script=script,
                group_header=group_header
            )
            
            # Store additional metadata as attributes
            entry.show_signed = show_signed
            entry.show_hex = show_hex
            entry.original_address = address_text
            
            return entry
            
        except Exception as e:
            logger.warning(f"Error parsing XML entry: {e}")
            return None
    
    def _get_xml_text(self, parent: ET.Element, tag: str, default: str = '') -> str:
        """Get text content from XML element"""
        elem = parent.find(tag)
        if elem is not None and elem.text:
            return elem.text.strip()
        return default
    
    def _parse_binary_format(self, file_handle: BinaryIO) -> Optional[AddressList]:
        """Parse binary format .CT file (older Cheat Engine versions)"""
        try:
            # This is a simplified parser for older binary format
            # The exact format varies by CE version and can be complex
            logger.warning("Binary .CT format parsing has limited support")
            
            # Try to read header
            file_handle.seek(0)
            data = file_handle.read()
            
            # Look for text patterns that might indicate addresses/descriptions
            entries = []
            
            # Simple heuristic: look for potential address patterns
            import re
            
            # Look for hex addresses in the binary data
            address_pattern = rb'[0-9A-Fa-f]{8}'
            matches = re.finditer(address_pattern, data)
            
            for i, match in enumerate(matches):
                if i >= 50:  # Limit results
                    break
                
                try:
                    addr_str = match.group().decode('ascii')
                    address = int(addr_str, 16)
                    
                    entry = CheatEntry(
                        id=f"binary_entry_{i}",
                        description=f"Address from binary table",
                        address=address,
                        variable_type="4 Bytes"
                    )
                    entries.append(entry)
                    
                except (ValueError, UnicodeDecodeError):
                    continue
            
            return AddressList(
                entries=entries,
                title="Binary Cheat Table",
                target_process=""
            )
            
        except Exception as e:
            logger.error(f"Error parsing binary format: {e}")
            return None
    
    def _parse_address(self, address_str: str) -> Optional[int]:
        """Parse an address string to integer"""
        try:
            if not address_str:
                return None
            
            address_str = address_str.strip()
            
            # Handle different address formats
            if address_str.startswith('0x'):
                return int(address_str, 16)
            elif address_str.startswith('$'):
                return int(address_str[1:], 16)
            elif all(c in '0123456789ABCDEFabcdef' for c in address_str):
                return int(address_str, 16)
            else:
                # Might be a symbolic address or expression
                return None
                
        except ValueError:
            return None
    
    def export_to_dict(self, address_list: AddressList) -> Dict[str, Any]:
        """Export address list to dictionary format"""
        return {
            'title': address_list.title,
            'target_process': address_list.target_process,
            'entries': [
                {
                    'id': entry.id,
                    'description': entry.description,
                    'address': entry.address_string if entry.address_string else (f"0x{entry.address:08X}" if entry.address else None),
                    'offsets': [f"0x{offset:X}" for offset in entry.offsets],
                    'variable_type': entry.variable_type,
                    'value': entry.value,
                    'enabled': entry.enabled,
                    'hotkey': entry.hotkey,
                    'has_script': entry.script is not None,
                    'group_header': entry.group_header
                }
                for entry in address_list.entries
            ]
        }
    
    def create_mcp_tools_from_table(self, address_list: AddressList) -> List[Dict[str, Any]]:
        """Create MCP tool definitions from cheat table entries
        
        Args:
            address_list: Parsed cheat table
            
        Returns:
            List of MCP tool definitions
        """
        tools = []
        
        for entry in address_list.entries:
            if entry.group_header or (not entry.address and not entry.address_string):
                continue
            
            # Create a read tool for this entry
            tool_name = f"read_{entry.id}" if entry.id else f"read_entry_{len(tools)}"
            tool_name = self._sanitize_tool_name(tool_name)
            
            tool_def = {
                "name": tool_name,
                "description": f"Read {entry.description} ({entry.variable_type})",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                },
                "metadata": {
                    "cheat_entry": {
                        "address": entry.address_string if entry.address_string else entry.address,
                        "offsets": entry.offsets,
                        "type": entry.variable_type,
                        "description": entry.description
                    }
                }
            }
            
            tools.append(tool_def)
        
        return tools
    
    def _sanitize_tool_name(self, name: str) -> str:
        """Sanitize a tool name for MCP compatibility"""
        import re
        # Replace invalid characters with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name)
        # Ensure it starts with a letter or underscore
        if sanitized and sanitized[0].isdigit():
            sanitized = 'entry_' + sanitized
        return sanitized or 'unnamed_entry'
    
    def get_summary(self, address_list: AddressList) -> Dict[str, Any]:
        """Get a summary of the cheat table"""
        entry_types = {}
        enabled_count = 0
        script_count = 0
        group_count = 0
        
        for entry in address_list.entries:
            # Count by type
            var_type = entry.variable_type
            entry_types[var_type] = entry_types.get(var_type, 0) + 1
            
            # Count enabled entries
            if entry.enabled:
                enabled_count += 1
            
            # Count scripts
            if entry.script:
                script_count += 1
            
            # Count groups
            if entry.group_header:
                group_count += 1
        
        return {
            'title': address_list.title,
            'target_process': address_list.target_process,
            'total_entries': len(address_list.entries),
            'enabled_entries': enabled_count,
            'group_headers': group_count,
            'script_entries': script_count,
            'entry_types': entry_types,
            'has_offsets': sum(1 for e in address_list.entries if e.offsets),
            'has_hotkeys': sum(1 for e in address_list.entries if e.hotkey)
        }
    
    def create_backup(self, file_path: str) -> str:
        """
        Create a backup of the cheat table file
        
        Args:
            file_path: Path to the original .CT file
            
        Returns:
            Path to the backup file
        """
        try:
            original_path = Path(file_path)
            if not original_path.exists():
                raise FileNotFoundError(f"Original file not found: {file_path}")
            
            # Create backup filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{original_path.stem}_backup_{timestamp}{original_path.suffix}"
            backup_path = original_path.parent / backup_name
            
            # Copy the file
            shutil.copy2(file_path, backup_path)
            logger.info(f"Backup created: {backup_path}")
            
            return str(backup_path)
            
        except Exception as e:
            logger.error(f"Error creating backup for {file_path}: {e}")
            raise
    
    def add_address_to_table(self, file_path: str, new_entry: CheatEntry, create_backup: bool = True) -> bool:
        """
        Add a new address entry to an existing cheat table
        
        Args:
            file_path: Path to the .CT file
            new_entry: CheatEntry object to add
            create_backup: Whether to create a backup before modifying
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if create_backup:
                self.create_backup(file_path)
            
            # Load existing table
            address_list = self.parse_file(file_path)
            if not address_list:
                logger.error(f"Could not load existing table: {file_path}")
                return False
            
            # Add new entry
            address_list.entries.append(new_entry)
            
            # Write back to file
            return self.write_table_to_file(file_path, address_list)
            
        except Exception as e:
            logger.error(f"Error adding address to table {file_path}: {e}")
            return False
    
    def write_table_to_file(self, file_path: str, address_list: 'AddressList') -> bool:
        """
        Write an AddressList to a .CT file in XML format
        
        Args:
            file_path: Path to write the .CT file
            address_list: AddressList object to write
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Create XML structure
            root = ET.Element("CheatTable")
            
            # Add CheatEntries section
            cheat_entries = ET.SubElement(root, "CheatEntries")
            
            for entry in address_list.entries:
                self._write_cheat_entry_xml(cheat_entries, entry)
            
            # Add structures if available
            if hasattr(address_list, 'structures') and address_list.structures:
                structures_elem = ET.SubElement(root, "Structures")
                for structure in address_list.structures:
                    self._write_structure_xml(structures_elem, structure)
            
            # Add Lua script if available
            if hasattr(address_list, 'lua_script') and address_list.lua_script:
                lua_elem = ET.SubElement(root, "LuaScript")
                lua_elem.text = address_list.lua_script
            
            # Add disassembler comments if available
            if hasattr(address_list, 'disassembler_comments') and address_list.disassembler_comments:
                comments_elem = ET.SubElement(root, "DisassemblerComments")
                for comment in address_list.disassembler_comments:
                    self._write_disassembler_comment_xml(comments_elem, comment)
            
            # Format XML with proper indentation
            self._indent_xml(root)
            
            # Write to file
            tree = ET.ElementTree(root)
            tree.write(file_path, encoding='utf-8', xml_declaration=True)
            
            logger.info(f"Successfully wrote cheat table to: {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error writing table to file {file_path}: {e}")
            return False
    
    def _write_cheat_entry_xml(self, parent: ET.Element, entry: CheatEntry) -> None:
        """Write a single CheatEntry to XML"""
        cheat_entry = ET.SubElement(parent, "CheatEntry")
        
        # Basic properties
        ET.SubElement(cheat_entry, "ID").text = str(entry.id)
        ET.SubElement(cheat_entry, "Description").text = entry.description or ""
        
        # Handle both numeric addresses and module+offset addresses
        if entry.address_string:
            # Module+offset address (e.g., "D2GAME.dll+1107B8")
            ET.SubElement(cheat_entry, "Address").text = entry.address_string
        elif entry.address is not None:
            # Numeric address
            ET.SubElement(cheat_entry, "Address").text = hex(entry.address)
        
        ET.SubElement(cheat_entry, "VariableType").text = entry.variable_type
        
        if entry.offsets:
            offsets_elem = ET.SubElement(cheat_entry, "Offsets")
            for offset in entry.offsets:
                ET.SubElement(offsets_elem, "Offset").text = hex(offset)
        
        if entry.value is not None:
            ET.SubElement(cheat_entry, "Value").text = str(entry.value)
        
        if entry.enabled:
            ET.SubElement(cheat_entry, "Enabled").text = "1"
        
        if entry.hotkey:
            ET.SubElement(cheat_entry, "Hotkey").text = entry.hotkey
        
        if entry.script:
            ET.SubElement(cheat_entry, "Script").text = entry.script
        
        if entry.group_header:
            ET.SubElement(cheat_entry, "GroupHeader").text = "1"
    
    def _write_structure_xml(self, parent: ET.Element, structure: Structure) -> None:
        """Write a Structure to XML"""
        struct_elem = ET.SubElement(parent, "Structure")
        struct_elem.set("Name", structure.name)
        struct_elem.set("AutoFill", "1" if structure.auto_fill else "0")
        struct_elem.set("AutoCreate", "1" if structure.auto_create else "0")
        struct_elem.set("DefaultHex", "1" if structure.default_hex else "0")
        struct_elem.set("AutoDestroy", "1" if structure.auto_destroy else "0")
        
        elements_elem = ET.SubElement(struct_elem, "Elements")
        for element in structure.elements:
            elem = ET.SubElement(elements_elem, "Element")
            elem.set("Offset", hex(element.offset))
            elem.set("Vartype", element.vartype)
            elem.set("Bytesize", str(element.bytesize))
            elem.set("Description", element.description)
            elem.set("DisplayMethod", element.display_method)
            if element.child_struct:
                elem.set("ChildStruct", element.child_struct)
    
    def _write_disassembler_comment_xml(self, parent: ET.Element, comment: 'DisassemblerComment') -> None:
        """Write a DisassemblerComment to XML"""
        comment_elem = ET.SubElement(parent, "Comment")
        comment_elem.set("Address", comment.address)
        comment_elem.text = comment.comment
    
    def _indent_xml(self, elem: ET.Element, level: int = 0) -> None:
        """Add proper indentation to XML for readability"""
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for elem in elem:
                self._indent_xml(elem, level + 1)
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i
    
    def modify_address_in_table(self, file_path: str, entry_id: str, updated_entry: CheatEntry, create_backup: bool = True) -> bool:
        """
        Modify an existing address entry in a cheat table
        
        Args:
            file_path: Path to the .CT file
            entry_id: ID of the entry to modify
            updated_entry: Updated CheatEntry object
            create_backup: Whether to create a backup before modifying
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if create_backup:
                self.create_backup(file_path)
            
            # Load existing table
            address_list = self.parse_file(file_path)
            if not address_list:
                logger.error(f"Could not load existing table: {file_path}")
                return False
            
            # Find and update entry
            found = False
            for i, entry in enumerate(address_list.entries):
                if entry.id == entry_id:
                    address_list.entries[i] = updated_entry
                    found = True
                    break
            
            if not found:
                logger.error(f"Entry with ID {entry_id} not found")
                return False
            
            # Write back to file
            return self.write_table_to_file(file_path, address_list)
            
        except Exception as e:
            logger.error(f"Error modifying address in table {file_path}: {e}")
            return False
    
    def remove_address_from_table(self, file_path: str, entry_id: str, create_backup: bool = True) -> bool:
        """
        Remove an address entry from a cheat table
        
        Args:
            file_path: Path to the .CT file
            entry_id: ID of the entry to remove
            create_backup: Whether to create a backup before modifying
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if create_backup:
                self.create_backup(file_path)
            
            # Load existing table
            address_list = self.parse_file(file_path)
            if not address_list:
                logger.error(f"Could not load existing table: {file_path}")
                return False
            
            # Find and remove entry
            original_count = len(address_list.entries)
            address_list.entries = [entry for entry in address_list.entries if entry.id != entry_id]
            
            if len(address_list.entries) == original_count:
                logger.error(f"Entry with ID {entry_id} not found")
                return False
            
            # Write back to file
            return self.write_table_to_file(file_path, address_list)
            
        except Exception as e:
            logger.error(f"Error removing address from table {file_path}: {e}")
            return False
    
    def create_new_table(self, file_path: str, title: str = "New Cheat Table", target_process: str = "") -> bool:
        """
        Create a new empty cheat table file
        
        Args:
            file_path: Path where to create the .CT file
            title: Title for the cheat table
            target_process: Target process name
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Create empty AddressList
            address_list = AddressList(
                title=title,
                target_process=target_process,
                entries=[]
            )
            
            # Write to file
            return self.write_table_to_file(file_path, address_list)
            
        except Exception as e:
            logger.error(f"Error creating new table {file_path}: {e}")
            return False
    
    def write_cheat_table_preserving_structure(self, file_path: str, cheat_table: 'CheatTable') -> bool:
        """
        Write a CheatTable to file while preserving original XML structure
        Only modifies the parts that have been changed
        
        Args:
            file_path: Path to write the .CT file
            cheat_table: CheatTable object to write
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if cheat_table._original_xml_root is not None:
                # Use original XML structure and modify only changed parts
                return self._write_preserving_original_xml(file_path, cheat_table)
            else:
                # Create new XML structure
                return self._write_new_xml_structure(file_path, cheat_table)
                
        except Exception as e:
            logger.error(f"Error writing cheat table to file {file_path}: {e}")
            return False
    
    def _write_preserving_original_xml(self, file_path: str, cheat_table: 'CheatTable') -> bool:
        """Write using original XML structure, modifying only changed parts"""
        try:
            # Create a copy of the original XML root
            import copy
            root = copy.deepcopy(cheat_table._original_xml_root)
            
            # Update CheatEntries section
            cheat_entries_elem = root.find('CheatEntries')
            if cheat_entries_elem is not None:
                # Clear existing entries and add updated ones
                cheat_entries_elem.clear()
                for entry in cheat_table.entries:
                    self._write_cheat_entry_xml(cheat_entries_elem, entry)
            else:
                # Create CheatEntries section if it doesn't exist
                cheat_entries_elem = ET.SubElement(root, 'CheatEntries')
                for entry in cheat_table.entries:
                    self._write_cheat_entry_xml(cheat_entries_elem, entry)
            
            # Update Structures section if modified
            structures_elem = root.find('Structures')
            if cheat_table.structures:
                if structures_elem is None:
                    structures_elem = ET.SubElement(root, 'Structures')
                else:
                    structures_elem.clear()
                
                for structure in cheat_table.structures:
                    self._write_structure_xml(structures_elem, structure)
            
            # Update Lua script if modified
            lua_elem = root.find('LuaScript')
            if cheat_table.lua_script:
                if lua_elem is None:
                    lua_elem = ET.SubElement(root, 'LuaScript')
                lua_elem.text = cheat_table.lua_script
            
            # Update disassembler comments if modified
            comments_elem = root.find('DisassemblerComments')
            if cheat_table.disassembler_comments:
                if comments_elem is None:
                    comments_elem = ET.SubElement(root, 'DisassemblerComments')
                else:
                    comments_elem.clear()
                
                for comment in cheat_table.disassembler_comments:
                    self._write_disassembler_comment_xml(comments_elem, comment)
            
            # Preserve XML formatting
            self._preserve_xml_formatting(root)
            
            # Write to file with original encoding and declaration
            tree = ET.ElementTree(root)
            
            # Try to preserve original XML declaration
            if cheat_table._original_xml_content and cheat_table._original_xml_content.startswith('<?xml'):
                # Extract and preserve original XML declaration
                xml_decl_end = cheat_table._original_xml_content.find('?>') + 2
                xml_declaration = cheat_table._original_xml_content[:xml_decl_end]
                
                # Write with preserved declaration
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(xml_declaration + '\n')
                    tree.write(f, encoding='unicode', xml_declaration=False)
            else:
                tree.write(file_path, encoding='utf-8', xml_declaration=True)
            
            logger.info(f"Successfully wrote cheat table preserving structure to: {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error writing with preserved structure: {e}")
            return False
    
    def _write_new_xml_structure(self, file_path: str, cheat_table: 'CheatTable') -> bool:
        """Write using new XML structure"""
        try:
            # Create XML structure
            root = ET.Element("CheatTable")
            
            # Add CheatEntries section
            cheat_entries = ET.SubElement(root, "CheatEntries")
            
            for entry in cheat_table.entries:
                self._write_cheat_entry_xml(cheat_entries, entry)
            
            # Add structures if available
            if cheat_table.structures:
                structures_elem = ET.SubElement(root, "Structures")
                for structure in cheat_table.structures:
                    self._write_structure_xml(structures_elem, structure)
            
            # Add Lua script if available
            if cheat_table.lua_script:
                lua_elem = ET.SubElement(root, "LuaScript")
                lua_elem.text = cheat_table.lua_script
            
            # Add disassembler comments if available
            if cheat_table.disassembler_comments:
                comments_elem = ET.SubElement(root, "DisassemblerComments")
                for comment in cheat_table.disassembler_comments:
                    self._write_disassembler_comment_xml(comments_elem, comment)
            
            # Format XML with proper indentation
            self._indent_xml(root)
            
            # Write to file
            tree = ET.ElementTree(root)
            tree.write(file_path, encoding='utf-8', xml_declaration=True)
            
            logger.info(f"Successfully wrote new cheat table structure to: {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error writing new XML structure: {e}")
            return False
    
    def _preserve_xml_formatting(self, elem: ET.Element, level: int = 0) -> None:
        """Preserve XML formatting similar to original"""
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for child in elem:
                self._preserve_xml_formatting(child, level + 1)
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i
    
    def add_address_to_cheat_table(self, file_path: str, new_entry: CheatEntry, create_backup: bool = True) -> bool:
        """
        Add a new address entry to an existing cheat table with structure preservation
        
        Args:
            file_path: Path to the .CT file
            new_entry: CheatEntry object to add
            create_backup: Whether to create a backup before modifying
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if create_backup:
                self.create_backup(file_path)
            
            # Load existing table with full structure preservation
            cheat_table = self.parse_file(file_path)
            if not cheat_table:
                logger.error(f"Could not load existing table: {file_path}")
                return False
            
            # Add new entry
            cheat_table.entries.append(new_entry)
            
            # Write back to file preserving structure
            return self.write_cheat_table_preserving_structure(file_path, cheat_table)
            
        except Exception as e:
            logger.error(f"Error adding address to table {file_path}: {e}")
            return False
    
    def parse_file_to_addresslist(self, file_path: str) -> Optional['AddressList']:
        """
        Parse a .CT file and return an AddressList object (for backwards compatibility)
        
        Args:
            file_path: Path to the .CT file
            
        Returns:
            AddressList object or None if parsing failed
        """
        cheat_table = self.parse_file(file_path)
        if cheat_table:
            return self._convert_cheattable_to_addresslist(cheat_table)
        return None
    
    def _convert_cheattable_to_addresslist(self, cheat_table: 'CheatTable') -> 'AddressList':
        """Convert CheatTable to AddressList for backwards compatibility"""
        address_list = AddressList(
            title=cheat_table.title,
            target_process=cheat_table.target_process,
            entries=cheat_table.entries
        )
        address_list.structures = cheat_table.structures
        address_list.lua_script = cheat_table.lua_script
        address_list.disassembler_comments = cheat_table.disassembler_comments
        return address_list
