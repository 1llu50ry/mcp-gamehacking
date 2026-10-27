"""
Process Permissions Module
Handles security and permission validation
"""

import ctypes
import ctypes.wintypes
import os
import logging
from typing import Set, List

logger = logging.getLogger(__name__)

class PermissionChecker:
    """Handles permission and security checks"""
    
    def __init__(self):
        self.kernel32 = ctypes.windll.kernel32
        self.advapi32 = ctypes.windll.advapi32
    
    def has_debug_privileges(self) -> bool:
        """Check if current process has debug privileges"""
        try:
            # Get current process token
            token = ctypes.wintypes.HANDLE()
            if not self.advapi32.OpenProcessToken(
                self.kernel32.GetCurrentProcess(),
                0x0020,  # TOKEN_ADJUST_PRIVILEGES
                ctypes.byref(token)
            ):
                return False
            
            try:
                # Check for SeDebugPrivilege
                privilege_name = "SeDebugPrivilege"
                luid = ctypes.wintypes.LUID()
                
                if not self.advapi32.LookupPrivilegeValueW(
                    None,
                    privilege_name,
                    ctypes.byref(luid)
                ):
                    return False
                
                # Check if privilege is enabled
                privilege_set = ctypes.create_string_buffer(16)  # PRIVILEGE_SET structure
                privilege_length = ctypes.wintypes.DWORD(16)
                result = ctypes.wintypes.BOOL()
                
                if self.advapi32.PrivilegeCheck(
                    token,
                    privilege_set,
                    ctypes.byref(result)
                ):
                    return bool(result.value)
                
                return False
                
            finally:
                self.kernel32.CloseHandle(token)
                
        except Exception as e:
            logger.warning(f"Failed to check debug privileges: {e}")
            return False
    
    def is_elevated(self) -> bool:
        """Check if current process is running with elevated privileges"""
        try:
            return ctypes.windll.shell32.IsUserAnAdmin()
        except Exception:
            return False
    
    def can_access_process(self, pid: int, access_level: str = "read") -> tuple[bool, str]:
        """Check if we can access a specific process with given access level"""
        try:
            if access_level == "read":
                access_rights = 0x0400 | 0x0010  # PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
            elif access_level == "debug":
                access_rights = 0x1F0FFF  # PROCESS_ALL_ACCESS
            else:
                return False, f"Invalid access level: {access_level}"
            
            handle = self.kernel32.OpenProcess(access_rights, False, pid)
            if handle:
                self.kernel32.CloseHandle(handle)
                return True, "Access granted"
            else:
                error_code = ctypes.get_last_error()
                return False, f"Access denied (Error {error_code})"
                
        except Exception as e:
            return False, f"Exception checking access: {e}"
    
    def get_security_recommendations(self) -> List[str]:
        """Get security recommendations for current environment"""
        recommendations = []
        
        if not self.is_elevated():
            recommendations.append("Consider running as administrator for full functionality")
        
        if not self.has_debug_privileges():
            recommendations.append("Debug privileges not available - some features may be limited")
        
        return recommendations
    
    def validate_address(self, address: int) -> bool:
        """Validate that an address is within reasonable bounds"""
        # Basic sanity checks for memory addresses
        if address < 0:
            return False
        
        # Check for obviously invalid addresses
        if address < 0x1000:  # Null page
            return False
        
        # Check for addresses that are too high (basic check)
        if address > 0x7FFFFFFFFFFF:  # Max user-mode address on x64
            return False
        
        return True
    
    def validate_size(self, size: int) -> bool:
        """Validate that a size parameter is reasonable"""
        if size <= 0:
            return False
        
        # Limit maximum read size to prevent abuse
        if size > 1024 * 1024 * 100:  # 100MB max
            return False
        
        return True
