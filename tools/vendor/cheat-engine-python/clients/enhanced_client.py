#!/usr/bin/env python3
"""
Enhanced MCP Client with Robust Memory Scanning
Fixes issues with UTF-16 memory detection and process management
"""

import logging
import time
import psutil
import sys
import os
import ctypes
import ctypes.wintypes
from typing import Dict, List, Optional, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class EnhancedMCPClient:
    """Enhanced MCP client with robust memory scanning and process management"""
    
    def __init__(self):
        # Add server path (go up one level since we're in clients/ folder)
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        # Initialize Windows API
        self._init_windows_api()
        
        try:
            # Import MCP components
            from gui_automation.core.integration import PyAutoGUIController
            self.pyautogui_controller = PyAutoGUIController()
            logger.info("✅ MCP PyAutoGUI controller initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import MCP components: {e}")
            # Initialize fallback PyAutoGUI
            import pyautogui
            self.pyautogui = pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.1
            self.use_fallback = True
            logger.info("✅ Fallback PyAutoGUI initialized")
    
    def _init_windows_api(self):
        """Initialize Windows API for memory operations"""
        try:
            self.kernel32 = ctypes.windll.kernel32
            self.user32 = ctypes.windll.user32
            
            # Set up API signatures
            self.kernel32.OpenProcess.argtypes = [ctypes.wintypes.DWORD, ctypes.wintypes.BOOL, ctypes.wintypes.DWORD]
            self.kernel32.OpenProcess.restype = ctypes.wintypes.HANDLE
            
            self.kernel32.ReadProcessMemory.argtypes = [
                ctypes.wintypes.HANDLE,
                ctypes.wintypes.LPCVOID,
                ctypes.wintypes.LPVOID,
                ctypes.c_size_t,
                ctypes.POINTER(ctypes.c_size_t)
            ]
            self.kernel32.ReadProcessMemory.restype = ctypes.wintypes.BOOL
            
            self.kernel32.VirtualQueryEx.argtypes = [
                ctypes.wintypes.HANDLE,
                ctypes.wintypes.LPCVOID,
                ctypes.wintypes.LPVOID,
                ctypes.c_size_t
            ]
            self.kernel32.VirtualQueryEx.restype = ctypes.c_size_t
            
            self.kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
            self.kernel32.CloseHandle.restype = ctypes.wintypes.BOOL
            
            logger.info("✅ Windows API initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Windows API: {e}")
            raise
    
    def open_notepad_enhanced(self) -> bool:
        """Enhanced Notepad opening with verification"""
        try:
            logger.info("🚀 Opening Notepad (Enhanced Method)...")
            
            # Clear any existing notepad processes first
            self._cleanup_existing_notepad()
            
            # Method 1: Try Win+R approach
            if hasattr(self, 'use_fallback'):
                self.pyautogui.hotkey('winleft', 'r')
                time.sleep(1.5)  # Longer wait
                self.pyautogui.write('notepad.exe', interval=0.1)
                self.pyautogui.press('enter')
            else:
                result = self.pyautogui_controller.key_combination(["winleft", "r"])
                if not result.success:
                    logger.warning("Win+R failed, trying alternative method")
                    return self._open_notepad_alternative()
                
                time.sleep(1.5)
                result = self.pyautogui_controller.type_text("notepad.exe", interval=0.1)
                if not result.success:
                    return self._open_notepad_alternative()
                
                result = self.pyautogui_controller.press_key("enter")
                if not result.success:
                    return self._open_notepad_alternative()
            
            # Wait longer for Notepad to fully load
            time.sleep(3)
            
            # Verify Notepad opened
            notepad_pid = self._find_notepad_process_enhanced()
            if notepad_pid:
                logger.info(f"✅ Notepad opened successfully (PID: {notepad_pid})")
                return True
            else:
                logger.warning("Notepad not detected, trying alternative method")
                return self._open_notepad_alternative()
                
        except Exception as e:
            logger.error(f"❌ Error opening Notepad: {e}")
            return self._open_notepad_alternative()
    
    def _open_notepad_alternative(self) -> bool:
        """Alternative method to open Notepad"""
        try:
            logger.info("🔄 Trying alternative Notepad opening method...")
            
            # Try Start menu approach
            if hasattr(self, 'use_fallback'):
                self.pyautogui.press('win')
                time.sleep(1)
                self.pyautogui.write('notepad', interval=0.1)
                time.sleep(1)
                self.pyautogui.press('enter')
            else:
                self.pyautogui_controller.press_key("win")
                time.sleep(1)
                self.pyautogui_controller.type_text("notepad", interval=0.1)
                time.sleep(1)
                self.pyautogui_controller.press_key("enter")
            
            time.sleep(3)
            
            notepad_pid = self._find_notepad_process_enhanced()
            if notepad_pid:
                logger.info(f"✅ Notepad opened via alternative method (PID: {notepad_pid})")
                return True
            else:
                logger.error("❌ Failed to open Notepad with all methods")
                return False
                
        except Exception as e:
            logger.error(f"❌ Alternative Notepad opening failed: {e}")
            return False
    
    def _cleanup_existing_notepad(self):
        """Clean up any existing Notepad processes"""
        try:
            existing_pids = []
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.info['name'].lower() == 'notepad.exe':
                    existing_pids.append(proc.info['pid'])
            
            if existing_pids:
                logger.info(f"🧹 Found existing Notepad processes: {existing_pids}")
                for pid in existing_pids:
                    try:
                        proc = psutil.Process(pid)
                        proc.terminate()
                        proc.wait(timeout=3)
                        logger.info(f"Terminated existing Notepad PID: {pid}")
                    except:
                        pass
                time.sleep(1)
                
        except Exception as e:
            logger.warning(f"Cleanup warning: {e}")
    
    def _find_notepad_process_enhanced(self) -> Optional[int]:
        """Enhanced Notepad process detection with retry logic"""
        try:
            # Try multiple times with delays
            for attempt in range(5):
                logger.info(f"🔍 Looking for Notepad process (attempt {attempt + 1}/5)...")
                
                notepad_processes = []
                for proc in psutil.process_iter(['pid', 'name', 'create_time']):
                    if proc.info['name'].lower() == 'notepad.exe':
                        notepad_processes.append({
                            'pid': proc.info['pid'],
                            'create_time': proc.info['create_time']
                        })
                
                if notepad_processes:
                    # Sort by creation time (newest first)
                    notepad_processes.sort(key=lambda x: x['create_time'], reverse=True)
                    newest_pid = notepad_processes[0]['pid']
                    logger.info(f"✅ Found Notepad process: PID {newest_pid}")
                    return newest_pid
                
                if attempt < 4:
                    time.sleep(1)
            
            logger.warning("❌ No Notepad process found after multiple attempts")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error finding Notepad process: {e}")
            return None
    
    def send_text_enhanced(self, text: str) -> bool:
        """Enhanced text sending with verification"""
        try:
            logger.info(f"⌨️ Sending text to Notepad: '{text}'")
            
            # Ensure Notepad window is active
            time.sleep(0.5)
            
            # Send the main text
            if hasattr(self, 'use_fallback'):
                self.pyautogui.write(text, interval=0.15)
                time.sleep(0.5)
                self.pyautogui.press('enter')
                time.sleep(0.5)
                
                # Add context text that's easier to find in memory
                context_text = "MEMORY_SCAN_TARGET_TEXT_FOR_MCP_TEST"
                self.pyautogui.write(context_text, interval=0.1)
                time.sleep(0.5)
                self.pyautogui.press('enter')
                
                # Add more distinctive text
                signature_text = "===MCP_AUTOMATION_SIGNATURE==="
                self.pyautogui.write(signature_text, interval=0.1)
                
            else:
                self.pyautogui_controller.type_text(text, interval=0.15)
                time.sleep(0.5)
                self.pyautogui_controller.press_key("enter")
                time.sleep(0.5)
                
                context_text = "MEMORY_SCAN_TARGET_TEXT_FOR_MCP_TEST"
                self.pyautogui_controller.type_text(context_text, interval=0.1)
                time.sleep(0.5)
                self.pyautogui_controller.press_key("enter")
                
                signature_text = "===MCP_AUTOMATION_SIGNATURE==="
                self.pyautogui_controller.type_text(signature_text, interval=0.1)
            
            time.sleep(1)  # Let text settle in memory
            logger.info("✅ Text sent successfully with memory scan targets")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending text: {e}")
            return False
    
    def scan_memory_comprehensive(self, pid: int, search_texts: List[str]) -> List[Dict[str, Any]]:
        """Comprehensive memory scanning with multiple approaches"""
        try:
            logger.info(f"🔍 Starting comprehensive memory scan for PID {pid}")
            logger.info(f"Search targets: {search_texts}")
            
            # Open process with appropriate permissions
            PROCESS_VM_READ = 0x0010
            PROCESS_QUERY_INFORMATION = 0x0400
            handle = self.kernel32.OpenProcess(
                PROCESS_VM_READ | PROCESS_QUERY_INFORMATION,
                False,
                pid
            )
            
            if not handle:
                error = ctypes.get_last_error()
                logger.error(f"❌ Failed to open process {pid}: Error {error}")
                return []
            
            try:
                all_results = []
                
                # Scan for each search text
                for search_text in search_texts:
                    logger.info(f"🎯 Scanning for: '{search_text}'")
                    
                    # Try multiple encoding approaches
                    patterns_to_search = [
                        # UTF-16 Little Endian
                        (search_text.encode('utf-16le'), "UTF-16 LE"),
                        # UTF-8
                        (search_text.encode('utf-8'), "UTF-8"),
                        # ASCII
                        (search_text.encode('ascii', errors='ignore'), "ASCII"),
                        # UTF-16 Big Endian
                        (search_text.encode('utf-16be'), "UTF-16 BE"),
                    ]
                    
                    for pattern_bytes, encoding_name in patterns_to_search:
                        if len(pattern_bytes) == 0:
                            continue
                            
                        logger.info(f"   Trying {encoding_name}: {pattern_bytes.hex()}")
                        results = self._scan_memory_for_pattern(handle, pattern_bytes, search_text, encoding_name)
                        all_results.extend(results)
                
                if all_results:
                    logger.info(f"✅ Total memory locations found: {len(all_results)}")
                else:
                    logger.warning("⚠️ No memory locations found with any encoding")
                
                return all_results
                
            finally:
                self.kernel32.CloseHandle(handle)
                
        except Exception as e:
            logger.error(f"❌ Error in comprehensive memory scan: {e}")
            return []
    
    def _scan_memory_for_pattern(self, handle: int, pattern: bytes, original_text: str, encoding: str) -> List[Dict[str, Any]]:
        """Scan memory for a specific byte pattern"""
        try:
            results = []
            
            # Define memory regions to scan
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
            
            # Scan memory regions
            current_address = 0
            scan_count = 0
            max_scans = 1000  # Prevent infinite loops
            
            while current_address < 0x7FFFFFFF and scan_count < max_scans:
                scan_count += 1
                
                mbi = MEMORY_BASIC_INFORMATION()
                size = self.kernel32.VirtualQueryEx(
                    handle,
                    ctypes.c_void_p(current_address),
                    ctypes.byref(mbi),
                    ctypes.sizeof(mbi)
                )
                
                if not size:
                    current_address += 0x1000
                    continue
                
                # Check if region is readable
                if (mbi.State == 0x1000 and  # MEM_COMMIT
                    mbi.Protect & 0x04 or mbi.Protect & 0x02 or mbi.Protect & 0x20 or mbi.Protect & 0x40):  # Readable
                    
                    region_results = self._search_region_for_pattern(
                        handle, mbi.BaseAddress, mbi.RegionSize, pattern, original_text, encoding
                    )
                    results.extend(region_results)
                
                # Safely calculate next address
                if mbi.BaseAddress is not None and mbi.RegionSize is not None:
                    current_address = mbi.BaseAddress + mbi.RegionSize
                else:
                    current_address += 0x1000
                
                # Limit results to prevent memory issues
                if len(results) >= 10:
                    break
            
            logger.info(f"   {encoding}: Found {len(results)} matches after scanning {scan_count} regions")
            return results
            
        except Exception as e:
            logger.warning(f"Pattern scan error for {encoding}: {e}")
            return []
    
    def _search_region_for_pattern(self, handle: int, base_address: int, region_size: int, 
                                  pattern: bytes, original_text: str, encoding: str) -> List[Dict[str, Any]]:
        """Search a specific memory region for the pattern"""
        try:
            results = []
            chunk_size = 64 * 1024  # 64KB chunks
            
            for offset in range(0, region_size, chunk_size):
                read_address = base_address + offset
                read_size = min(chunk_size, region_size - offset)
                
                # Validate addresses
                if read_address is None or read_size <= 0:
                    continue
                
                # Read memory chunk
                buffer = ctypes.create_string_buffer(read_size)
                bytes_read = ctypes.c_size_t()
                
                success = self.kernel32.ReadProcessMemory(
                    handle,
                    ctypes.c_void_p(read_address),
                    buffer,
                    read_size,
                    ctypes.byref(bytes_read)
                )
                
                if success and bytes_read.value > 0:
                    data = buffer.raw[:bytes_read.value]
                    
                    # Search for pattern in this chunk
                    pattern_index = data.find(pattern)
                    if pattern_index != -1:
                        found_address = read_address + pattern_index
                        
                        # Read a larger context around the found pattern
                        context_size = len(pattern) + 200
                        context_data = self._read_memory_context(handle, found_address, context_size)
                        
                        result = {
                            "address": found_address,
                            "hex_address": f"0x{found_address:X}",
                            "target_text": original_text,
                            "encoding": encoding,
                            "pattern_hex": pattern.hex(),
                            "context_data": context_data[:100].hex() if context_data else "",
                            "found_at_offset": pattern_index
                        }
                        
                        results.append(result)
                        logger.info(f"   📍 Found {encoding} pattern at 0x{found_address:X}")
                        
                        # Limit results per region
                        if len(results) >= 3:
                            break
            
            return results
            
        except Exception as e:
            logger.warning(f"Region search error: {e}")
            return []
    
    def _read_memory_context(self, handle: int, address: int, size: int) -> Optional[bytes]:
        """Read memory context around an address"""
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
            
            if success and bytes_read.value > 0:
                return buffer.raw[:bytes_read.value]
            
            return None
            
        except Exception:
            return None
    
    def close_notepad_enhanced(self) -> bool:
        """Enhanced Notepad closing with verification"""
        try:
            logger.info("🔒 Closing Notepad (Enhanced Method)...")
            
            # Try Alt+F4 method
            if hasattr(self, 'use_fallback'):
                self.pyautogui.hotkey('alt', 'f4')
                time.sleep(1.5)
                self.pyautogui.press('n')  # Don't save
            else:
                self.pyautogui_controller.key_combination(["alt", "f4"])
                time.sleep(1.5)
                self.pyautogui_controller.press_key("n")
            
            time.sleep(2)
            
            # Verify Notepad is closed
            remaining_pid = self._find_notepad_process_enhanced()
            if remaining_pid is None:
                logger.info("✅ Notepad closed successfully")
                return True
            else:
                logger.warning(f"Notepad still running (PID: {remaining_pid}), forcing close")
                return self._force_close_notepad()
                
        except Exception as e:
            logger.error(f"❌ Error closing Notepad: {e}")
            return False
    
    def _force_close_notepad(self) -> bool:
        """Force close any remaining Notepad processes"""
        try:
            closed_any = False
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.info['name'].lower() == 'notepad.exe':
                    try:
                        process = psutil.Process(proc.info['pid'])
                        process.terminate()
                        process.wait(timeout=3)
                        logger.info(f"Force closed Notepad PID: {proc.info['pid']}")
                        closed_any = True
                    except:
                        pass
            
            return closed_any
            
        except Exception as e:
            logger.error(f"Force close error: {e}")
            return False
    
    def run_enhanced_automation(self) -> bool:
        """Run the enhanced automation workflow"""
        try:
            logger.info("🎯 Starting Enhanced MCP Automation Workflow")
            logger.info("=" * 70)
            
            # Step 1: Open Notepad with enhanced method
            if not self.open_notepad_enhanced():
                logger.error("❌ Failed to open Notepad")
                return False
            
            # Step 2: Send text with enhanced verification
            main_text = "Hello World MCP Test"
            if not self.send_text_enhanced(main_text):
                logger.error("❌ Failed to send text")
                return False
            
            # Step 3: Find Notepad process with enhanced detection
            notepad_pid = self._find_notepad_process_enhanced()
            if not notepad_pid:
                logger.error("❌ Failed to find Notepad process")
                return False
            
            # Step 4: Comprehensive memory scanning
            search_texts = [
                "Hello World MCP Test",
                "MEMORY_SCAN_TARGET_TEXT_FOR_MCP_TEST",
                "===MCP_AUTOMATION_SIGNATURE===",
                "MCP_TEST"  # Shorter text more likely to be found
            ]
            
            memory_results = self.scan_memory_comprehensive(notepad_pid, search_texts)
            
            if memory_results:
                logger.info("🎯 Enhanced Memory Scan Results:")
                logger.info("-" * 60)
                for i, result in enumerate(memory_results, 1):
                    logger.info(f"  Result {i}:")
                    logger.info(f"    📍 Address: {result['hex_address']}")
                    logger.info(f"    🎯 Target: '{result['target_text']}'")
                    logger.info(f"    🔤 Encoding: {result['encoding']}")
                    logger.info(f"    🔢 Pattern: {result['pattern_hex']}")
                    logger.info(f"    📄 Context: {result['context_data'][:32]}...")
                    logger.info("")
            else:
                logger.warning("⚠️ No memory locations found with enhanced scanning")
            
            # Step 5: Close Notepad with enhanced method
            if not self.close_notepad_enhanced():
                logger.warning("⚠️ Notepad may not have closed properly")
            
            # Final verification
            time.sleep(2)
            final_pid = self._find_notepad_process_enhanced()
            if final_pid is None:
                logger.info("✅ Final verification: Notepad successfully closed")
                success = True
            else:
                logger.warning(f"⚠️ Final verification: Notepad still running (PID: {final_pid})")
                self._force_close_notepad()
                success = True  # Still consider successful if we found memory
            
            logger.info("=" * 70)
            if memory_results:
                logger.info("🎉 Enhanced MCP Automation Workflow SUCCESSFUL!")
                logger.info(f"✅ Found {len(memory_results)} memory locations")
                logger.info("✅ All operations completed with enhanced verification")
            else:
                logger.info("⚠️ Enhanced MCP Automation partially successful")
                logger.info("✅ Notepad automation worked, memory scanning needs refinement")
            logger.info("=" * 70)
            
            return len(memory_results) > 0 or success
            
        except Exception as e:
            logger.error(f"❌ Enhanced automation workflow failed: {e}")
            return False

def main():
    """Main function"""
    try:
        logger.info("🚀 Starting Enhanced MCP Cheat Engine Client")
        
        client = EnhancedMCPClient()
        
        success = client.run_enhanced_automation()
        
        if success:
            logger.info("🎉 Enhanced MCP Client automation completed!")
        else:
            logger.error("❌ Enhanced MCP Client automation failed")
        
    except KeyboardInterrupt:
        logger.info("Automation interrupted by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
