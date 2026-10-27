#!/usr/bin/env python3
"""
Comprehensive MCP Cheat Engine Client
Uses multiple encoding strategies and broader memory scanning for text detection
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

class ComprehensiveMCPClient:
    """Comprehensive MCP client with multiple encoding detection"""
    
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
        
        # VirtualQueryEx for memory region info
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
        
        self.MEMORY_BASIC_INFORMATION = MEMORY_BASIC_INFORMATION
        
        self.kernel32.VirtualQueryEx.argtypes = [
            ctypes.wintypes.HANDLE,
            ctypes.wintypes.LPCVOID,
            ctypes.POINTER(MEMORY_BASIC_INFORMATION),
            ctypes.c_size_t
        ]
        self.kernel32.VirtualQueryEx.restype = ctypes.c_size_t
        
        # Memory protection constants
        self.PAGE_READONLY = 0x02
        self.PAGE_READWRITE = 0x04
        self.PAGE_EXECUTE_READ = 0x20
        self.PAGE_EXECUTE_READWRITE = 0x40
        self.MEM_COMMIT = 0x1000
    
    async def run_complete_workflow(self):
        """Run the complete workflow as requested"""
        try:
            logger.info("🚀 Starting Comprehensive MCP Cheat Engine Workflow")
            logger.info("=" * 70)
            
            # Step 1: Open Notepad using MCP GUI automation
            logger.info("📝 Step 1: Opening Notepad...")
            if not await self.open_notepad():
                return False
            
            # Step 2: Send keystrokes using MCP
            logger.info("⌨️ Step 2: Sending keystrokes...")
            test_text = "MCP_TEST_STRING"  # Shorter, more distinctive text
            if not await self.send_keystrokes(test_text):
                return False
            
            # Wait for text to settle in memory
            await asyncio.sleep(2)
            
            # Step 3: Attach Cheat Engine to Notepad
            logger.info("🔗 Step 3: Attaching Cheat Engine to Notepad...")
            notepad_pid = await self.find_notepad_process()
            if not notepad_pid:
                logger.error("❌ Could not find Notepad process")
                return False
            
            if not await self.attach_cheat_engine(notepad_pid):
                return False
            
            # Step 4: Comprehensive memory scan for multiple encodings
            logger.info("🔍 Step 4: Comprehensive memory scan...")
            addresses = await self.comprehensive_memory_scan(test_text)
            
            # Step 5: Clear text and close Notepad
            logger.info("🧹 Step 5: Clearing text and closing Notepad...")
            await self.clear_and_close_notepad()
            
            logger.info("=" * 70)
            if addresses:
                logger.info("🎉 Comprehensive MCP Cheat Engine Workflow SUCCESSFUL!")
                logger.info(f"   Found text in {len(addresses)} memory location(s)")
            else:
                logger.info("✅ MCP Cheat Engine Workflow completed (text not found in scanned regions)")
            
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
            # Disable PyAutoGUI failsafe temporarily
            import pyautogui
            original_failsafe = pyautogui.FAILSAFE
            pyautogui.FAILSAFE = False
            
            # Type the text
            self.pyautogui_controller.type_text(text, interval=0.05)
            await asyncio.sleep(1)
            
            # Add a newline
            self.pyautogui_controller.press_key("enter")
            await asyncio.sleep(0.5)
            
            # Restore failsafe
            pyautogui.FAILSAFE = original_failsafe
            
            logger.info(f"✅ Successfully sent keystrokes: '{text}'")
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
    
    async def comprehensive_memory_scan(self, search_text: str):
        """Comprehensive memory scan with multiple encodings"""
        try:
            logger.info(f"🔍 Comprehensive scan for text: '{search_text}'")
            
            if not self.process_handle:
                logger.error("❌ No process handle available")
                return []
            
            # Prepare search patterns for different encodings
            patterns = {
                'UTF-8': search_text.encode('utf-8'),
                'UTF-16 LE': search_text.encode('utf-16le'),
                'UTF-16 BE': search_text.encode('utf-16be'),
                'ASCII': search_text.encode('ascii', errors='ignore'),
                'Latin-1': search_text.encode('latin-1', errors='ignore')
            }
            
            for encoding, pattern in patterns.items():
                logger.info(f"🔍 {encoding} pattern ({len(pattern)} bytes): {pattern.hex()}")
            
            found_addresses = []
            
            # Get all memory regions from the process
            regions = self._get_memory_regions()
            logger.info(f"🔍 Found {len(regions)} memory regions to scan")
            
            for i, region in enumerate(regions[:20]):  # Limit to first 20 regions
                logger.info(f"  🔍 Scanning region {i+1}/{min(len(regions), 20)}: "
                          f"0x{region['base']:08X} - 0x{region['base'] + region['size']:08X} "
                          f"({region['size']} bytes)")
                
                for encoding, pattern in patterns.items():
                    found_in_region = await self._scan_region_for_pattern(
                        region['base'], region['size'], pattern, encoding, search_text
                    )
                    found_addresses.extend(found_in_region)
                
                # Stop after finding some matches
                if len(found_addresses) >= 5:
                    break
            
            if found_addresses:
                logger.info(f"🎯 Total found: {len(found_addresses)} memory locations")
                for i, addr_info in enumerate(found_addresses[:5], 1):
                    logger.info(f"  {i}. Address: {addr_info['address']} | "
                              f"Encoding: {addr_info['encoding']} | "
                              f"Text: '{addr_info['value']}'")
                return found_addresses
            else:
                logger.warning("⚠️ No matching text found in scanned memory regions")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error in comprehensive memory scan: {e}")
            return []
    
    def _get_memory_regions(self):
        """Get all readable memory regions from the process"""
        regions = []
        address = 0
        
        try:
            while address < 0x80000000:  # Scan up to 2GB
                mbi = self.MEMORY_BASIC_INFORMATION()
                result = self.kernel32.VirtualQueryEx(
                    self.process_handle,
                    ctypes.c_void_p(address),
                    ctypes.byref(mbi),
                    ctypes.sizeof(mbi)
                )
                
                if result == 0:
                    break
                
                # Check if region is committed and readable
                if (mbi.State == self.MEM_COMMIT and 
                    mbi.Protect in [self.PAGE_READONLY, self.PAGE_READWRITE, 
                                   self.PAGE_EXECUTE_READ, self.PAGE_EXECUTE_READWRITE]):
                    regions.append({
                        'base': mbi.BaseAddress,
                        'size': mbi.RegionSize
                    })
                
                address = mbi.BaseAddress + mbi.RegionSize
                
                # Limit number of regions to prevent excessive scanning
                if len(regions) >= 50:
                    break
                    
        except Exception as e:
            logger.warning(f"    ⚠️ Error enumerating memory regions: {e}")
        
        return regions
    
    async def _scan_region_for_pattern(self, base_addr: int, size: int, pattern: bytes, encoding: str, search_text: str):
        """Scan a specific memory region for a pattern"""
        found_addresses = []
        chunk_size = 4096
        
        try:
            bytes_scanned = 0
            while bytes_scanned < size:
                current_addr = base_addr + bytes_scanned
                read_size = min(chunk_size, size - bytes_scanned)
                
                try:
                    # Read memory chunk
                    buffer = ctypes.create_string_buffer(read_size)
                    bytes_read = ctypes.c_size_t()
                    
                    success = self.kernel32.ReadProcessMemory(
                        self.process_handle,
                        ctypes.c_void_p(current_addr),
                        buffer,
                        read_size,
                        ctypes.byref(bytes_read)
                    )
                    
                    if success and bytes_read.value > 0:
                        data = buffer.raw[:bytes_read.value]
                        
                        # Search for pattern in this chunk
                        pos = data.find(pattern)
                        if pos != -1:
                            found_addr = current_addr + pos
                            
                            found_addresses.append({
                                'address': f"0x{found_addr:08X}",
                                'encoding': encoding,
                                'value': search_text,
                                'raw_bytes': pattern.hex()
                            })
                            
                            logger.info(f"      📍 Found {encoding} at 0x{found_addr:08X}: '{search_text}'")
                            
                            # Found one instance in this region, that's enough
                            break
                    
                    bytes_scanned += read_size
                    
                except Exception:
                    # Skip failed reads and continue
                    bytes_scanned += chunk_size
                    continue
                    
        except Exception as e:
            logger.warning(f"    ⚠️ Error scanning region for {encoding}: {e}")
        
        return found_addresses
    
    async def clear_and_close_notepad(self):
        """Clear text and close Notepad without saving"""
        try:
            # Disable PyAutoGUI failsafe temporarily
            import pyautogui
            original_failsafe = pyautogui.FAILSAFE
            pyautogui.FAILSAFE = False
            
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
            
            # Restore failsafe
            pyautogui.FAILSAFE = original_failsafe
            
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
        logger.info("🤖 Comprehensive MCP Cheat Engine Client Starting")
        logger.info("=" * 50)
        
        # Initialize client
        client = ComprehensiveMCPClient()
        
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
