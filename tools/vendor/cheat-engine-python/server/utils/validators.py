"""
Validation Utilities
Input validation and sanitization functions
"""

import re
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

def validate_address(address_str: str) -> Optional[int]:
    """Validate and parse a memory address string
    
    Args:
        address_str: Address string in hex format (e.g., "0x12345678", "12345678")
        
    Returns:
        Parsed address as integer, or None if invalid
    """
    try:
        if not isinstance(address_str, str):
            return None
        
        # Remove whitespace
        address_str = address_str.strip()
        
        if not address_str:
            return None
        
        # Handle different hex formats
        if address_str.startswith('0x') or address_str.startswith('0X'):
            address_str = address_str[2:]
        
        # Validate hex characters
        if not re.match(r'^[0-9A-Fa-f]+$', address_str):
            return None
        
        # Convert to integer
        address = int(address_str, 16)
        
        # Basic sanity checks
        if address < 0:
            return None
        
        # Check reasonable address bounds
        if address > 0x7FFFFFFFFFFFFFFFFFFF:  # 64-bit max
            return None
        
        # Warn about suspicious addresses
        if address < 0x1000:
            logger.warning(f"Address {address:X} is in null page range")
        
        return address
        
    except (ValueError, OverflowError) as e:
        logger.debug(f"Invalid address format '{address_str}': {e}")
        return None

def validate_size(size: Any) -> bool:
    """Validate a size parameter
    
    Args:
        size: Size value to validate
        
    Returns:
        True if valid, False otherwise
    """
    try:
        if not isinstance(size, int):
            if isinstance(size, str):
                size = int(size)
            else:
                return False
        
        # Must be positive
        if size <= 0:
            return False
        
        # Reasonable upper limit (100MB)
        if size > 100 * 1024 * 1024:
            logger.warning(f"Large size requested: {size} bytes")
            return False
        
        return True
        
    except (ValueError, TypeError):
        return False

def validate_pattern(pattern: str) -> bool:
    """Validate a byte pattern string
    
    Args:
        pattern: Pattern string to validate (e.g., "48 8B 05 ?? ?? ?? ??")
        
    Returns:
        True if valid, False otherwise
    """
    try:
        if not isinstance(pattern, str):
            return False
        
        # Remove extra whitespace
        pattern = re.sub(r'\s+', ' ', pattern.strip())
        
        if not pattern:
            return False
        
        # Split into byte components
        bytes_parts = pattern.split(' ')
        
        for byte_part in bytes_parts:
            if byte_part in ['??', '?']:
                continue  # Wildcard is valid
            
            # Must be valid hex byte
            if not re.match(r'^[0-9A-Fa-f]{1,2}$', byte_part):
                return False
            
            # Convert to ensure it's a valid byte value
            byte_val = int(byte_part, 16)
            if byte_val > 255:
                return False
        
        return True
        
    except (ValueError, TypeError):
        return False

def validate_process_identifier(identifier: str) -> bool:
    """Validate a process identifier (PID or name)
    
    Args:
        identifier: Process identifier to validate
        
    Returns:
        True if valid, False otherwise
    """
    try:
        if not isinstance(identifier, str):
            return False
        
        identifier = identifier.strip()
        
        if not identifier:
            return False
        
        # Check if it's a PID (numeric)
        if identifier.isdigit():
            pid = int(identifier)
            return 1 <= pid <= 65535  # Reasonable PID range
        
        # Check if it's a valid process name
        # Allow alphanumeric, underscore, dash, dot
        if re.match(r'^[a-zA-Z0-9_\-\.]+$', identifier):
            return len(identifier) <= 255  # Reasonable name length
        
        return False
        
    except (ValueError, TypeError):
        return False

def validate_data_type(data_type: str) -> bool:
    """Validate a data type string
    
    Args:
        data_type: Data type to validate
        
    Returns:
        True if valid, False otherwise
    """
    valid_types = {
        'raw', 'bytes',
        'int8', 'uint8', 'byte',
        'int16', 'uint16', 'short', 'ushort',
        'int32', 'uint32', 'int', 'uint', 'dword',
        'int64', 'uint64', 'long', 'ulong', 'qword',
        'float', 'single',
        'double',
        'string', 'str', 'ascii', 'utf8', 'utf16',
        'pointer', 'ptr',
        'auto', 'structure', 'struct'
    }
    
    if not isinstance(data_type, str):
        return False
    
    return data_type.lower() in valid_types

def sanitize_filename(filename: str) -> str:
    """Sanitize a filename for safe file operations
    
    Args:
        filename: Filename to sanitize
        
    Returns:
        Sanitized filename
    """
    if not isinstance(filename, str):
        return "invalid_filename"
    
    # Remove or replace invalid characters
    sanitized = re.sub(r'[<>:"/\\|?*]', '_', filename)
    
    # Remove control characters
    sanitized = ''.join(char for char in sanitized if ord(char) >= 32)
    
    # Limit length
    sanitized = sanitized[:255]
    
    # Ensure it's not empty or just dots
    if not sanitized or sanitized in ['.', '..']:
        sanitized = "unnamed_file"
    
    return sanitized

def validate_region_list(regions: Any) -> bool:
    """Validate a list of memory regions
    
    Args:
        regions: Region list to validate
        
    Returns:
        True if valid, False otherwise
    """
    try:
        if not isinstance(regions, list):
            return False
        
        if len(regions) > 100:  # Reasonable limit
            return False
        
        for region in regions:
            if isinstance(region, str):
                # Should be a hex address
                if not validate_address(region):
                    return False
            elif isinstance(region, dict):
                # Should have 'base' and 'size' keys
                if 'base' not in region or 'size' not in region:
                    return False
                if not validate_address(str(region['base'])):
                    return False
                if not validate_size(region['size']):
                    return False
            else:
                return False
        
        return True
        
    except (TypeError, KeyError):
        return False

def validate_config_value(key: str, value: Any) -> bool:
    """Validate a configuration value
    
    Args:
        key: Configuration key
        value: Value to validate
        
    Returns:
        True if valid, False otherwise
    """
    config_validators = {
        'max_memory_read': lambda v: isinstance(v, int) and 0 < v <= 1024 * 1024 * 1024,
        'enable_disassembly': lambda v: isinstance(v, bool),
        'log_level': lambda v: isinstance(v, str) and v.upper() in ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        'read_only_mode': lambda v: isinstance(v, bool),
        'process_whitelist': lambda v: isinstance(v, list) and all(isinstance(p, str) for p in v),
        'audit_log_path': lambda v: isinstance(v, str) and len(v) > 0,
        'symbol_cache_size': lambda v: isinstance(v, int) and v >= 0,
        'scan_chunk_size': lambda v: isinstance(v, int) and 1024 <= v <= 10 * 1024 * 1024,
    }
    
    validator = config_validators.get(key)
    if validator:
        try:
            return validator(value)
        except Exception:
            return False
    
    # Unknown config key - allow but warn
    logger.warning(f"Unknown configuration key: {key}")
    return True

def validate_permissions(access_level: str) -> bool:
    """Validate an access level string
    
    Args:
        access_level: Access level to validate
        
    Returns:
        True if valid, False otherwise
    """
    valid_levels = {'read', 'debug', 'full'}
    
    if not isinstance(access_level, str):
        return False
    
    return access_level.lower() in valid_levels

def validate_encoding(encoding: str) -> bool:
    """Validate a text encoding string
    
    Args:
        encoding: Encoding to validate
        
    Returns:
        True if valid, False otherwise
    """
    valid_encodings = {
        'ascii', 'utf-8', 'utf8', 'utf-16', 'utf16', 'utf-16le', 'utf-16be',
        'latin1', 'cp1252', 'cp437'
    }
    
    if not isinstance(encoding, str):
        return False
    
    return encoding.lower() in valid_encodings

def sanitize_log_message(message: str) -> str:
    """Sanitize a log message to prevent log injection
    
    Args:
        message: Message to sanitize
        
    Returns:
        Sanitized message
    """
    if not isinstance(message, str):
        return str(message)
    
    # Remove newlines and carriage returns to prevent log injection
    sanitized = message.replace('\n', '\\n').replace('\r', '\\r')
    
    # Limit length
    if len(sanitized) > 1000:
        sanitized = sanitized[:997] + "..."
    
    return sanitized
