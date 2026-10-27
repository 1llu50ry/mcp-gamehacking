#!/usr/bin/env python3
"""
Simplified MCP Cheat Engine Client
Uses basic memory scanning approach for reliable UTF-16 string detection
"""

import logging
import time
import asyncio
import sys
import os
import ctypes
import ctypes.wintypes
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SimplifiedMCPClient:
    """Simplified MCP client for Cheat Engine Server interaction"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            # Import MCP components
            from gui_automation.core.integration import PyAutoGUIController
            self.pyautogui_controller = PyAutoGUIController()
            logger.info("✅ MCP PyAutoGUI controller initialized")
            
            # Import Cheat Engine components
            from cheatengine.ce_bridge import CheatEngineBridge
            self.ce_bridge = CheatEngineBridge()
            logger.info("✅ Cheat Engine bridge initialized")
            
            # Import process management
            from process.manager import ProcessManager
            self.process_manager = ProcessManager()
            logger.info("✅ Process manager initialized")
            
            # Windows API setup
            self.kernel32 = ctypes.windll.kernel32
            self._setup_windows_api()
            
            # Process handle
            self.process_handle = None
            self.current_pid = None
            
        except ImportError as e:
            logger.error(f"❌ Failed to import MCP components: {e}")
            raise
    
    def _setup_windows_api(self):
        """Setup Windows API for direct memory operations"""
        # ReadProcessMemory
        self.kernel32.ReadProcessMemory.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.wintypes.LPCVOID,
            ctypes.wintypes.LPVOID,
            ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_size_t)
        ]
        self.kernel32.ReadProcessMemory.restype = ctypes.wintypes.BOOL
        
        # VirtualQueryEx
        self.kernel32.VirtualQueryEx.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.wintypes.LPCVOID,
            ctypes.wintypes.LPVOID,
            ctypes.c_size_t
        ]
        self.kernel32.VirtualQueryEx.restype = ctypes.c_size_t
    
    async def run_complete_workflow(self):
        """Run the complete workflow as requested"""
        try:
            logger.info("🚀 Starting Simplified MCP Cheat Engine Workflow")
            logger.info("=" * 70)
            
            # Step 1: Open Notepad using MCP GUI automation
            logger.info("📝 Step 1: Opening Notepad...")
            if not await self.open_notepad():
                return False
            
            # Step 2: Send keystrokes using MCP
            logger.info("⌨️ Step 2: Sending keystrokes...")
            test_text = "Hello MCP Cheat Engine! This text will be found in memory."
            if not await self.send_keystrokes(test_text):
                return False
            
            # Step 3: Attach Cheat Engine to Notepad
            logger.info("🔗 Step 3: Attaching Cheat Engine to Notepad...")
            notepad_pid = await self.find_notepad_process()
            if not notepad_pid:
                logger.error("❌ Could not find Notepad process")
                return False
            
            if not await self.attach_cheat_engine(notepad_pid):
                return False
            
            # Step 4: Find text in memory using UTF-16 scan
            logger.info("🔍 Step 4: Scanning memory for UTF-16 string...")
            addresses = await self.scan_memory_utf16_simple(test_text)
            
            # Step 5: Clear text and close Notepad
            logger.info("🧹 Step 5: Clearing text and closing Notepad...")
            await self.clear_and_close_notepad()
            
            logger.info("=" * 70)
            logger.info("🎉 Simplified MCP Cheat Engine Workflow SUCCESSFUL!")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Workflow failed: {e}")
            return False
    
    async def open_notepad(self):
        """Open Notepad using MCP GUI automation"""
        try:
            # Use Windows key + R to open Run dialog
            self.pyautogui_controller.key_combination(["win", "r"])
            await asyncio.sleep(1)
            
            # Type notepad
            self.pyautogui_controller.type_text("notepad", interval=0.1)
            await asyncio.sleep(0.5)
            
            # Press Enter
            self.pyautogui_controller.press_key("enter")
            await asyncio.sleep(3)  # Wait for Notepad to open
            
            # Verify Notepad opened
            notepad_pid = await self.find_notepad_process()
            if notepad_pid:
                logger.info(f"✅ Notepad opened successfully (PID: {notepad_pid})")
                return True
            else:
                logger.error("❌ Failed to open Notepad")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error opening Notepad: {e}")
            return False
    
    async def send_keystrokes(self, text: str):
        """Send keystrokes to the active window using MCP"""
        try:
            # Type the text
            self.pyautogui_controller.type_text(text, interval=0.05)
            await asyncio.sleep(1)
            
            # Add a newline
            self.pyautogui_controller.press_key("enter")
            await asyncio.sleep(0.5)
            
            logger.info(f"✅ Successfully sent keystrokes: '{text[:50]}...'")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending keystrokes: {e}")
            return False
    
    async def find_notepad_process(self):
        """Find Notepad process PID"""
        try:
            processes = self.process_manager.list_processes()
            for proc in processes:
                if proc['name'].lower() == 'notepad.exe':
                    return proc['pid']
            return None
            
        except Exception as e:
            logger.error(f"❌ Error finding Notepad process: {e}")
            return None
    
    async def attach_cheat_engine(self, pid: int):
        """Attach Cheat Engine to the target process"""
        try:
            # Attach to process using MCP server (convert PID to string)
            result = self.process_manager.attach_process(str(pid), "read")
            if result:
                logger.info(f"✅ MCP server attached to process {pid}")
            
            # Open process handle for Cheat Engine operations
            self.process_handle = self.ce_bridge.open_process_handle(pid)
            if self.process_handle:
                self.current_pid = pid
                logger.info(f"✅ Cheat Engine attached to process {pid} (Handle: {self.process_handle})")
                return True
            else:
                logger.error(f"❌ Failed to attach Cheat Engine to process {pid}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error attaching Cheat Engine: {e}")
            return False
    
    async def scan_memory_utf16_simple(self, search_text: str):
        """Simple memory scan for UTF-16 string using direct Windows API"""
        try:
            logger.info(f"🔍 Scanning for UTF-16 string: '{search_text}'")
            
            if not self.process_handle:
                logger.error("❌ No process handle available")
                return []
            
            # Convert search text to UTF-16 LE bytes
            utf16_pattern = search_text.encode('utf-16le')
            logger.info(f"🔍 UTF-16 LE pattern ({len(utf16_pattern)} bytes): {utf16_pattern.hex()}")
            
            found_addresses = []
            
            # Define common memory regions to scan for Notepad
            regions_to_scan = [
                (0x00400000, 0x01000000),  # Main executable area
                (0x10000000, 0x20000000),  # Heap area 1
                (0x20000000, 0x30000000),  # Heap area 2
                (0x70000000, 0x78000000),  # High memory area
            ]
            
            for i, (start_addr, end_addr) in enumerate(regions_to_scan):
                logger.info(f"  🔍 Scanning region {i+1}/{len(regions_to_scan)}: "
                          f"0x{start_addr:08X} - 0x{end_addr:08X}")
                
                found_in_region = await self._scan_memory_region(
                    start_addr, end_addr, utf16_pattern, search_text
                )
                found_addresses.extend(found_in_region)
                
                # Stop after finding reasonable number of matches
                if len(found_addresses) >= 10:
                    break
            
            if found_addresses:
                logger.info(f"🎯 Total found: {len(found_addresses)} memory locations with UTF-16 text")
                for i, addr_info in enumerate(found_addresses[:5], 1):
                    logger.info(f"  {i}. Address: {addr_info['address']} | Text: '{addr_info['value']}'")
                return found_addresses
            else:
                logger.warning("⚠️ No memory locations found")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error scanning memory: {e}")
            return []
    
    async def _scan_memory_region(self, start_addr: int, end_addr: int, pattern: bytes, search_text: str):
        """Scan a specific memory region for the pattern"""
        found_addresses = []
        chunk_size = 4096  # 4KB chunks
        
        try:
            current_addr = start_addr
            while current_addr < end_addr:
                try:
                    # Read memory chunk
                    buffer = ctypes.create_string_buffer(chunk_size)
                    bytes_read = ctypes.c_size_t()
                    
                    success = self.kernel32.ReadProcessMemory(
                        self.process_handle,
                        ctypes.c_void_p(current_addr),
                        buffer,
                        chunk_size,
                        ctypes.byref(bytes_read)
                    )
                    
                    if success and bytes_read.value > 0:
                        data = buffer.raw[:bytes_read.value]
                        
                        # Search for pattern in this chunk
                        offset = 0
                        while True:
                            pos = data.find(pattern, offset)
                            if pos == -1:
                                break
                            
                            found_addr = current_addr + pos
                            
                            # Try to read a larger context around the match
                            try:
                                context_size = min(len(pattern) * 2, 128)
                                context_buffer = ctypes.create_string_buffer(context_size)
                                context_bytes_read = ctypes.c_size_t()
                                
                                context_success = self.kernel32.ReadProcessMemory(
                                    self.process_handle,
                                    ctypes.c_void_p(found_addr),
                                    context_buffer,
                                    context_size,
                                    ctypes.byref(context_bytes_read)
                                )
                                
                                if context_success and context_bytes_read.value > 0:
                                    context_data = context_buffer.raw[:context_bytes_read.value]
                                    
                                    # Try to decode as UTF-16
                                    try:
                                        # Find null terminator for strings
                                        null_pos = context_data.find(b'\\x00\\x00')
                                        if null_pos > 0 and null_pos % 2 == 0:
                                            string_data = context_data[:null_pos]
                                        else:
                                            string_data = context_data[:len(pattern)]
                                        
                                        decoded_text = string_data.decode('utf-16le', errors='ignore')
                                        
                                        found_addresses.append({
                                            'address': f"0x{found_addr:08X}",
                                            'value': decoded_text,
                                            'raw_bytes': string_data.hex()
                                        })
                                        
                                        logger.info(f"      📍 Found at 0x{found_addr:08X}: '{decoded_text[:50]}...'")
                                        
                                    except Exception:
                                        # Skip decode errors
                                        pass
                            except Exception:
                                # Skip read errors
                                pass
                            
                            offset = pos + 1
                            if len(found_addresses) >= 10:  # Limit results
                                break
                    
                    current_addr += chunk_size
                    
                    if len(found_addresses) >= 10:  # Limit results
                        break
                        
                except Exception:
                    # Skip failed reads and continue
                    current_addr += chunk_size
                    continue
                    
        except Exception as e:
            logger.warning(f"    ⚠️ Error scanning region: {e}")
        
        return found_addresses
    
    async def clear_and_close_notepad(self):
        """Clear text and close Notepad without saving"""
        try:
            # Select all text
            self.pyautogui_controller.key_combination(["ctrl", "a"])
            await asyncio.sleep(0.5)
            
            # Delete selected text
            self.pyautogui_controller.press_key("delete")
            await asyncio.sleep(1)
            
            logger.info("✅ Text cleared from Notepad")
            
            # Close Notepad with Alt+F4
            self.pyautogui_controller.key_combination(["alt", "f4"])
            await asyncio.sleep(1)
            
            # Don't save - press 'n' for No
            self.pyautogui_controller.press_key("n")
            await asyncio.sleep(2)
            
            # Verify Notepad is closed
            notepad_pid = await self.find_notepad_process()
            if not notepad_pid:
                logger.info("✅ Notepad closed successfully")
            else:
                logger.warning("⚠️ Notepad may still be running")
            
            # Clean up handles
            if self.process_handle:
                self.ce_bridge.close_process_handle(self.process_handle)
                self.process_handle = None
                self.current_pid = None
                logger.info("✅ Closed process handle")
                
            # Detach from process
            try:
                self.process_manager.detach_process()
                logger.info("✅ Detached from process")
            except:
                pass  # May already be detached
                
        except Exception as e:
            logger.error(f"❌ Error closing Notepad: {e}")

async def main():
    """Main function"""
    try:
        logger.info("🤖 Simplified MCP Cheat Engine Client Starting")
        logger.info("=" * 50)
        
        # Initialize client
        client = SimplifiedMCPClient()
        
        # Run complete workflow
        success = await client.run_complete_workflow()
        
        if success:
            logger.info("🎉 All operations completed successfully!")
        else:
            logger.error("❌ Some operations failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Client interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
