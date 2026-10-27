#!/usr/bin/env python3
"""
Simple and Reliable MCP Client
Focuses on working automation with basic memory scanning
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

class ReliableMCPClient:
    """Reliable MCP client with working automation and simple memory scanning"""
    
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
            
            self.kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
            self.kernel32.CloseHandle.restype = ctypes.wintypes.BOOL
            
            logger.info("✅ Windows API initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Windows API: {e}")
            raise
    
    def open_notepad(self) -> bool:
        """Open Notepad reliably"""
        try:
            logger.info("🚀 Opening Notepad...")
            
            # Clear any existing notepad processes
            self._cleanup_notepad()
            
            # Use the more reliable approach
            if hasattr(self, 'use_fallback'):
                # Use Windows key method
                self.pyautogui.press('win')
                time.sleep(1)
                self.pyautogui.write('notepad', interval=0.1)
                time.sleep(1)
                self.pyautogui.press('enter')
            else:
                # Use MCP method
                self.pyautogui_controller.press_key("win")
                time.sleep(1)
                self.pyautogui_controller.type_text("notepad", interval=0.1)
                time.sleep(1)
                self.pyautogui_controller.press_key("enter")
            
            # Wait for Notepad to load
            time.sleep(3)
            
            # Verify it opened
            pid = self._find_notepad()
            if pid:
                logger.info(f"✅ Notepad opened successfully (PID: {pid})")
                return True
            else:
                logger.error("❌ Failed to open Notepad")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error opening Notepad: {e}")
            return False
    
    def _cleanup_notepad(self):
        """Clean up existing Notepad processes"""
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.info['name'].lower() == 'notepad.exe':
                    try:
                        process = psutil.Process(proc.info['pid'])
                        process.terminate()
                        logger.info(f"Cleaned up existing Notepad PID: {proc.info['pid']}")
                    except:
                        pass
            time.sleep(1)
        except:
            pass
    
    def _find_notepad(self) -> Optional[int]:
        """Find Notepad process"""
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.info['name'].lower() == 'notepad.exe':
                    return proc.info['pid']
            return None
        except:
            return None
    
    def send_text(self, text: str) -> bool:
        """Send text to Notepad"""
        try:
            logger.info(f"⌨️ Sending text: '{text}'")
            
            if hasattr(self, 'use_fallback'):
                self.pyautogui.write(text, interval=0.1)
                time.sleep(0.5)
                self.pyautogui.press('enter')
                self.pyautogui.write("TEST_STRING_FOR_MEMORY_SCAN", interval=0.1)
                time.sleep(0.5)
                self.pyautogui.press('enter')
                self.pyautogui.write("SIMPLE_SCAN_TARGET", interval=0.1)
            else:
                self.pyautogui_controller.type_text(text, interval=0.1)
                time.sleep(0.5)
                self.pyautogui_controller.press_key("enter")
                self.pyautogui_controller.type_text("TEST_STRING_FOR_MEMORY_SCAN", interval=0.1)
                time.sleep(0.5)
                self.pyautogui_controller.press_key("enter")
                self.pyautogui_controller.type_text("SIMPLE_SCAN_TARGET", interval=0.1)
            
            time.sleep(1)
            logger.info("✅ Text sent successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending text: {e}")
            return False
    
    def simple_memory_scan(self, pid: int, search_text: str) -> List[Dict[str, Any]]:
        """Simple memory scanning approach"""
        try:
            logger.info(f"🔍 Simple memory scan for: '{search_text}' in PID {pid}")
            
            # Open process
            PROCESS_VM_READ = 0x0010
            PROCESS_QUERY_INFORMATION = 0x0400
            handle = self.kernel32.OpenProcess(
                PROCESS_VM_READ | PROCESS_QUERY_INFORMATION,
                False,
                pid
            )
            
            if not handle:
                error = ctypes.get_last_error()
                logger.error(f"❌ Failed to open process: Error {error}")
                return []
            
            try:
                results = []
                
                # Try different encodings
                encodings = [
                    ('UTF-8', search_text.encode('utf-8')),
                    ('UTF-16LE', search_text.encode('utf-16le')),
                    ('ASCII', search_text.encode('ascii', errors='ignore'))
                ]
                
                # Simple memory regions to check
                regions = [
                    (0x00400000, 0x00800000),  # Main executable
                    (0x10000000, 0x11000000),  # Heap area
                    (0x7FF00000, 0x7FF80000),  # High memory
                ]
                
                for encoding_name, pattern in encodings:
                    logger.info(f"   Trying {encoding_name}: {pattern.hex()}")
                    
                    for start_addr, end_addr in regions:
                        found = self._scan_simple_region(handle, start_addr, end_addr, pattern, search_text, encoding_name)
                        results.extend(found)
                        
                        if len(results) >= 5:  # Limit results
                            break
                    
                    if len(results) >= 5:
                        break
                
                logger.info(f"✅ Found {len(results)} memory locations")
                return results
                
            finally:
                self.kernel32.CloseHandle(handle)
                
        except Exception as e:
            logger.error(f"❌ Memory scan error: {e}")
            return []
    
    def _scan_simple_region(self, handle: int, start_addr: int, end_addr: int, 
                           pattern: bytes, search_text: str, encoding: str) -> List[Dict[str, Any]]:
        """Scan a simple memory region"""
        try:
            results = []
            chunk_size = 4096  # 4KB chunks
            
            for addr in range(start_addr, end_addr, chunk_size):
                try:
                    # Read memory
                    buffer = ctypes.create_string_buffer(chunk_size)
                    bytes_read = ctypes.c_size_t()
                    
                    success = self.kernel32.ReadProcessMemory(
                        handle,
                        ctypes.c_void_p(addr),
                        buffer,
                        chunk_size,
                        ctypes.byref(bytes_read)
                    )
                    
                    if success and bytes_read.value > 0:
                        data = buffer.raw[:bytes_read.value]
                        
                        # Look for pattern
                        if pattern in data:
                            offset = data.find(pattern)
                            found_addr = addr + offset
                            
                            result = {
                                "address": found_addr,
                                "hex_address": f"0x{found_addr:X}",
                                "target_text": search_text,
                                "encoding": encoding,
                                "pattern": pattern.hex(),
                                "success": True
                            }
                            
                            results.append(result)
                            logger.info(f"   📍 Found {encoding} at 0x{found_addr:X}")
                            
                            if len(results) >= 2:  # Limit per region
                                break
                
                except Exception:
                    continue  # Skip failed reads
            
            return results
            
        except Exception as e:
            logger.warning(f"Region scan error: {e}")
            return []
    
    def close_notepad(self) -> bool:
        """Close Notepad"""
        try:
            logger.info("🔒 Closing Notepad...")
            
            if hasattr(self, 'use_fallback'):
                self.pyautogui.hotkey('alt', 'f4')
                time.sleep(1)
                self.pyautogui.press('n')  # Don't save
            else:
                self.pyautogui_controller.key_combination(["alt", "f4"])
                time.sleep(1)
                self.pyautogui_controller.press_key("n")
            
            time.sleep(2)
            
            # Verify closed
            pid = self._find_notepad()
            if pid is None:
                logger.info("✅ Notepad closed successfully")
                return True
            else:
                logger.warning(f"Notepad still running, force closing PID: {pid}")
                try:
                    proc = psutil.Process(pid)
                    proc.terminate()
                    logger.info("✅ Notepad force closed")
                    return True
                except:
                    return False
                    
        except Exception as e:
            logger.error(f"❌ Error closing Notepad: {e}")
            return False
    
    def run_reliable_automation(self) -> bool:
        """Run reliable automation workflow"""
        try:
            logger.info("🎯 Starting Reliable MCP Automation Workflow")
            logger.info("=" * 60)
            
            # Step 1: Open Notepad
            if not self.open_notepad():
                return False
            
            # Step 2: Send text
            main_text = "Hello World MCP Test"
            if not self.send_text(main_text):
                return False
            
            # Step 3: Find process
            pid = self._find_notepad()
            if not pid:
                logger.error("❌ Cannot find Notepad process")
                return False
            
            logger.info(f"✅ Found Notepad process: PID {pid}")
            
            # Step 4: Memory scan
            search_targets = [
                "Hello World MCP Test",
                "TEST_STRING_FOR_MEMORY_SCAN",
                "SIMPLE_SCAN_TARGET"
            ]
            
            all_results = []
            for target in search_targets:
                results = self.simple_memory_scan(pid, target)
                all_results.extend(results)
            
            if all_results:
                logger.info("🎯 Memory Scan Results:")
                logger.info("-" * 40)
                for i, result in enumerate(all_results, 1):
                    logger.info(f"  {i}. Address: {result['hex_address']}")
                    logger.info(f"     Text: '{result['target_text']}'")
                    logger.info(f"     Encoding: {result['encoding']}")
                    logger.info(f"     Pattern: {result['pattern'][:32]}...")
                    logger.info("")
            else:
                logger.warning("⚠️ No memory locations found")
            
            # Step 5: Close Notepad
            self.close_notepad()
            
            logger.info("=" * 60)
            if all_results:
                logger.info("🎉 RELIABLE MCP AUTOMATION SUCCESSFUL!")
                logger.info(f"✅ Found {len(all_results)} memory locations")
                logger.info("✅ All operations completed successfully")
            else:
                logger.info("⚠️ PARTIAL SUCCESS - Automation worked, memory scan needs improvement")
                logger.info("✅ Notepad automation: WORKING")
                logger.info("⚠️ Memory scanning: NEEDS REFINEMENT")
            logger.info("=" * 60)
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Reliable automation failed: {e}")
            return False

def main():
    """Main function"""
    try:
        logger.info("🚀 Starting Reliable MCP Client")
        
        client = ReliableMCPClient()
        success = client.run_reliable_automation()
        
        if success:
            logger.info("🎉 Reliable MCP automation completed!")
        else:
            logger.error("❌ Reliable MCP automation failed")
        
    except KeyboardInterrupt:
        logger.info("Automation interrupted by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
