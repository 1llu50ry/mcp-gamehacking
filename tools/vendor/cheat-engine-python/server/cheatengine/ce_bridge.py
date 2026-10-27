"""
Cheat Engine Bridge Module
Provides direct interface to Cheat Engine API and processes
"""

import logging
import ctypes
import ctypes.wintypes
import struct
import winreg
import re
import time
import string
from typing import Dict, List, Optional, Any, Tuple, Union
from dataclasses import dataclass
from pathlib import Path

# Conditional imports for advanced features
try:
    import capstone
    CAPSTONE_AVAILABLE = True
except ImportError:
    CAPSTONE_AVAILABLE = False
    capstone = None

logger = logging.getLogger(__name__)

@dataclass
class CEInstallation:
    """Information about Cheat Engine installation"""
    path: str
    version: str
    executable: str
    available: bool

@dataclass
class CEProcess:
    """Cheat Engine process information"""
    pid: int
    name: str
    handle: int
    base_address: int
    modules: List[Dict[str, Any]]

@dataclass
class MemoryScanResult:
    """Result from memory scanning operation"""
    address: int
    value: Union[int, float, str, bytes]
    data_type: str
    size: int
    region_info: Optional[Dict[str, Any]] = None

@dataclass
class DisassemblyResult:
    """Result from code disassembly"""
    address: int
    bytes_data: bytes
    mnemonic: str
    op_str: str
    size: int
    groups: List[str] = None

class CheatEngineBridge:
    """Bridge interface to Cheat Engine functionality"""
    
    def __init__(self):
        self.ce_installation = self._detect_cheat_engine()
        self.kernel32 = ctypes.windll.kernel32
        self.user32 = ctypes.windll.user32
        self.psapi = ctypes.windll.psapi
        self._setup_windows_api()
    
    def _detect_cheat_engine(self) -> CEInstallation:
        """Detect Cheat Engine installation"""
        
        # Common installation paths
        common_paths = [
            r"C:\dbengine",
            r"C:\Program Files\Cheat Engine",
            r"C:\Program Files (x86)\Cheat Engine",
            r"C:\Cheat Engine"
        ]
        
        # Check registry for installation path
        registry_path = None
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                              r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Cheat Engine") as key:
                registry_path, _ = winreg.QueryValueEx(key, "InstallLocation")
        except FileNotFoundError:
            try:
                # Try 32-bit registry on 64-bit system
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                                  r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Cheat Engine") as key:
                    registry_path, _ = winreg.QueryValueEx(key, "InstallLocation")
            except FileNotFoundError:
                pass
        
        if registry_path:
            common_paths.insert(0, registry_path)
        
        # Check each path
        for path in common_paths:
            ce_path = Path(path)
            if ce_path.exists():
                # Try different executable names in order of preference
                exe_candidates = [
                    "dbengine-x86_64.exe",
                    "cheatengine-x86_64.exe",
                    "cheatengine.exe"
                ]
                
                exe_path = None
                for exe_name in exe_candidates:
                    candidate_path = ce_path / exe_name
                    if candidate_path.exists():
                        exe_path = candidate_path
                        break
                
                if exe_path:
                    version = self._get_ce_version(exe_path)
                    return CEInstallation(
                        path=str(ce_path),
                        version=version,
                        executable=str(exe_path),
                        available=True
                    )
        
        return CEInstallation(
            path="",
            version="",
            executable="",
            available=False
        )
    
    def _get_ce_version(self, exe_path: Path) -> str:
        """Get Cheat Engine version from executable using multiple methods"""
        version_info = {
            'file_version': 'Unknown',
            'product_version': 'Unknown',
            'version_string': 'Unknown'
        }
        
        try:
            # Method 1: Try win32api for detailed version info
            try:
                import win32api
                info = win32api.GetFileVersionInfo(str(exe_path), "\\")
                ms = info['FileVersionMS']
                ls = info['FileVersionLS']
                file_version = f"{win32api.HIWORD(ms)}.{win32api.LOWORD(ms)}.{win32api.HIWORD(ls)}.{win32api.LOWORD(ls)}"
                version_info['file_version'] = file_version
                
                # Try to get product version
                try:
                    product_info = win32api.GetFileVersionInfo(str(exe_path), "\\VarFileInfo\\Translation")
                    if product_info:
                        lang, codepage = product_info[0]
                        product_version = win32api.GetFileVersionInfo(str(exe_path), f"\\StringFileInfo\\{lang:04x}{codepage:04x}\\ProductVersion")
                        if product_version:
                            version_info['product_version'] = product_version
                except:
                    pass
                    
                return file_version
                
            except ImportError:
                # Method 2: Try alternative version detection using ctypes
                try:
                    import ctypes
                    from ctypes import wintypes
                    
                    # Get file version info size
                    size = ctypes.windll.version.GetFileVersionInfoSizeW(str(exe_path), None)
                    if size:
                        res = ctypes.create_string_buffer(size)
                        ctypes.windll.version.GetFileVersionInfoW(str(exe_path), None, size, res)
                        
                        # Extract version info
                        r = ctypes.c_uint()
                        l = ctypes.c_uint()
                        ctypes.windll.version.VerQueryValueW(res, "\\", ctypes.byref(r), ctypes.byref(l))
                        
                        version_struct = ctypes.cast(r, ctypes.POINTER(ctypes.c_uint * 4)).contents
                        version = f"{version_struct[0] >> 16}.{version_struct[0] & 0xFFFF}.{version_struct[1] >> 16}.{version_struct[1] & 0xFFFF}"
                        version_info['file_version'] = version
                        return version
                except:
                    pass
            
            # Method 3: Parse version from filename if possible
            filename = exe_path.name.lower()
            import re
            version_pattern = r'(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)'
            match = re.search(version_pattern, filename)
            if match:
                version_info['version_string'] = match.group(1)
                return match.group(1)
                
        except Exception as e:
            logger.warning(f"Could not determine CE version from {exe_path}: {e}")
        
        return "Unknown"
    
    def get_cheat_engine_version_info(self) -> Dict[str, Any]:
        """Get comprehensive Cheat Engine version and installation information"""
        info = {
            'detected': self.ce_installation.available,
            'installation_path': self.ce_installation.path,
            'executable_path': self.ce_installation.executable,
            'version': self.ce_installation.version,
            'detection_methods': [],
            'running_processes': [],
            'registry_info': {},
            'alternative_installations': []
        }
        
        # Method 1: File system detection (already done in __init__)
        if self.ce_installation.available:
            info['detection_methods'].append({
                'method': 'file_system',
                'status': 'success',
                'path': self.ce_installation.path,
                'version': self.ce_installation.version,
                'executable': self.ce_installation.executable
            })
        
        # Method 2: Check for running Cheat Engine processes
        try:
            import psutil
            ce_processes = []
            for proc in psutil.process_iter(['pid', 'name', 'exe', 'cmdline']):
                try:
                    proc_name = proc.info['name'].lower()
                    if any(ce_name in proc_name for ce_name in ['cheatengine', 'dbengine']):
                        proc_info = {
                            'pid': proc.info['pid'],
                            'name': proc.info['name'],
                            'exe_path': proc.info['exe'],
                            'cmdline': proc.info['cmdline']
                        }
                        
                        # Try to get version from running process
                        if proc.info['exe']:
                            try:
                                version = self._get_ce_version(Path(proc.info['exe']))
                                proc_info['version'] = version
                            except:
                                proc_info['version'] = 'Unknown'
                        
                        ce_processes.append(proc_info)
                        
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    # Skip processes that are inaccessible
                    continue
                        
            info['running_processes'] = ce_processes
            if ce_processes:
                info['detection_methods'].append({
                    'method': 'running_process',
                    'status': 'success',
                    'count': len(ce_processes),
                    'processes': ce_processes
                })
                
        except Exception as e:
            logger.warning(f"Failed to check for running CE processes: {e}")
            info['detection_methods'].append({
                'method': 'running_process',
                'status': 'error',
                'error': str(e)
            })
        
        # Method 3: Enhanced registry detection
        try:
            import winreg
            registry_keys = [
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Cheat Engine"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Cheat Engine"),
                (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Cheat Engine"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\CheatEngine"),
                (winreg.HKEY_CURRENT_USER, r"SOFTWARE\CheatEngine")
            ]
            
            for hkey, subkey in registry_keys:
                try:
                    with winreg.OpenKey(hkey, subkey) as key:
                        reg_info = {}
                        try:
                            reg_info['install_location'], _ = winreg.QueryValueEx(key, "InstallLocation")
                        except FileNotFoundError:
                            pass
                        try:
                            reg_info['display_version'], _ = winreg.QueryValueEx(key, "DisplayVersion")
                        except FileNotFoundError:
                            pass
                        try:
                            reg_info['display_name'], _ = winreg.QueryValueEx(key, "DisplayName")
                        except FileNotFoundError:
                            pass
                        try:
                            reg_info['publisher'], _ = winreg.QueryValueEx(key, "Publisher")
                        except FileNotFoundError:
                            pass
                        
                        if reg_info:
                            info['registry_info'][f"{hkey}\\{subkey}"] = reg_info
                            
                except FileNotFoundError:
                    continue
                    
            if info['registry_info']:
                info['detection_methods'].append({
                    'method': 'registry',
                    'status': 'success',
                    'registry_entries': len(info['registry_info'])
                })
                
        except Exception as e:
            logger.warning(f"Failed to check registry for CE info: {e}")
            info['detection_methods'].append({
                'method': 'registry',
                'status': 'error',
                'error': str(e)
            })
        
        # Method 4: Search for alternative installations
        try:
            alternative_paths = [
                r"C:\dbengine",
                r"C:\Program Files\Cheat Engine",
                r"C:\Program Files (x86)\Cheat Engine", 
                r"C:\Cheat Engine",
                r"D:\Cheat Engine",
                r"E:\Cheat Engine",
                str(Path.home() / "Desktop" / "Cheat Engine"),
                str(Path.home() / "Downloads" / "Cheat Engine")
            ]
            
            alternatives = []
            for alt_path in alternative_paths:
                alt_path_obj = Path(alt_path)
                if alt_path_obj.exists() and str(alt_path_obj) != self.ce_installation.path:
                    # Try different executable names
                    exe_candidates = [
                        "dbengine-x86_64.exe",
                        "cheatengine-x86_64.exe", 
                        "cheatengine.exe"
                    ]
                    
                    for exe_name in exe_candidates:
                        exe_path = alt_path_obj / exe_name
                        if exe_path.exists():
                            version = self._get_ce_version(exe_path)
                            alternatives.append({
                                'path': str(alt_path_obj),
                                'executable': str(exe_path),
                                'version': version
                            })
                            break
            
            info['alternative_installations'] = alternatives
            if alternatives:
                info['detection_methods'].append({
                    'method': 'alternative_search',
                    'status': 'success',
                    'found_count': len(alternatives)
                })
                
        except Exception as e:
            logger.warning(f"Failed to search for alternative CE installations: {e}")
            info['detection_methods'].append({
                'method': 'alternative_search',
                'status': 'error',
                'error': str(e)
            })
        
        return info
    
    def _setup_windows_api(self):
        """Setup Windows API function signatures"""
        
        # OpenProcess
        self.kernel32.OpenProcess.argtypes = [ctypes.wintypes.DWORD, ctypes.wintypes.BOOL, ctypes.wintypes.DWORD]
        self.kernel32.OpenProcess.restype = ctypes.wintypes.HANDLE
        
        # ReadProcessMemory
        self.kernel32.ReadProcessMemory.argtypes = [
            ctypes.wintypes.HANDLE,  # hProcess
            ctypes.wintypes.LPCVOID,  # lpBaseAddress
            ctypes.wintypes.LPVOID,   # lpBuffer
            ctypes.c_size_t,          # nSize
            ctypes.POINTER(ctypes.c_size_t)  # lpNumberOfBytesRead
        ]
        self.kernel32.ReadProcessMemory.restype = ctypes.wintypes.BOOL
        
        # WriteProcessMemory
        self.kernel32.WriteProcessMemory.argtypes = [
            ctypes.wintypes.HANDLE,   # hProcess
            ctypes.wintypes.LPVOID,   # lpBaseAddress
            ctypes.wintypes.LPCVOID,  # lpBuffer
            ctypes.c_size_t,          # nSize
            ctypes.POINTER(ctypes.c_size_t)  # lpNumberOfBytesWritten
        ]
        self.kernel32.WriteProcessMemory.restype = ctypes.wintypes.BOOL
        
        # VirtualQueryEx
        self.kernel32.VirtualQueryEx.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.wintypes.LPCVOID,
            ctypes.wintypes.LPVOID,
            ctypes.c_size_t
        ]
        self.kernel32.VirtualQueryEx.restype = ctypes.c_size_t
        
        # CloseHandle
        self.kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
        self.kernel32.CloseHandle.restype = ctypes.wintypes.BOOL
        
        # EnumProcessModules
        self.psapi.EnumProcessModules.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.POINTER(ctypes.wintypes.HMODULE),
            ctypes.wintypes.DWORD,
            ctypes.POINTER(ctypes.wintypes.DWORD)
        ]
        self.psapi.EnumProcessModules.restype = ctypes.wintypes.BOOL
        
        # GetModuleInformation
        self.psapi.GetModuleInformation.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.wintypes.HMODULE,
            ctypes.wintypes.LPVOID,
            ctypes.wintypes.DWORD
        ]
        self.psapi.GetModuleInformation.restype = ctypes.wintypes.BOOL
    
    def get_ce_installation_info(self) -> Dict[str, Any]:
        """Get Cheat Engine installation information"""
        return {
            'available': self.ce_installation.available,
            'path': self.ce_installation.path,
            'version': self.ce_installation.version,
            'executable': self.ce_installation.executable
        }
    
    def open_process_handle(self, pid: int, access_rights: int = 0x1F0FFF) -> Optional[int]:
        """Open a handle to a process
        
        Args:
            pid: Process ID
            access_rights: Access rights (default: PROCESS_ALL_ACCESS)
            
        Returns:
            Process handle or None if failed
        """
        try:
            handle = self.kernel32.OpenProcess(access_rights, False, pid)
            if handle:
                return handle
            else:
                error = ctypes.get_last_error()
                logger.error(f"Failed to open process {pid}: Error {error}")
                return None
        except Exception as e:
            logger.error(f"Exception opening process {pid}: {e}")
            return None
    
    def close_process_handle(self, handle: int) -> bool:
        """Close a process handle"""
        try:
            return bool(self.kernel32.CloseHandle(handle))
        except Exception as e:
            logger.error(f"Error closing handle {handle}: {e}")
            return False
    
    def read_process_memory(self, handle: int, address: int, size: int) -> Optional[bytes]:
        """Read memory from process
        
        Args:
            handle: Process handle
            address: Memory address
            size: Number of bytes to read
            
        Returns:
            Bytes read or None if failed
        """
        try:
            buffer = ctypes.create_string_buffer(size)
            bytes_read = ctypes.c_size_t()
            
            success = self.kernel32.ReadProcessMemory(
                handle,
                ctypes.c_void_p(address),
                buffer,
                size,
                ctypes.byref(bytes_read)
            )
            
            if success:
                return buffer.raw[:bytes_read.value]
            else:
                error = ctypes.get_last_error()
                logger.error(f"ReadProcessMemory failed: Error {error}")
                return None
                
        except Exception as e:
            logger.error(f"Exception reading memory at 0x{address:X}: {e}")
            return None
    
    def write_process_memory(self, handle: int, address: int, data: bytes) -> bool:
        """Write memory to process (READ-ONLY MODE - NOT IMPLEMENTED)
        
        This method is intentionally not implemented for safety.
        The server operates in read-only mode.
        """
        logger.warning("Write operations are disabled in read-only mode")
        return False
    
    def query_memory_info(self, handle: int, address: int) -> Optional[Dict[str, Any]]:
        """Query memory information at address"""
        
        class MEMORY_BASIC_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BaseAddress", ctypes.c_void_p),
                ("AllocationBase", ctypes.c_void_p),
                ("AllocationProtect", ctypes.wintypes.DWORD),
                ("RegionSize", ctypes.c_size_t),
                ("State", ctypes.wintypes.DWORD),
                ("Protect", ctypes.wintypes.DWORD),
                ("Type", ctypes.wintypes.DWORD),
            ]
        
        try:
            mbi = MEMORY_BASIC_INFORMATION()
            size = self.kernel32.VirtualQueryEx(
                handle,
                ctypes.c_void_p(address),
                ctypes.byref(mbi),
                ctypes.sizeof(mbi)
            )
            
            if size:
                return {
                    'base_address': mbi.BaseAddress,
                    'allocation_base': mbi.AllocationBase,
                    'allocation_protect': mbi.AllocationProtect,
                    'region_size': mbi.RegionSize,
                    'state': mbi.State,
                    'protect': mbi.Protect,
                    'type': mbi.Type
                }
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error querying memory at 0x{address:X}: {e}")
            return None
    
    def enum_process_modules(self, handle: int) -> List[Dict[str, Any]]:
        """Enumerate modules in a process"""
        modules = []
        
        try:
            # Get module count
            module_handles = (ctypes.wintypes.HMODULE * 1024)()
            bytes_needed = ctypes.wintypes.DWORD()
            
            success = self.psapi.EnumProcessModules(
                handle,
                module_handles,
                ctypes.sizeof(module_handles),
                ctypes.byref(bytes_needed)
            )
            
            if not success:
                return modules
            
            module_count = bytes_needed.value // ctypes.sizeof(ctypes.wintypes.HMODULE)
            
            # Get module information
            class MODULEINFO(ctypes.Structure):
                _fields_ = [
                    ("lpBaseOfDll", ctypes.c_void_p),
                    ("SizeOfImage", ctypes.wintypes.DWORD),
                    ("EntryPoint", ctypes.c_void_p),
                ]
            
            for i in range(min(module_count, 1024)):
                if module_handles[i]:
                    module_info = MODULEINFO()
                    success = self.psapi.GetModuleInformation(
                        handle,
                        module_handles[i],
                        ctypes.byref(module_info),
                        ctypes.sizeof(module_info)
                    )
                    
                    if success:
                        # Get module name
                        module_name = self._get_module_name(handle, module_handles[i])
                        
                        modules.append({
                            'handle': module_handles[i],
                            'name': module_name,
                            'base_address': module_info.lpBaseOfDll,
                            'size': module_info.SizeOfImage,
                            'entry_point': module_info.EntryPoint
                        })
            
            return modules
            
        except Exception as e:
            logger.error(f"Error enumerating modules: {e}")
            return modules
    
    def _get_module_name(self, handle: int, module_handle: int) -> str:
        """Get module name from handle"""
        try:
            # Try GetModuleFileNameEx
            buffer = ctypes.create_unicode_buffer(260)  # MAX_PATH
            length = self.psapi.GetModuleFileNameExW(
                handle,
                module_handle,
                buffer,
                260
            )
            
            if length:
                full_path = buffer.value
                return Path(full_path).name
            else:
                return f"Module_{module_handle:X}"
                
        except Exception:
            return f"Module_{module_handle:X}"
    
    def find_pattern_in_memory(self, handle: int, pattern: bytes, start_address: int = 0, 
                             end_address: int = 0x7FFFFFFF, alignment: int = 1) -> List[int]:
        """Find byte pattern in process memory
        
        Args:
            handle: Process handle
            pattern: Byte pattern to search for
            start_address: Start search address
            end_address: End search address
            alignment: Memory alignment for search
            
        Returns:
            List of addresses where pattern was found
        """
        found_addresses = []
        current_address = start_address
        chunk_size = 1024 * 1024  # 1MB chunks
        
        try:
            while current_address < end_address:
                # Query memory region
                memory_info = self.query_memory_info(handle, current_address)
                if not memory_info:
                    current_address += 0x1000  # Skip 4KB
                    continue
                
                # Skip if region is not committed or readable
                if (memory_info['state'] != 0x1000 or  # MEM_COMMIT
                    memory_info['protect'] & 0x01 or   # PAGE_NOACCESS
                    memory_info['protect'] & 0x100):   # PAGE_GUARD
                    current_address = memory_info['base_address'] + memory_info['region_size']
                    continue
                
                # Read memory in chunks
                region_start = memory_info['base_address']
                region_size = memory_info['region_size']
                
                for offset in range(0, region_size, chunk_size):
                    chunk_address = region_start + offset
                    read_size = min(chunk_size, region_size - offset)
                    
                    data = self.read_process_memory(handle, chunk_address, read_size)
                    if data:
                        # Search for pattern in chunk
                        pattern_addresses = self._search_pattern_in_data(
                            data, pattern, chunk_address, alignment
                        )
                        found_addresses.extend(pattern_addresses)
                
                current_address = region_start + region_size
                
                # Limit results to prevent memory issues
                if len(found_addresses) > 10000:
                    logger.warning("Pattern search found too many results, truncating")
                    break
            
            return found_addresses
            
        except Exception as e:
            logger.error(f"Error in pattern search: {e}")
            return found_addresses
    
    def _search_pattern_in_data(self, data: bytes, pattern: bytes, base_address: int, 
                               alignment: int) -> List[int]:
        """Search for pattern in data chunk"""
        addresses = []
        
        for i in range(0, len(data) - len(pattern) + 1, alignment):
            if data[i:i+len(pattern)] == pattern:
                addresses.append(base_address + i)
        
        return addresses
    
    def scan_memory_for_value(self, handle: int, value: Union[int, float, str], 
                            data_type: str, start_address: int = 0, 
                            end_address: int = 0x7FFFFFFF) -> List[MemoryScanResult]:
        """Scan memory for specific values
        
        Args:
            handle: Process handle
            value: Value to search for
            data_type: Data type ('int8', 'int16', 'int32', 'int64', 'float', 'double', 'string')
            start_address: Start search address
            end_address: End search address
            
        Returns:
            List of MemoryScanResult objects
        """
        results = []
        search_pattern = self._value_to_bytes(value, data_type)
        if not search_pattern:
            return results
        
        try:
            current_address = start_address
            chunk_size = 1024 * 1024  # 1MB chunks
            
            while current_address < end_address:
                memory_info = self.query_memory_info(handle, current_address)
                if not memory_info or not self._is_memory_readable(memory_info['protect']):
                    current_address += 0x1000
                    continue
                
                region_start = memory_info['base_address']
                region_size = memory_info['region_size']
                
                for offset in range(0, region_size, chunk_size):
                    chunk_address = region_start + offset
                    read_size = min(chunk_size, region_size - offset)
                    
                    data = self.read_process_memory(handle, chunk_address, read_size)
                    if data:
                        for pattern_bytes in search_pattern:
                            addresses = self._search_pattern_in_data(
                                data, pattern_bytes, chunk_address, 1
                            )
                            
                            for addr in addresses:
                                # Check limit before adding more results
                                if len(results) >= 10000:
                                    logger.warning("Memory scan found too many results, truncating")
                                    return results
                                    
                                # Read the actual value at this address
                                actual_value = self._read_typed_value(handle, addr, data_type)
                                if actual_value is not None:
                                    results.append(MemoryScanResult(
                                        address=addr,
                                        value=actual_value,
                                        data_type=data_type,
                                        size=len(pattern_bytes),
                                        region_info=memory_info
                                    ))
                
                current_address = region_start + region_size
                
                # Limit results to prevent memory issues
                if len(results) > 10000:
                    logger.warning("Memory scan found too many results, truncating")
                    break
            
            return results
            
        except Exception as e:
            logger.error(f"Error in memory value scan: {e}")
            return results
    
    def scan_memory_range(self, handle: int, min_value: Union[int, float], 
                         max_value: Union[int, float], data_type: str,
                         start_address: int = 0, end_address: int = 0x7FFFFFFF) -> List[MemoryScanResult]:
        """Scan memory for values within a range
        
        Args:
            handle: Process handle
            min_value: Minimum value
            max_value: Maximum value
            data_type: Data type
            start_address: Start search address
            end_address: End search address
            
        Returns:
            List of MemoryScanResult objects
        """
        results = []
        type_size = self._get_type_size(data_type)
        
        try:
            current_address = start_address
            chunk_size = 1024 * 1024
            
            while current_address < end_address:
                memory_info = self.query_memory_info(handle, current_address)
                if not memory_info or not self._is_memory_readable(memory_info['protect']):
                    current_address += 0x1000
                    continue
                
                region_start = memory_info['base_address']
                region_size = memory_info['region_size']
                
                for offset in range(0, region_size, chunk_size):
                    chunk_address = region_start + offset
                    read_size = min(chunk_size, region_size - offset)
                    
                    data = self.read_process_memory(handle, chunk_address, read_size)
                    if data:
                        # Scan through data at type-sized intervals
                        for i in range(0, len(data) - type_size + 1, type_size):
                            addr = chunk_address + i
                            value = self._bytes_to_value(data[i:i+type_size], data_type)
                            
                            if value is not None and min_value <= value <= max_value:
                                results.append(MemoryScanResult(
                                    address=addr,
                                    value=value,
                                    data_type=data_type,
                                    size=type_size,
                                    region_info=memory_info
                                ))
                
                current_address = region_start + region_size
                
                if len(results) > 10000:
                    logger.warning("Range scan found too many results, truncating")
                    break
            
            return results
            
        except Exception as e:
            logger.error(f"Error in memory range scan: {e}")
            return results
    
    def find_pattern_with_wildcards(self, handle: int, pattern_string: str,
                                   start_address: int = 0, end_address: int = 0x7FFFFFFF) -> List[int]:
        """Find byte pattern with wildcards (? or ??)
        
        Args:
            handle: Process handle
            pattern_string: Pattern string like "48 8B ? 48 ?? 05"
            start_address: Start search address
            end_address: End search address
            
        Returns:
            List of addresses where pattern was found
        """
        found_addresses = []
        
        try:
            # Parse pattern string
            pattern_parts = pattern_string.upper().split()
            pattern_bytes = []
            mask = []
            
            for part in pattern_parts:
                if part == '?' or part == '??':
                    pattern_bytes.append(0x00)
                    mask.append(False)
                else:
                    try:
                        byte_val = int(part, 16)
                        pattern_bytes.append(byte_val)
                        mask.append(True)
                    except ValueError:
                        logger.error(f"Invalid hex byte in pattern: {part}")
                        return found_addresses
            
            if not pattern_bytes:
                return found_addresses
            
            pattern = bytes(pattern_bytes)
            current_address = start_address
            chunk_size = 1024 * 1024
            
            while current_address < end_address:
                memory_info = self.query_memory_info(handle, current_address)
                if not memory_info or not self._is_memory_readable(memory_info['protect']):
                    current_address += 0x1000
                    continue
                
                region_start = memory_info['base_address']
                region_size = memory_info['region_size']
                
                for offset in range(0, region_size, chunk_size):
                    chunk_address = region_start + offset
                    read_size = min(chunk_size, region_size - offset)
                    
                    data = self.read_process_memory(handle, chunk_address, read_size)
                    if data:
                        addresses = self._search_wildcard_pattern(
                            data, pattern, mask, chunk_address
                        )
                        found_addresses.extend(addresses)
                
                current_address = region_start + region_size
                
                if len(found_addresses) > 10000:
                    logger.warning("Wildcard pattern search found too many results, truncating")
                    break
            
            return found_addresses
            
        except Exception as e:
            logger.error(f"Error in wildcard pattern search: {e}")
            return found_addresses
    
    def _search_wildcard_pattern(self, data: bytes, pattern: bytes, 
                                mask: List[bool], base_address: int) -> List[int]:
        """Search for wildcard pattern in data"""
        addresses = []
        
        for i in range(len(data) - len(pattern) + 1):
            match = True
            for j, check_byte in enumerate(mask):
                if check_byte and data[i + j] != pattern[j]:
                    match = False
                    break
            
            if match:
                addresses.append(base_address + i)
        
        return addresses
    
    def resolve_pointer_chain(self, handle: int, base_address: int, 
                            offsets: List[int]) -> Optional[int]:
        """Resolve a pointer chain
        
        Args:
            handle: Process handle
            base_address: Base address to start from
            offsets: List of offsets to follow
            
        Returns:
            Final address or None if failed
        """
        try:
            current_address = base_address
            
            for i, offset in enumerate(offsets):
                if i < len(offsets) - 1:
                    # Read pointer value (assuming 64-bit)
                    pointer_data = self.read_process_memory(handle, current_address + offset, 8)
                    if not pointer_data:
                        return None
                    
                    # Unpack as 64-bit pointer
                    try:
                        current_address = struct.unpack('<Q', pointer_data)[0]
                    except struct.error:
                        return None
                else:
                    # Final offset
                    current_address += offset
            
            return current_address
            
        except Exception as e:
            logger.error(f"Error resolving pointer chain: {e}")
            return None
    
    def find_pointer_chains_to_address(self, handle: int, target_address: int, 
                                     max_depth: int = 4, max_results: int = 100) -> List[Dict[str, Any]]:
        """Find pointer chains that lead to a target address
        
        Args:
            handle: Process handle
            target_address: Target address to find chains to
            max_depth: Maximum chain depth
            max_results: Maximum number of results
            
        Returns:
            List of pointer chain information
        """
        chains = []
        
        try:
            # Get all memory regions that could contain pointers
            memory_map = self.get_detailed_memory_map(handle)
            readable_regions = [r for r in memory_map if r['readable'] and not r['executable']]
            
            # Find all pointers that point to the target address
            ptr_size = ctypes.sizeof(ctypes.c_void_p)
            target_bytes = struct.pack('<Q' if ptr_size == 8 else '<I', target_address)
            
            level_pointers = {0: [target_address]}  # Level 0 is the target itself
            
            for depth in range(1, max_depth + 1):
                current_level = []
                
                for region in readable_regions:
                    region_data = self.read_process_memory(
                        handle, region['base_address'], 
                        min(region['region_size'], 1024 * 1024)  # Limit to 1MB per region
                    )
                    
                    if not region_data:
                        continue
                    
                    # Look for pointers to any address in the previous level
                    for prev_addr in level_pointers.get(depth - 1, []):
                        if ptr_size == 8:
                            search_bytes = struct.pack('<Q', prev_addr)
                        else:
                            search_bytes = struct.pack('<I', prev_addr)
                        
                        # Find all occurrences of this pointer
                        offset = 0
                        while True:
                            pos = region_data.find(search_bytes, offset)
                            if pos == -1:
                                break
                            
                            pointer_addr = region['base_address'] + pos
                            current_level.append(pointer_addr)
                            
                            # Record the chain
                            if len(chains) < max_results:
                                chains.append({
                                    'depth': depth,
                                    'pointer_address': pointer_addr,
                                    'points_to': prev_addr,
                                    'target_address': target_address,
                                    'region_info': region
                                })
                            
                            offset = pos + ptr_size
                
                level_pointers[depth] = current_level[:1000]  # Limit per level
                
                if len(chains) >= max_results:
                    break
            
            return chains
            
        except Exception as e:
            logger.error(f"Error finding pointer chains to 0x{target_address:X}: {e}")
            return chains
    
    def compare_memory_snapshots(self, handle: int, address: int, size: int, 
                                previous_data: bytes) -> Dict[str, Any]:
        """Compare current memory with previous snapshot
        
        Args:
            handle: Process handle
            address: Memory address
            size: Size to compare
            previous_data: Previous memory snapshot
            
        Returns:
            Comparison results
        """
        comparison = {
            'address': address,
            'size': size,
            'changes': [],
            'summary': {}
        }
        
        try:
            current_data = self.read_process_memory(handle, address, size)
            if not current_data:
                comparison['summary']['error'] = 'Could not read current memory'
                return comparison
            
            if len(current_data) != len(previous_data):
                comparison['summary']['size_mismatch'] = True
                min_size = min(len(current_data), len(previous_data))
                current_data = current_data[:min_size]
                previous_data = previous_data[:min_size]
            
            # Find all changed bytes
            changes = []
            changed_regions = []
            current_region_start = None
            
            for i, (old_byte, new_byte) in enumerate(zip(previous_data, current_data)):
                if old_byte != new_byte:
                    if current_region_start is None:
                        current_region_start = i
                    
                    changes.append({
                        'offset': i,
                        'address': address + i,
                        'old_value': old_byte,
                        'new_value': new_byte
                    })
                else:
                    if current_region_start is not None:
                        changed_regions.append({
                            'start_offset': current_region_start,
                            'end_offset': i - 1,
                            'start_address': address + current_region_start,
                            'end_address': address + i - 1,
                            'size': i - current_region_start
                        })
                        current_region_start = None
            
            # Close the last region if needed
            if current_region_start is not None:
                changed_regions.append({
                    'start_offset': current_region_start,
                    'end_offset': len(current_data) - 1,
                    'start_address': address + current_region_start,
                    'end_address': address + len(current_data) - 1,
                    'size': len(current_data) - current_region_start
                })
            
            comparison['changes'] = changes[:1000]  # Limit results
            comparison['changed_regions'] = changed_regions
            comparison['summary'] = {
                'total_changes': len(changes),
                'changed_bytes_percentage': (len(changes) / len(current_data)) * 100,
                'largest_changed_region': max(changed_regions, key=lambda x: x['size'])['size'] if changed_regions else 0,
                'number_of_regions': len(changed_regions)
            }
            
            return comparison
            
        except Exception as e:
            logger.error(f"Error comparing memory snapshots: {e}")
            comparison['summary']['error'] = str(e)
            return comparison
    
    def create_memory_snapshot(self, handle: int, address: int, size: int) -> Optional[bytes]:
        """Create a memory snapshot for later comparison
        
        Args:
            handle: Process handle
            address: Memory address
            size: Size to snapshot
            
        Returns:
            Memory snapshot data
        """
        try:
            return self.read_process_memory(handle, address, size)
        except Exception as e:
            logger.error(f"Error creating memory snapshot: {e}")
            return None
    
    def search_for_changed_values(self, handle: int, old_value: Union[int, float], 
                                new_value: Union[int, float], data_type: str,
                                previous_results: List[MemoryScanResult] = None) -> List[MemoryScanResult]:
        """Search for values that changed from old_value to new_value
        
        Args:
            handle: Process handle
            old_value: Previous value
            new_value: Current value
            data_type: Data type
            previous_results: Previous scan results to filter
            
        Returns:
            List of addresses where value changed
        """
        results = []
        
        try:
            if previous_results:
                # Filter previous results
                for result in previous_results:
                    current_value = self._read_typed_value(handle, result.address, data_type)
                    if current_value == new_value:
                        # Create snapshot to compare later
                        results.append(MemoryScanResult(
                            address=result.address,
                            value=current_value,
                            data_type=data_type,
                            size=result.size,
                            region_info=result.region_info
                        ))
            else:
                # Scan all memory for new_value
                results = self.scan_memory_for_value(handle, new_value, data_type)
            
            return results
            
        except Exception as e:
            logger.error(f"Error searching for changed values: {e}")
            return results
    
    def create_ce_process_info(self, pid: int) -> Optional[CEProcess]:
        """Create CEProcess object with full process information"""
        try:
            handle = self.open_process_handle(pid)
            if not handle:
                return None
            
            # Get process name
            import psutil
            try:
                process = psutil.Process(pid)
                process_name = process.name()
            except psutil.NoSuchProcess:
                process_name = f"Process_{pid}"
            
            # Get modules
            modules = self.enum_process_modules(handle)
            
            # Get base address (first module's base address)
            base_address = modules[0]['base_address'] if modules else 0
            
            return CEProcess(
                pid=pid,
                name=process_name,
                handle=handle,
                base_address=base_address,
                modules=modules
            )
            
        except Exception as e:
            logger.error(f"Error creating CE process info for PID {pid}: {e}")
            return None
    
    def get_detailed_memory_map(self, handle: int) -> List[Dict[str, Any]]:
        """Get detailed memory map of process"""
        memory_regions = []
        current_address = 0
        
        try:
            while current_address < 0x7FFFFFFF:  # 2GB limit for 32-bit compat
                memory_info = self.query_memory_info(handle, current_address)
                if not memory_info:
                    current_address += 0x1000
                    continue
                
                # Add region info
                region = {
                    'base_address': memory_info['base_address'],
                    'region_size': memory_info['region_size'],
                    'state': self._memory_state_to_string(memory_info['state']),
                    'protect': self._memory_protect_to_string(memory_info['protect']),
                    'type': self._memory_type_to_string(memory_info['type']),
                    'readable': self._is_memory_readable(memory_info['protect']),
                    'writable': self._is_memory_writable(memory_info['protect']),
                    'executable': self._is_memory_executable(memory_info['protect'])
                }
                
                memory_regions.append(region)
                current_address = memory_info['base_address'] + memory_info['region_size']
                
                # Prevent infinite loops
                if len(memory_regions) > 10000:
                    break
            
            return memory_regions
            
        except Exception as e:
            logger.error(f"Error getting memory map: {e}")
            return memory_regions
    
    def _memory_state_to_string(self, state: int) -> str:
        """Convert memory state constant to string"""
        states = {
            0x1000: "MEM_COMMIT",
            0x10000: "MEM_FREE",
            0x2000: "MEM_RESERVE"
        }
        return states.get(state, f"Unknown_{state:X}")
    
    def _memory_protect_to_string(self, protect: int) -> str:
        """Convert memory protection constant to string"""
        protections = {
            0x01: "PAGE_NOACCESS",
            0x02: "PAGE_READONLY",
            0x04: "PAGE_READWRITE",
            0x08: "PAGE_WRITECOPY",
            0x10: "PAGE_EXECUTE",
            0x20: "PAGE_EXECUTE_READ",
            0x40: "PAGE_EXECUTE_READWRITE",
            0x80: "PAGE_EXECUTE_WRITECOPY"
        }
        
        base_protect = protect & 0xFF
        result = protections.get(base_protect, f"Unknown_{base_protect:X}")
        
        # Add modifiers
        if protect & 0x100:
            result += " | PAGE_GUARD"
        if protect & 0x200:
            result += " | PAGE_NOCACHE"
        if protect & 0x400:
            result += " | PAGE_WRITECOMBINE"
        
        return result
    
    def _memory_type_to_string(self, mem_type: int) -> str:
        """Convert memory type constant to string"""
        types = {
            0x1000000: "MEM_IMAGE",
            0x40000: "MEM_MAPPED",
            0x20000: "MEM_PRIVATE"
        }
        return types.get(mem_type, f"Unknown_{mem_type:X}")
    
    def _is_memory_readable(self, protect: int) -> bool:
        """Check if memory is readable"""
        readable_protects = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}
        return (protect & 0xFF) in readable_protects
    
    def _is_memory_writable(self, protect: int) -> bool:
        """Check if memory is writable"""
        writable_protects = {0x04, 0x08, 0x40, 0x80}
        return (protect & 0xFF) in writable_protects
    
    def _is_memory_executable(self, protect: int) -> bool:
        """Check if memory is executable"""
        executable_protects = {0x10, 0x20, 0x40, 0x80}
        return (protect & 0xFF) in executable_protects
    
    def _value_to_bytes(self, value: Union[int, float, str], data_type: str) -> List[bytes]:
        """Convert value to byte patterns for searching"""
        patterns = []
        
        try:
            if data_type == 'int8':
                patterns.append(struct.pack('<b', int(value)))
            elif data_type == 'int16':
                patterns.append(struct.pack('<h', int(value)))
            elif data_type == 'int32':
                patterns.append(struct.pack('<i', int(value)))
            elif data_type == 'int64':
                patterns.append(struct.pack('<q', int(value)))
            elif data_type == 'uint8':
                patterns.append(struct.pack('<B', int(value)))
            elif data_type == 'uint16':
                patterns.append(struct.pack('<H', int(value)))
            elif data_type == 'uint32':
                patterns.append(struct.pack('<I', int(value)))
            elif data_type == 'uint64':
                patterns.append(struct.pack('<Q', int(value)))
            elif data_type == 'float':
                patterns.append(struct.pack('<f', float(value)))
            elif data_type == 'double':
                patterns.append(struct.pack('<d', float(value)))
            elif data_type == 'string':
                # Support multiple encodings
                str_value = str(value)
                patterns.append(str_value.encode('utf-8'))
                patterns.append(str_value.encode('utf-16le'))
                patterns.append(str_value.encode('ascii', errors='ignore'))
            
            return patterns
            
        except (struct.error, ValueError, UnicodeError) as e:
            logger.error(f"Error converting value {value} to {data_type}: {e}")
            return []
    
    def _bytes_to_value(self, data: bytes, data_type: str) -> Optional[Union[int, float]]:
        """Convert bytes to typed value"""
        try:
            if len(data) < self._get_type_size(data_type):
                return None
            
            if data_type == 'int8':
                return struct.unpack('<b', data[:1])[0]
            elif data_type == 'int16':
                return struct.unpack('<h', data[:2])[0]
            elif data_type == 'int32':
                return struct.unpack('<i', data[:4])[0]
            elif data_type == 'int64':
                return struct.unpack('<q', data[:8])[0]
            elif data_type == 'uint8':
                return struct.unpack('<B', data[:1])[0]
            elif data_type == 'uint16':
                return struct.unpack('<H', data[:2])[0]
            elif data_type == 'uint32':
                return struct.unpack('<I', data[:4])[0]
            elif data_type == 'uint64':
                return struct.unpack('<Q', data[:8])[0]
            elif data_type == 'float':
                return struct.unpack('<f', data[:4])[0]
            elif data_type == 'double':
                return struct.unpack('<d', data[:8])[0]
            
            return None
            
        except struct.error:
            return None
    
    def _get_type_size(self, data_type: str) -> int:
        """Get size in bytes for data type"""
        sizes = {
            'int8': 1, 'uint8': 1,
            'int16': 2, 'uint16': 2,
            'int32': 4, 'uint32': 4,
            'int64': 8, 'uint64': 8,
            'float': 4, 'double': 8
        }
        return sizes.get(data_type, 1)
    
    def _read_typed_value(self, handle: int, address: int, data_type: str) -> Optional[Union[int, float, str]]:
        """Read a typed value from memory"""
        size = self._get_type_size(data_type)
        
        if data_type == 'string':
            # Try to read a reasonable string length
            data = self.read_process_memory(handle, address, 256)
            if data:
                # Try different encodings
                for encoding in ['utf-8', 'utf-16le', 'ascii']:
                    try:
                        # Find null terminator
                        if encoding == 'utf-16le':
                            null_pos = data.find(b'\x00\x00')
                            if null_pos >= 0 and null_pos % 2 == 0:
                                string_data = data[:null_pos+2]
                            else:
                                string_data = data[:32]  # Limit length
                        else:
                            null_pos = data.find(b'\x00')
                            string_data = data[:null_pos] if null_pos >= 0 else data[:64]
                        
                        return string_data.decode(encoding).rstrip('\x00')
                    except UnicodeDecodeError:
                        continue
            return None
        else:
            data = self.read_process_memory(handle, address, size)
            if data:
                return self._bytes_to_value(data, data_type)
            return None
    
    def disassemble_code(self, handle: int, address: int, size: int = 64,
                        architecture: str = 'x64') -> List[DisassemblyResult]:
        """Disassemble code at address
        
        Args:
            handle: Process handle
            address: Code address
            size: Number of bytes to disassemble
            architecture: Target architecture ('x64' or 'x86')
            
        Returns:
            List of DisassemblyResult objects
        """
        results = []
        
        if not CAPSTONE_AVAILABLE:
            logger.warning("Capstone engine not available for disassembly")
            return results
        
        try:
            # Read code bytes
            code_data = self.read_process_memory(handle, address, size)
            if not code_data:
                return results
            
            # Initialize disassembler
            if architecture == 'x64':
                md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
            else:
                md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
            
            md.detail = True
            
            # Disassemble
            for insn in md.disasm(code_data, address):
                groups = []
                if hasattr(insn, 'groups'):
                    for group_id in insn.groups:
                        group_name = insn.group_name(group_id)
                        if group_name:
                            groups.append(group_name)
                
                results.append(DisassemblyResult(
                    address=insn.address,
                    bytes_data=insn.bytes,
                    mnemonic=insn.mnemonic,
                    op_str=insn.op_str,
                    size=insn.size,
                    groups=groups
                ))
            
            return results
            
        except Exception as e:
            logger.error(f"Error disassembling code at 0x{address:X}: {e}")
            return results
    
    def find_string_references(self, handle: int, target_string: str,
                             start_address: int = 0, end_address: int = 0x7FFFFFFF) -> List[Dict[str, Any]]:
        """Find references to a string in memory
        
        Args:
            handle: Process handle
            target_string: String to find references to
            start_address: Start search address
            end_address: End search address
            
        Returns:
            List of reference information
        """
        references = []
        
        try:
            # First, find all instances of the string
            string_addresses = []
            for encoding in ['utf-8', 'utf-16le', 'ascii']:
                try:
                    pattern = target_string.encode(encoding)
                    addresses = self.find_pattern_in_memory(handle, pattern, start_address, end_address)
                    for addr in addresses:
                        string_addresses.append({
                            'address': addr,
                            'encoding': encoding,
                            'size': len(pattern)
                        })
                except UnicodeEncodeError:
                    continue
            
            # Find code that references these strings
            for string_info in string_addresses:
                string_addr = string_info['address']
                
                # Look for pointer references to this string
                pointer_patterns = []
                if ctypes.sizeof(ctypes.c_void_p) == 8:  # 64-bit
                    pointer_patterns.append(struct.pack('<Q', string_addr))
                else:  # 32-bit
                    pointer_patterns.append(struct.pack('<I', string_addr))
                
                for pattern in pointer_patterns:
                    ref_addresses = self.find_pattern_in_memory(handle, pattern, start_address, end_address)
                    for ref_addr in ref_addresses:
                        # Check if this is in an executable region
                        memory_info = self.query_memory_info(handle, ref_addr)
                        if memory_info and self._is_memory_executable(memory_info['protect']):
                            references.append({
                                'reference_address': ref_addr,
                                'string_address': string_addr,
                                'string_encoding': string_info['encoding'],
                                'string_value': target_string,
                                'region_info': memory_info
                            })
            
            return references
            
        except Exception as e:
            logger.error(f"Error finding string references: {e}")
            return references
    
    def analyze_data_structures(self, handle: int, address: int, size: int = 256) -> Dict[str, Any]:
        """Analyze potential data structures at address
        
        Args:
            handle: Process handle
            address: Address to analyze
            size: Size of data to analyze
            
        Returns:
            Analysis results
        """
        analysis = {
            'address': address,
            'size': size,
            'potential_types': [],
            'patterns': [],
            'pointers': [],
            'strings': []
        }
        
        try:
            data = self.read_process_memory(handle, address, size)
            if not data:
                return analysis
            
            # Look for potential pointers
            ptr_size = ctypes.sizeof(ctypes.c_void_p)
            for i in range(0, len(data) - ptr_size + 1, ptr_size):
                if ptr_size == 8:
                    ptr_value = struct.unpack('<Q', data[i:i+8])[0]
                else:
                    ptr_value = struct.unpack('<I', data[i:i+4])[0]
                
                # Check if this looks like a valid pointer
                # Use appropriate ranges for 32-bit vs 64-bit
                if ptr_size == 8:
                    # 64-bit: typical user space ranges
                    if 0x10000 <= ptr_value <= 0x7FFFFFFFFFFF:
                        # Try to read what it points to
                        pointed_data = self.read_process_memory(handle, ptr_value, 64)
                        if pointed_data:
                            analysis['pointers'].append({
                                'offset': i,
                                'address': ptr_value,
                                'preview': pointed_data[:16].hex()
                            })
                else:
                    # 32-bit: traditional range
                    if 0x10000 <= ptr_value <= 0x7FFFFFFF:
                        # Try to read what it points to
                        pointed_data = self.read_process_memory(handle, ptr_value, 64)
                        if pointed_data:
                            analysis['pointers'].append({
                                'offset': i,
                                'address': ptr_value,
                                'preview': pointed_data[:16].hex()
                            })
            
            # Look for potential strings
            for encoding in ['utf-8', 'ascii']:
                try:
                    decoded = data.decode(encoding, errors='ignore')
                    # Find printable strings of reasonable length
                    current_string = ""
                    for char in decoded:
                        if char in string.printable and char not in '\r\n\t':
                            current_string += char
                        else:
                            if len(current_string) >= 4:
                                analysis['strings'].append({
                                    'value': current_string,
                                    'encoding': encoding,
                                    'length': len(current_string)
                                })
                            current_string = ""
                    
                    if len(current_string) >= 4:
                        analysis['strings'].append({
                            'value': current_string,
                            'encoding': encoding,
                            'length': len(current_string)
                        })
                except UnicodeDecodeError:
                    pass
            
            # Look for patterns
            # Common patterns like repetitive data, arrays, etc.
            if len(data) >= 16:
                # Check for repeating patterns
                for pattern_size in [4, 8, 16]:
                    if len(data) >= pattern_size * 2:
                        pattern = data[:pattern_size]
                        if data[pattern_size:pattern_size*2] == pattern:
                            analysis['patterns'].append({
                                'type': 'repeating',
                                'pattern_size': pattern_size,
                                'pattern': pattern.hex()
                            })
            
            # Suggest potential data types
            if len(analysis['pointers']) > 2:
                analysis['potential_types'].append('vtable or function pointer array')
            if len(analysis['strings']) > 0:
                analysis['potential_types'].append('object with string members')
            if len(analysis['patterns']) > 0:
                analysis['potential_types'].append('array or structured data')
            
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing data structures at 0x{address:X}: {e}")
            return analysis
