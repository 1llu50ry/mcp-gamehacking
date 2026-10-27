"""
Process Manager Module
Handles process enumeration, attachment, and management
"""

import ctypes
import ctypes.wintypes
import psutil
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Windows API constants
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
PROCESS_VM_WRITE = 0x0020
PROCESS_VM_OPERATION = 0x0008
PROCESS_ALL_ACCESS = 0x1F0FFF

# Memory protection constants
PAGE_NOACCESS = 0x01
PAGE_READONLY = 0x02
PAGE_READWRITE = 0x04
PAGE_WRITECOPY = 0x08
PAGE_EXECUTE = 0x10
PAGE_EXECUTE_READ = 0x20
PAGE_EXECUTE_READWRITE = 0x40
PAGE_EXECUTE_WRITECOPY = 0x80

@dataclass
class ProcessInfo:
    """Process information structure"""
    pid: int
    name: str
    exe_path: str
    architecture: str
    memory_usage: int
    handle: Optional[int] = None
    access_level: str = "none"

class ProcessManager:
    """Manages process attachment and operations"""
    
    def __init__(self):
        self.current_process: Optional[ProcessInfo] = None
        self.kernel32 = ctypes.windll.kernel32
        
    def list_processes(self) -> List[Dict[str, Any]]:
        """Enumerate all running processes"""
        processes = []
        
        try:
            for proc in psutil.process_iter(['pid', 'name', 'exe', 'memory_info']):
                try:
                    info = proc.info
                    if info['name'] and info['pid'] > 0:
                        # Get architecture info
                        arch = self._get_process_architecture(info['pid'])
                        
                        processes.append({
                            'pid': info['pid'],
                            'name': info['name'],
                            'exe_path': info['exe'] or 'N/A',
                            'architecture': arch,
                            'memory_usage': info['memory_info'].rss if info['memory_info'] else 0
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    continue
                    
        except Exception as e:
            logger.error(f"Error enumerating processes: {e}")
            
        return sorted(processes, key=lambda x: x['name'].lower())
    
    def _get_process_architecture(self, pid: int) -> str:
        """Determine process architecture (32-bit or 64-bit)"""
        try:
            handle = self.kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, False, pid)
            if not handle:
                return "Unknown"
            
            try:
                # Check if process is WOW64 (32-bit on 64-bit Windows)
                is_wow64 = ctypes.wintypes.BOOL()
                if self.kernel32.IsWow64Process(handle, ctypes.byref(is_wow64)):
                    if is_wow64.value:
                        return "x86"
                    else:
                        # Check system architecture
                        import platform
                        if platform.machine().endswith('64'):
                            return "x64"
                        else:
                            return "x86"
                return "Unknown"
            finally:
                self.kernel32.CloseHandle(handle)
                
        except Exception:
            return "Unknown"
    
    def attach_process(self, identifier: str, access_level: str = "read") -> Dict[str, Any]:
        """Attach to a process by PID or name"""
        
        # Detach from current process if any
        if self.current_process:
            self.detach_process()
        
        # Find the process
        target_process = None
        
        if identifier.isdigit():
            # Attach by PID
            pid = int(identifier)
            try:
                proc = psutil.Process(pid)
                target_process = {
                    'pid': pid,
                    'name': proc.name(),
                    'exe_path': proc.exe(),
                    'memory_usage': proc.memory_info().rss
                }
            except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                raise Exception(f"Cannot access process {pid}: {e}")
        else:
            # Attach by name
            processes = self.list_processes()
            matches = [p for p in processes if p['name'].lower() == identifier.lower()]
            
            if not matches:
                raise Exception(f"Process '{identifier}' not found")
            
            if len(matches) > 1:
                raise Exception(f"Multiple processes found with name '{identifier}'. Use PID instead.")
            
            target_process = matches[0]
        
        # Determine required access rights
        if access_level == "read":
            access_rights = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
        elif access_level == "debug":
            access_rights = PROCESS_ALL_ACCESS
        else:
            raise Exception(f"Invalid access level: {access_level}")
        
        # Open process handle
        handle = self.kernel32.OpenProcess(
            access_rights, 
            False, 
            target_process['pid']
        )
        
        if not handle:
            error_code = ctypes.get_last_error()
            raise Exception(f"Failed to open process {target_process['pid']}: Error {error_code}")
        
        # Create process info
        self.current_process = ProcessInfo(
            pid=target_process['pid'],
            name=target_process['name'],
            exe_path=target_process['exe_path'],
            architecture=self._get_process_architecture(target_process['pid']),
            memory_usage=target_process['memory_usage'],
            handle=handle,
            access_level=access_level
        )
        
        logger.info(f"Successfully attached to process {self.current_process.pid} ({self.current_process.name})")
        
        return {
            'pid': self.current_process.pid,
            'name': self.current_process.name,
            'exe_path': self.current_process.exe_path,
            'architecture': self.current_process.architecture,
            'memory_usage': self.current_process.memory_usage,
            'access_level': self.current_process.access_level
        }
    
    def detach_process(self):
        """Detach from current process"""
        if self.current_process and self.current_process.handle:
            self.kernel32.CloseHandle(self.current_process.handle)
            logger.info(f"Detached from process {self.current_process.pid}")
        
        self.current_process = None
    
    def get_detailed_info(self, pid: int) -> Dict[str, Any]:
        """Get detailed information about a process"""
        try:
            proc = psutil.Process(pid)
            
            # Get memory information
            memory_info = proc.memory_info()
            memory_percent = proc.memory_percent()
            
            # Get CPU information
            cpu_percent = proc.cpu_percent()
            
            # Get threads
            threads = proc.threads()
            
            # Get environment variables (if accessible)
            try:
                environ = proc.environ()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                environ = {}
            
            # Get loaded modules (if accessible)
            try:
                modules = []
                for dll in proc.memory_maps():
                    modules.append({
                        'path': dll.path,
                        'rss': dll.rss,
                        'size': dll.size if hasattr(dll, 'size') else 0
                    })
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                modules = []
            
            return {
                'pid': pid,
                'name': proc.name(),
                'exe_path': proc.exe(),
                'architecture': self._get_process_architecture(pid),
                'status': proc.status(),
                'create_time': proc.create_time(),
                'cpu_percent': cpu_percent,
                'memory_info': {
                    'rss': memory_info.rss,
                    'vms': memory_info.vms,
                    'percent': memory_percent
                },
                'num_threads': proc.num_threads(),
                'threads': [{'id': t.id, 'user_time': t.user_time, 'system_time': t.system_time} 
                          for t in threads],
                'environ_count': len(environ),
                'modules_count': len(modules),
                'modules': modules[:10] if modules else []  # Limit to first 10 modules
            }
            
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            raise Exception(f"Cannot get detailed info for process {pid}: {e}")
    
    def get_current_process(self) -> Optional[ProcessInfo]:
        """Get currently attached process"""
        return self.current_process
    
    def is_process_accessible(self, pid: int, access_level: str = "read") -> bool:
        """Check if a process is accessible with the given access level"""
        try:
            if access_level == "read":
                access_rights = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
            elif access_level == "debug":
                access_rights = PROCESS_ALL_ACCESS
            else:
                return False
            
            handle = self.kernel32.OpenProcess(access_rights, False, pid)
            if handle:
                self.kernel32.CloseHandle(handle)
                return True
            return False
            
        except Exception:
            return False
    
    def __del__(self):
        """Cleanup on destruction"""
        if self.current_process:
            self.detach_process()
