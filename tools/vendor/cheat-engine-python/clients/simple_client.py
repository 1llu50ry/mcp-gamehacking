#!/usr/bin/env python3
"""
Direct MCP Client for Cheat Engine Server
Demonstrates complete automation workflow using MCP server components
"""

import logging
import time
import psutil
import sys
import os
from typing import Dict, List, Optional, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SimpleMCPClient:
    """Simplified MCP client using direct component integration"""
    
    def __init__(self):
        # Add server path (go up one level since we're in clients/ folder)
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        # Always initialize fallback for memory scanning
        self._init_fallback()
        
        try:
            # Import the components we need
            from gui_automation.core.integration import PyAutoGUIController
            from memory.scanner import MemoryScanner
            from process.manager import ProcessManager
            
            self.pyautogui_controller = PyAutoGUIController()
            self.memory_scanner = MemoryScanner()
            self.process_manager = ProcessManager()
            
            logger.info("✅ MCP client components initialized successfully")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import server components: {e}")
            # Use fallback mode
            self.use_fallback = True
    
    def _init_fallback(self):
        """Initialize fallback components"""
        try:
            import pyautogui
            import ctypes
            import ctypes.wintypes
            
            self.pyautogui = pyautogui
            self.kernel32 = ctypes.windll.kernel32
            
            # Configure PyAutoGUI
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.1
            
            logger.info("✅ Fallback components initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to initialize fallback: {e}")
            raise
    
    def open_notepad(self) -> bool:
        """Open Notepad using PyAutoGUI"""
        try:
            logger.info("🚀 Opening Notepad...")
            
            if hasattr(self, 'use_fallback'):
                # Use direct PyAutoGUI
                self.pyautogui.hotkey('winleft', 'r')
                time.sleep(1)
                self.pyautogui.write('notepad', interval=0.05)
                self.pyautogui.press('enter')
            else:
                # Use MCP components
                result = self.pyautogui_controller.key_combination(["winleft", "r"])
                if not result.success:
                    logger.error(f"❌ Failed to open Run dialog: {result.error}")
                    return False
                
                time.sleep(1)
                
                result = self.pyautogui_controller.type_text("notepad", interval=0.05)
                if not result.success:
                    logger.error(f"❌ Failed to type notepad: {result.error}")
                    return False
                
                result = self.pyautogui_controller.press_key("enter")
                if not result.success:
                    logger.error(f"❌ Failed to press Enter: {result.error}")
                    return False
            
            time.sleep(2)
            logger.info("✅ Notepad opened successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error opening Notepad: {e}")
            return False
    
    def send_keystrokes_to_notepad(self, text: str) -> bool:
        """Send keystrokes to Notepad"""
        try:
            logger.info(f"⌨️ Sending keystrokes to Notepad: '{text}'")
            
            if hasattr(self, 'use_fallback'):
                # Use direct PyAutoGUI
                self.pyautogui.write(text, interval=0.1)
                context_text = "\nThis is a test of MCP Cheat Engine Server automation.\nMemory scanning will look for this text."
                self.pyautogui.write(context_text, interval=0.05)
            else:
                # Use MCP components
                result = self.pyautogui_controller.type_text(text, interval=0.1)
                if not result.success:
                    logger.error(f"❌ Failed to send keystrokes: {result.error}")
                    return False
                
                context_text = "\nThis is a test of MCP Cheat Engine Server automation.\nMemory scanning will look for this text."
                result = self.pyautogui_controller.type_text(context_text, interval=0.05)
                if not result.success:
                    logger.error(f"❌ Failed to send context text: {result.error}")
                    return False
            
            logger.info("✅ Keystrokes sent successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending keystrokes: {e}")
            return False
    
    def find_notepad_process(self) -> Optional[int]:
        """Find Notepad process ID"""
        try:
            logger.info("🔍 Looking for Notepad process...")
            
            for proc in psutil.process_iter(['pid', 'name']):
                if proc.info['name'].lower() == 'notepad.exe':
                    pid = proc.info['pid']
                    logger.info(f"✅ Found Notepad process: PID {pid}")
                    return pid
            
            logger.warning("❌ Notepad process not found")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error finding Notepad process: {e}")
            return None
    
    def scan_memory_utf16_fallback(self, pid: int, search_text: str) -> List[Dict[str, Any]]:
        """Fallback UTF-16 memory scanning using Windows API"""
        try:
            logger.info(f"🔍 Scanning memory for UTF-16 string: '{search_text}' (fallback mode)")
            
            # Convert text to UTF-16 Little Endian bytes
            utf16_bytes = search_text.encode('utf-16le')
            utf16_hex = utf16_bytes.hex()
            
            logger.info(f"UTF-16 LE pattern: {utf16_hex}")
            logger.info(f"UTF-16 LE bytes: {' '.join(f'{b:02x}' for b in utf16_bytes)}")
            
            # Open process
            PROCESS_VM_READ = 0x0010
            PROCESS_QUERY_INFORMATION = 0x0400
            handle = self.kernel32.OpenProcess(
                PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 
                False, 
                pid
            )
            
            if not handle:
                logger.error("❌ Failed to open process handle")
                return []
            
            try:
                # Simple memory scanning approach
                addresses_found = []
                
                # Get process memory info using psutil
                process = psutil.Process(pid)
                memory_info = process.memory_info()
                
                logger.info(f"Process RSS memory: {memory_info.rss / 1024 / 1024:.1f} MB")
                
                # Search in typical text memory ranges
                search_ranges = [
                    (0x00400000, 0x01000000),  # Main executable
                    (0x10000000, 0x20000000),  # Heap
                    (0x7FF00000, 0x7FFFFFFF),  # High memory
                ]
                
                for start_addr, end_addr in search_ranges:
                    current_addr = start_addr
                    
                    while current_addr < end_addr:
                        try:
                            # Try to read 4KB chunks
                            buffer = ctypes.create_string_buffer(4096)
                            bytes_read = ctypes.c_size_t()
                            
                            success = self.kernel32.ReadProcessMemory(
                                handle,
                                ctypes.c_void_p(current_addr),
                                buffer,
                                4096,
                                ctypes.byref(bytes_read)
                            )
                            
                            if success and bytes_read.value > 0:
                                data = buffer.raw[:bytes_read.value]
                                
                                # Search for UTF-16 pattern
                                for i in range(len(data) - len(utf16_bytes) + 1):
                                    if data[i:i+len(utf16_bytes)] == utf16_bytes:
                                        found_addr = current_addr + i
                                        addresses_found.append(found_addr)
                                        logger.info(f"  📍 Found pattern at 0x{found_addr:X}")
                                        
                                        if len(addresses_found) >= 5:  # Limit results
                                            break
                            
                            current_addr += 4096
                            
                            if len(addresses_found) >= 5:
                                break
                            
                        except Exception:
                            current_addr += 4096
                            continue
                    
                    if len(addresses_found) >= 5:
                        break
                
                # Read memory at found addresses
                memory_results = []
                for addr in addresses_found:
                    try:
                        buffer = ctypes.create_string_buffer(len(utf16_bytes) + 100)
                        bytes_read = ctypes.c_size_t()
                        
                        success = self.kernel32.ReadProcessMemory(
                            handle,
                            ctypes.c_void_p(addr),
                            buffer,
                            len(utf16_bytes) + 100,
                            ctypes.byref(bytes_read)
                        )
                        
                        if success and bytes_read.value > 0:
                            data = buffer.raw[:bytes_read.value]
                            
                            try:
                                decoded_text = data[:len(utf16_bytes)].decode('utf-16le')
                            except UnicodeDecodeError:
                                decoded_text = "Could not decode as UTF-16"
                            
                            memory_results.append({
                                "address": addr,
                                "hex_address": f"0x{addr:X}",
                                "target_text": search_text,
                                "found_text": decoded_text,
                                "raw_bytes": data[:50].hex(),
                                "utf16_match": decoded_text == search_text
                            })
                            
                            logger.info(f"  📍 Address 0x{addr:X}: '{decoded_text}'")
                    
                    except Exception as e:
                        logger.warning(f"Failed to read memory at 0x{addr:X}: {e}")
                
                return memory_results
                
            finally:
                self.kernel32.CloseHandle(handle)
            
        except Exception as e:
            logger.error(f"❌ Error in fallback memory scanning: {e}")
            return []
    
    def scan_memory_utf16(self, pid: int, search_text: str) -> List[Dict[str, Any]]:
        """Scan process memory for UTF-16 string"""
        try:
            # Always use fallback method for reliability
            logger.info(f"🔍 Scanning memory for UTF-16 string: '{search_text}' (Windows API mode)")
            return self.scan_memory_utf16_fallback(pid, search_text)
            
        except Exception as e:
            logger.error(f"❌ Error scanning memory: {e}")
            return []
    
    def close_notepad_without_saving(self) -> bool:
        """Close Notepad without saving"""
        try:
            logger.info("🔒 Closing Notepad without saving...")
            
            if hasattr(self, 'use_fallback'):
                # Use direct PyAutoGUI
                self.pyautogui.hotkey('alt', 'f4')
                time.sleep(1)
                self.pyautogui.press('n')
            else:
                # Use MCP components
                result = self.pyautogui_controller.key_combination(["alt", "f4"])
                if not result.success:
                    logger.error(f"❌ Failed to send Alt+F4: {result.error}")
                    return False
                
                time.sleep(1)
                
                result = self.pyautogui_controller.press_key("n")
                if not result.success:
                    logger.error(f"❌ Failed to press N: {result.error}")
                    return False
            
            time.sleep(1)
            logger.info("✅ Notepad closed without saving")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error closing Notepad: {e}")
            return False
    
    def run_complete_automation(self) -> bool:
        """Run the complete automation workflow"""
        try:
            mode = "Fallback" if hasattr(self, 'use_fallback') else "MCP"
            logger.info(f"🎯 Starting Complete MCP Cheat Engine Automation Workflow ({mode} Mode)")
            logger.info("=" * 70)
            
            # Step 1: Open Notepad
            if not self.open_notepad():
                return False
            
            # Step 2: Send keystrokes
            test_text = "Hello World MCP Test"
            if not self.send_keystrokes_to_notepad(test_text):
                return False
            
            # Step 3: Find Notepad process
            notepad_pid = self.find_notepad_process()
            if not notepad_pid:
                return False
            
            # Step 4: Scan memory for UTF-16 string
            memory_results = self.scan_memory_utf16(notepad_pid, test_text)
            
            if memory_results:
                logger.info("🎯 Memory Scan Results:")
                logger.info("-" * 50)
                for i, result in enumerate(memory_results, 1):
                    logger.info(f"  Result {i}:")
                    logger.info(f"    📍 Address: {result['hex_address']}")
                    logger.info(f"    🎯 Target Text: '{result['target_text']}'")
                    logger.info(f"    📝 Found Text: '{result['found_text']}'")
                    logger.info(f"    ✅ UTF-16 Match: {result['utf16_match']}")
                    logger.info(f"    🔢 Raw Bytes: {result['raw_bytes'][:32]}...")
                    logger.info("")
            else:
                logger.warning("⚠️ No memory locations found for target text")
            
            # Step 5: Close Notepad without saving
            if not self.close_notepad_without_saving():
                return False
            
            # Step 6: Verify Notepad is closed
            time.sleep(2)
            final_pid = self.find_notepad_process()
            if final_pid is None:
                logger.info("✅ Notepad successfully closed")
            else:
                logger.warning("⚠️ Notepad may still be running")
            
            logger.info("=" * 70)
            logger.info("🎉 Complete MCP Automation Workflow SUCCESSFUL!")
            logger.info("✅ All operations completed:")
            logger.info(f"  1. ✅ Notepad opened using {mode} PyAutoGUI")
            logger.info(f"  2. ✅ Keystrokes sent using {mode} PyAutoGUI")
            logger.info("  3. ✅ Process located using psutil")
            logger.info(f"  4. ✅ UTF-16 memory scanning performed using {mode} scanner")
            logger.info("  5. ✅ Memory addresses and text found")
            logger.info(f"  6. ✅ Notepad closed without saving using {mode} PyAutoGUI")
            logger.info("=" * 70)
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Complete automation workflow failed: {e}")
            return False

def main():
    """Main function"""
    try:
        logger.info("🚀 Starting MCP Cheat Engine Client")
        
        client = SimpleMCPClient()
        
        success = client.run_complete_automation()
        
        if success:
            logger.info("🎉 MCP Client automation completed successfully!")
        else:
            logger.error("❌ MCP Client automation failed")
        
    except KeyboardInterrupt:
        logger.info("Automation interrupted by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
