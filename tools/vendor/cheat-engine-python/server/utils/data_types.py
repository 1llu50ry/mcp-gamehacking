"""
Data Types Module
Common data type definitions and utilities
"""

from dataclasses import dataclass
from typing import Optional, Dict, Any, List, Union
from enum import Enum
import struct

class DataType(Enum):
    """Enumeration of supported data types"""
    UINT8 = "uint8"
    INT8 = "int8"
    UINT16 = "uint16"
    INT16 = "int16"
    UINT32 = "uint32"
    INT32 = "int32"
    UINT64 = "uint64"
    INT64 = "int64"
    FLOAT = "float"
    DOUBLE = "double"
    STRING = "string"
    POINTER = "pointer"
    BYTES = "bytes"

class Architecture(Enum):
    """Target architecture enumeration"""
    X86 = "x86"
    X64 = "x64"
    UNKNOWN = "unknown"

class MemoryProtection(Enum):
    """Memory protection flags"""
    NOACCESS = 0x01
    READONLY = 0x02
    READWRITE = 0x04
    WRITECOPY = 0x08
    EXECUTE = 0x10
    EXECUTE_READ = 0x20
    EXECUTE_READWRITE = 0x40
    EXECUTE_WRITECOPY = 0x80

@dataclass
class ProcessSnapshot:
    """Snapshot of process state"""
    pid: int
    name: str
    timestamp: float
    memory_usage: int
    thread_count: int
    handle_count: Optional[int] = None
    cpu_usage: Optional[float] = None

@dataclass
class MemoryBlock:
    """Represents a block of memory"""
    address: int
    size: int
    data: bytes
    protection: int
    timestamp: float
    
    def contains_address(self, addr: int) -> bool:
        """Check if this block contains the given address"""
        return self.address <= addr < self.address + self.size
    
    def get_offset(self, addr: int) -> Optional[int]:
        """Get offset of address within this block"""
        if self.contains_address(addr):
            return addr - self.address
        return None

@dataclass
class ScanResult:
    """Result of a memory scan operation"""
    address: int
    value: Any
    data_type: DataType
    context: Optional[bytes] = None
    confidence: float = 1.0

@dataclass
class PointerChain:
    """Represents a chain of pointers"""
    base_address: int
    offsets: List[int]
    final_address: int
    valid: bool = True
    
    def __str__(self) -> str:
        """String representation of pointer chain"""
        if not self.offsets:
            return f"0x{self.base_address:08X}"
        
        offset_str = " + ".join(f"0x{offset:X}" for offset in self.offsets)
        return f"[0x{self.base_address:08X} + {offset_str}] -> 0x{self.final_address:08X}"

class DataTypeConverter:
    """Utility class for data type conversions"""
    
    @staticmethod
    def bytes_to_value(data: bytes, data_type: DataType, offset: int = 0) -> Any:
        """Convert bytes to a specific data type"""
        if offset + DataTypeConverter.get_size(data_type) > len(data):
            raise ValueError("Insufficient data for conversion")
        
        chunk = data[offset:offset + DataTypeConverter.get_size(data_type)]
        
        if data_type == DataType.UINT8:
            return chunk[0]
        elif data_type == DataType.INT8:
            return struct.unpack('<b', chunk)[0]
        elif data_type == DataType.UINT16:
            return struct.unpack('<H', chunk)[0]
        elif data_type == DataType.INT16:
            return struct.unpack('<h', chunk)[0]
        elif data_type == DataType.UINT32:
            return struct.unpack('<I', chunk)[0]
        elif data_type == DataType.INT32:
            return struct.unpack('<i', chunk)[0]
        elif data_type == DataType.UINT64:
            return struct.unpack('<Q', chunk)[0]
        elif data_type == DataType.INT64:
            return struct.unpack('<q', chunk)[0]
        elif data_type == DataType.FLOAT:
            return struct.unpack('<f', chunk)[0]
        elif data_type == DataType.DOUBLE:
            return struct.unpack('<d', chunk)[0]
        elif data_type == DataType.STRING:
            # Find null terminator
            null_pos = chunk.find(b'\x00')
            if null_pos != -1:
                chunk = chunk[:null_pos]
            return chunk.decode('utf-8', errors='ignore')
        elif data_type == DataType.BYTES:
            return chunk
        else:
            raise ValueError(f"Unsupported data type: {data_type}")
    
    @staticmethod
    def value_to_bytes(value: Any, data_type: DataType) -> bytes:
        """Convert a value to bytes"""
        if data_type == DataType.UINT8:
            return struct.pack('<B', int(value))
        elif data_type == DataType.INT8:
            return struct.pack('<b', int(value))
        elif data_type == DataType.UINT16:
            return struct.pack('<H', int(value))
        elif data_type == DataType.INT16:
            return struct.pack('<h', int(value))
        elif data_type == DataType.UINT32:
            return struct.pack('<I', int(value))
        elif data_type == DataType.INT32:
            return struct.pack('<i', int(value))
        elif data_type == DataType.UINT64:
            return struct.pack('<Q', int(value))
        elif data_type == DataType.INT64:
            return struct.pack('<q', int(value))
        elif data_type == DataType.FLOAT:
            return struct.pack('<f', float(value))
        elif data_type == DataType.DOUBLE:
            return struct.pack('<d', float(value))
        elif data_type == DataType.STRING:
            return str(value).encode('utf-8') + b'\x00'
        elif data_type == DataType.BYTES:
            return bytes(value)
        else:
            raise ValueError(f"Unsupported data type: {data_type}")
    
    @staticmethod
    def get_size(data_type: DataType) -> int:
        """Get the size in bytes of a data type"""
        sizes = {
            DataType.UINT8: 1,
            DataType.INT8: 1,
            DataType.UINT16: 2,
            DataType.INT16: 2,
            DataType.UINT32: 4,
            DataType.INT32: 4,
            DataType.UINT64: 8,
            DataType.INT64: 8,
            DataType.FLOAT: 4,
            DataType.DOUBLE: 8,
            DataType.POINTER: 8,  # Default to 64-bit
            DataType.STRING: -1,  # Variable length
            DataType.BYTES: -1,   # Variable length
        }
        return sizes.get(data_type, -1)
    
    @staticmethod
    def get_pointer_size(architecture: Architecture) -> int:
        """Get pointer size for architecture"""
        if architecture == Architecture.X64:
            return 8
        elif architecture == Architecture.X86:
            return 4
        else:
            return 8  # Default to 64-bit

class PatternMatcher:
    """Utility for pattern matching operations"""
    
    @staticmethod
    def parse_pattern(pattern: str) -> tuple[bytes, bytes]:
        """Parse a pattern string into pattern and mask bytes
        
        Args:
            pattern: Pattern string like "48 8B 05 ?? ?? ?? ??"
            
        Returns:
            Tuple of (pattern_bytes, mask_bytes)
        """
        import re
        
        # Clean up the pattern
        pattern = re.sub(r'\s+', ' ', pattern.strip().upper())
        parts = pattern.split(' ')
        
        pattern_bytes = bytearray()
        mask_bytes = bytearray()
        
        for part in parts:
            if part in ['??', '?']:
                pattern_bytes.append(0x00)
                mask_bytes.append(0x00)
            else:
                try:
                    byte_val = int(part, 16)
                    pattern_bytes.append(byte_val)
                    mask_bytes.append(0xFF)
                except ValueError:
                    raise ValueError(f"Invalid byte in pattern: {part}")
        
        return bytes(pattern_bytes), bytes(mask_bytes)
    
    @staticmethod
    def match_pattern(data: bytes, pattern: bytes, mask: bytes, offset: int = 0) -> bool:
        """Check if pattern matches at given offset"""
        if offset + len(pattern) > len(data):
            return False
        
        for i in range(len(pattern)):
            if mask[i] == 0xFF:  # Must match exactly
                if data[offset + i] != pattern[i]:
                    return False
        
        return True

class AddressCalculator:
    """Utility for address calculations"""
    
    @staticmethod
    def align_address(address: int, alignment: int) -> int:
        """Align address to specified boundary"""
        return (address + alignment - 1) & ~(alignment - 1)
    
    @staticmethod
    def is_aligned(address: int, alignment: int) -> bool:
        """Check if address is aligned to boundary"""
        return address % alignment == 0
    
    @staticmethod
    def calculate_rva(address: int, base_address: int) -> int:
        """Calculate relative virtual address"""
        return address - base_address
    
    @staticmethod
    def is_valid_user_address(address: int, architecture: Architecture) -> bool:
        """Check if address is in valid user space range"""
        if architecture == Architecture.X86:
            return 0x00010000 <= address <= 0x7FFFFFFF
        elif architecture == Architecture.X64:
            return 0x0000000000010000 <= address <= 0x00007FFFFFFFFFFF
        else:
            return False
    
    @staticmethod
    def is_valid_kernel_address(address: int, architecture: Architecture) -> bool:
        """Check if address is in kernel space range"""
        if architecture == Architecture.X86:
            return 0x80000000 <= address <= 0xFFFFFFFF
        elif architecture == Architecture.X64:
            return 0xFFFF800000000000 <= address <= 0xFFFFFFFFFFFFFFFF
        else:
            return False

@dataclass
class AnalysisContext:
    """Context information for analysis operations"""
    target_process: Optional[Dict[str, Any]] = None
    architecture: Architecture = Architecture.UNKNOWN
    base_address: int = 0
    analysis_depth: int = 1
    include_symbols: bool = True
    include_strings: bool = True
    max_results: int = 1000
    
    def get_pointer_size(self) -> int:
        """Get pointer size for current architecture"""
        return DataTypeConverter.get_pointer_size(self.architecture)

class CacheEntry:
    """Cache entry for analysis results"""
    
    def __init__(self, key: str, value: Any, ttl: float = 300.0):
        import time
        self.key = key
        self.value = value
        self.created_time = time.time()
        self.ttl = ttl
    
    def is_expired(self) -> bool:
        """Check if cache entry has expired"""
        import time
        return time.time() - self.created_time > self.ttl
    
    def refresh(self):
        """Refresh the cache entry timestamp"""
        import time
        self.created_time = time.time()

class SimpleCache:
    """Simple in-memory cache for analysis results"""
    
    def __init__(self, max_size: int = 1000):
        self.cache: Dict[str, CacheEntry] = {}
        self.max_size = max_size
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        if key in self.cache:
            entry = self.cache[key]
            if not entry.is_expired():
                entry.refresh()
                return entry.value
            else:
                del self.cache[key]
        return None
    
    def put(self, key: str, value: Any, ttl: float = 300.0):
        """Put value in cache"""
        # Clean up expired entries
        self._cleanup_expired()
        
        # Remove oldest entries if at capacity
        if len(self.cache) >= self.max_size:
            # Remove 10% of oldest entries
            oldest_keys = sorted(self.cache.keys(), 
                               key=lambda k: self.cache[k].created_time)
            for old_key in oldest_keys[:self.max_size // 10]:
                del self.cache[old_key]
        
        self.cache[key] = CacheEntry(key, value, ttl)
    
    def _cleanup_expired(self):
        """Remove expired cache entries"""
        expired_keys = [k for k, v in self.cache.items() if v.is_expired()]
        for key in expired_keys:
            del self.cache[key]
    
    def clear(self):
        """Clear all cache entries"""
        self.cache.clear()
    
    def size(self) -> int:
        """Get current cache size"""
        return len(self.cache)
