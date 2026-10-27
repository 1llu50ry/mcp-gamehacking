#!/usr/bin/env python3
"""
Complete MCP Cheat Engine Client
Demonstrates full workflow: Notepad automation + Cheat Engine memory scanning
"""

import logging
import time
import asyncio
import sys
import os
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CompleteMCPClient:
    """Complete MCP client for Cheat Engine Server interaction"""
    
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
            
            # Process handle
            self.process_handle = None
            self.current_pid = None
            
        except ImportError as e:
            logger.error(f"❌ Failed to import MCP components: {e}")
            raise
    
    async def run_complete_workflow(self):
        """Run the complete workflow as requested"""
        try:
            logger.info("🚀 Starting Complete MCP Cheat Engine Workflow")
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
            addresses = await self.scan_memory_utf16(test_text)
            
            # Step 5: Clear text and close Notepad
            logger.info("🧹 Step 5: Clearing text and closing Notepad...")
            await self.clear_and_close_notepad()
            
            logger.info("=" * 70)
            logger.info("🎉 Complete MCP Cheat Engine Workflow SUCCESSFUL!")
            
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
    
    async def scan_memory_utf16(self, search_text: str):
        """Scan memory for UTF-16 string using Cheat Engine bridge"""
        try:
            logger.info(f"🔍 Scanning for UTF-16 string: '{search_text}'")
            
            if not self.process_handle:
                logger.error("❌ No process handle available")
                return []
            
            # Convert search text to UTF-16 LE bytes
            utf16_pattern = search_text.encode('utf-16le')
            logger.info(f"🔍 UTF-16 LE pattern: {utf16_pattern.hex()}")
            
            # Get memory map to scan readable regions
            memory_map = self.ce_bridge.get_detailed_memory_map(self.process_handle)
            readable_regions = [region for region in memory_map if region.get('readable', False)]
            
            logger.info(f"📖 Found {len(readable_regions)} readable memory regions to scan")
            
            found_addresses = []
            
            # Scan each readable region
            for i, region in enumerate(readable_regions[:20]):  # Limit to first 20 regions
                try:
                    base_addr = region['base_address']
                    size = region['size']
                    
                    logger.info(f"  🔍 Scanning region {i+1}/{min(len(readable_regions), 20)}: "
                              f"0x{base_addr:08X} - 0x{base_addr + size:08X} ({size} bytes)")
                    
                    # Find pattern in this region
                    matches = self.ce_bridge.find_pattern_in_memory(
                        self.process_handle, 
                        utf16_pattern, 
                        base_addr, 
                        base_addr + size
                    )
                    
                    if matches:
                        logger.info(f"    ✅ Found {len(matches)} matches in this region")
                        for match_addr in matches:
                            # Read the actual value to verify
                            try:
                                # Read enough bytes for the string plus a bit extra
                                read_size = len(utf16_pattern) + 32
                                data = self.ce_bridge.read_process_memory(self.process_handle, match_addr, read_size)
                                if data:
                                    # Try to decode as UTF-16
                                    try:
                                        # Find null terminator
                                        null_pos = data.find(b'\x00\x00')
                                        if null_pos > 0 and null_pos % 2 == 0:
                                            string_data = data[:null_pos]
                                        else:
                                            string_data = data[:len(utf16_pattern)]
                                        
                                        decoded_text = string_data.decode('utf-16le', errors='ignore')
                                        
                                        found_addresses.append({
                                            'address': f"0x{match_addr:08X}",
                                            'value': decoded_text,
                                            'raw_bytes': string_data.hex()
                                        })
                                        
                                        logger.info(f"      � Address: 0x{match_addr:08X} | Text: '{decoded_text}'")
                                        
                                    except UnicodeDecodeError:
                                        logger.warning(f"      ⚠️ Could not decode UTF-16 at 0x{match_addr:08X}")
                            except Exception as e:
                                logger.warning(f"      ⚠️ Could not read memory at 0x{match_addr:08X}: {e}")
                
                except Exception as e:
                    logger.warning(f"    ⚠️ Error scanning region {i+1}: {e}")
                    continue
            
            if found_addresses:
                logger.info(f"🎯 Total found: {len(found_addresses)} memory locations with UTF-16 text")
                return found_addresses
            else:
                logger.warning("⚠️ No memory locations found")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error scanning memory: {e}")
            return []
    
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
        logger.info("🤖 Complete MCP Cheat Engine Client Starting")
        logger.info("=" * 50)
        
        # Initialize client
        client = CompleteMCPClient()
        
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
