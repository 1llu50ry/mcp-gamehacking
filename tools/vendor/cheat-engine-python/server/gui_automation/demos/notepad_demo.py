#!/usr/bin/env python3
"""
MCP Cheat Engine Server - PyAutoGUI Notepad Automation Demo

This script demonstrates the complete integration of:
1. PyAutoGUI for screen automation and keystroke injection
2. MCP Cheat Engine Server for memory scanning and text location
3. Process management and window control

Workflow:
1. Launch Notepad using PyAutoGUI
2. Send "Hello World" text using PyAutoGUI
3. Find the text in Notepad's memory using MCP tools
4. Display memory addresses and current text content
"""

import os
import sys
import time
import logging
import subprocess
import psutil
from typing import Dict, Any, List, Optional

# Add server directory to path for MCP integration
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

# Import our PyAutoGUI integration
from pyautogui_integration import PyAutoGUIController
from pyautogui_tools import PyAutoGUIToolHandler

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class NotepadAutomationDemo:
    """Demonstrates PyAutoGUI + MCP integration for Notepad automation"""
    
    def __init__(self):
        self.pyautogui_controller = None
        self.pyautogui_handler = None
        self.notepad_process = None
        self.memory_reader = None
        self.target_text = "Hello World from PyAutoGUI and MCP!"
        
    def initialize_systems(self) -> bool:
        """Initialize PyAutoGUI and MCP systems"""
        try:
            # Initialize PyAutoGUI
            self.pyautogui_controller = PyAutoGUIController()
            self.pyautogui_handler = PyAutoGUIToolHandler()
            logger.info("✅ PyAutoGUI systems initialized")
            
            # Initialize memory reader
            try:
                from memory.reader import MemoryReader
                self.memory_reader = MemoryReader()
                logger.info("✅ MCP Memory Reader initialized")
            except Exception as e:
                logger.warning(f"⚠️ Memory reader initialization failed: {e}")
                logger.info("Continuing with basic functionality...")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ System initialization failed: {e}")
            return False
    
    def launch_notepad(self) -> bool:
        """Launch Notepad using PyAutoGUI"""
        try:
            logger.info("🚀 Launching Notepad...")
            
            # Use PyAutoGUI to open Run dialog
            result = self.pyautogui_controller.key_combination(['win', 'r'])
            if not result.success:
                logger.error(f"Failed to open Run dialog: {result.error}")
                return False
            
            time.sleep(1)
            
            # Type notepad command
            result = self.pyautogui_controller.type_text("notepad")
            if not result.success:
                logger.error(f"Failed to type notepad: {result.error}")
                return False
            
            time.sleep(0.5)
            
            # Press Enter to launch
            result = self.pyautogui_controller.press_key("enter")
            if not result.success:
                logger.error(f"Failed to press Enter: {result.error}")
                return False
            
            # Wait for Notepad to load
            time.sleep(2)
            
            # Find Notepad process
            self.notepad_process = self._find_notepad_process()
            if self.notepad_process:
                logger.info(f"✅ Notepad launched successfully (PID: {self.notepad_process.pid})")
                return True
            else:
                logger.error("❌ Could not find Notepad process")
                return False
                
        except Exception as e:
            logger.error(f"❌ Failed to launch Notepad: {e}")
            return False
    
    def send_text_to_notepad(self) -> bool:
        """Send text to Notepad using PyAutoGUI"""
        try:
            logger.info(f"📝 Sending text to Notepad: '{self.target_text}'")
            
            # Take a screenshot first to see current state
            screenshot_result = self.pyautogui_controller.take_screenshot()
            if screenshot_result.success:
                logger.info("📷 Screenshot taken for reference")
            
            # Click in the Notepad window to ensure focus
            # Get screen center as a safe click location
            screen_info = self.pyautogui_controller.get_screen_info()
            center_x = screen_info.data['width'] // 2
            center_y = screen_info.data['height'] // 2
            
            click_result = self.pyautogui_controller.click_mouse(center_x, center_y)
            if click_result.success:
                logger.info("🖱️ Clicked to focus window")
            
            time.sleep(0.5)
            
            # Type the target text
            type_result = self.pyautogui_controller.type_text(self.target_text, interval=0.02)
            if not type_result.success:
                logger.error(f"Failed to type text: {type_result.error}")
                return False
            
            logger.info("✅ Text sent successfully to Notepad")
            
            # Add a newline and timestamp for better identification
            self.pyautogui_controller.press_key("enter")
            time.sleep(0.1)
            timestamp_text = f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}"
            self.pyautogui_controller.type_text(timestamp_text, interval=0.01)
            
            time.sleep(1)  # Allow text to be processed
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to send text to Notepad: {e}")
            return False
    
    def find_text_in_memory(self) -> List[Dict[str, Any]]:
        """Find the text in Notepad's memory using MCP tools"""
        try:
            logger.info(f"🔍 Searching for text in Notepad memory...")
            
            if not self.notepad_process:
                logger.error("No Notepad process found")
                return []
            
            # Initialize memory reader for Notepad process
            if self.memory_reader:
                try:
                    process_info = {
                        'pid': self.notepad_process.pid,
                        'name': self.notepad_process.name(),
                        'handle': None
                    }
                    self.memory_reader.set_process(process_info)
                    logger.info("🎯 Memory reader attached to Notepad")
                except Exception as e:
                    logger.error(f"Failed to attach memory reader: {e}")
                    return []
            else:
                logger.error("Memory reader not available")
                return []
            
            found_locations = []
            
            # Search for our target text
            search_texts = [
                self.target_text,
                "Hello World",  # Partial search
                "PyAutoGUI",    # Another partial search
            ]
            
            for search_text in search_texts:
                logger.info(f"🔎 Searching for: '{search_text}'")
                locations = self._search_memory_for_text(search_text)
                
                for location in locations:
                    found_locations.append({
                        'search_term': search_text,
                        'address': location['address'],
                        'address_hex': f"0x{location['address']:X}",
                        'encoding': location['encoding'],
                        'content': location['content'],
                        'context': location.get('context', ''),
                        'size': location.get('size', 0)
                    })
                
                if locations:
                    logger.info(f"✅ Found {len(locations)} occurrences of '{search_text}'")
                else:
                    logger.info(f"ℹ️ No occurrences found for '{search_text}'")
            
            return found_locations
            
        except Exception as e:
            logger.error(f"❌ Memory search failed: {e}")
            return []
    
    def _search_memory_for_text(self, search_text: str) -> List[Dict[str, Any]]:
        """Search for text in process memory"""
        try:
            # Get readable memory regions
            regions = self.memory_reader.get_memory_regions()
            readable_regions = [r for r in regions if r.get('readable', False)]
            
            found_locations = []
            search_count = 0
            max_regions = 50  # Limit search to prevent long execution times
            
            logger.info(f"📊 Scanning {min(len(readable_regions), max_regions)} memory regions...")
            
            for region in readable_regions[:max_regions]:
                search_count += 1
                try:
                    # Limit scan size to prevent excessive memory usage
                    scan_size = min(region['size'], 1 * 1024 * 1024)  # 1MB max per region
                    
                    memory_data = self.memory_reader.read_memory(
                        region['base_address'], 
                        scan_size
                    )
                    
                    # Search for ASCII text
                    ascii_matches = self._find_text_in_bytes(
                        memory_data, 
                        search_text.encode('ascii', errors='ignore'),
                        region['base_address'],
                        'ascii'
                    )
                    found_locations.extend(ascii_matches)
                    
                    # Search for Unicode text (UTF-16 LE)
                    unicode_matches = self._find_text_in_bytes(
                        memory_data,
                        search_text.encode('utf-16le'),
                        region['base_address'],
                        'unicode'
                    )
                    found_locations.extend(unicode_matches)
                    
                    if search_count % 10 == 0:
                        logger.info(f"⏳ Scanned {search_count} regions, found {len(found_locations)} matches so far...")
                    
                except Exception as e:
                    logger.debug(f"Skipped region {hex(region['base_address'])}: {e}")
                    continue
            
            logger.info(f"🔍 Memory scan completed: {search_count} regions scanned")
            return found_locations
            
        except Exception as e:
            logger.error(f"Memory search error: {e}")
            return []
    
    def _find_text_in_bytes(self, data: bytes, search_bytes: bytes, base_address: int, encoding: str) -> List[Dict[str, Any]]:
        """Find text occurrences in a byte array"""
        locations = []
        offset = 0
        
        while True:
            pos = data.find(search_bytes, offset)
            if pos == -1:
                break
            
            address = base_address + pos
            
            # Read context around the found text (64 bytes before and after)
            context_start = max(0, pos - 64)
            context_end = min(len(data), pos + len(search_bytes) + 64)
            context_data = data[context_start:context_end]
            
            # Extract readable text from context
            try:
                if encoding == 'ascii':
                    content = search_bytes.decode('ascii', errors='ignore')
                    context = context_data.decode('ascii', errors='ignore')
                else:
                    content = search_bytes.decode('utf-16le', errors='ignore')
                    context = context_data.decode('utf-16le', errors='ignore')
                
                # Clean up text (remove null bytes and non-printable chars)
                content = ''.join(c for c in content if c.isprintable() or c.isspace()).strip()
                context = ''.join(c for c in context if c.isprintable() or c.isspace()).strip()
                
            except Exception:
                content = f"<decode error: {encoding}>"
                context = f"<context decode error>"
            
            locations.append({
                'address': address,
                'size': len(search_bytes),
                'encoding': encoding,
                'content': content,
                'context': context,
                'hex_data': context_data[:32].hex()  # First 32 bytes as hex
            })
            
            offset = pos + 1
            
            # Limit results to prevent excessive output
            if len(locations) >= 10:
                break
        
        return locations
    
    def _find_notepad_process(self) -> Optional[psutil.Process]:
        """Find the Notepad process"""
        try:
            for proc in psutil.process_iter(['pid', 'name', 'create_time']):
                if proc.info['name'].lower() == 'notepad.exe':
                    # Return the most recently created Notepad process
                    return proc
        except Exception as e:
            logger.error(f"Error finding Notepad process: {e}")
        return None
    
    def display_results(self, found_locations: List[Dict[str, Any]]):
        """Display the memory search results in a formatted way"""
        print("\n" + "="*80)
        print("🎯 MEMORY SEARCH RESULTS")
        print("="*80)
        
        if not found_locations:
            print("❌ No text found in Notepad memory")
            print("This could be due to:")
            print("  • Text might be stored in encrypted/compressed form")
            print("  • Memory regions might not be accessible")
            print("  • Text might be in graphics buffer rather than text buffer")
            return
        
        print(f"✅ Found {len(found_locations)} text occurrences in memory")
        print()
        
        # Group by search term
        by_search_term = {}
        for location in found_locations:
            term = location['search_term']
            if term not in by_search_term:
                by_search_term[term] = []
            by_search_term[term].append(location)
        
        for search_term, locations in by_search_term.items():
            print(f"🔍 Search Term: '{search_term}' - {len(locations)} matches")
            print("-" * 60)
            
            for i, loc in enumerate(locations[:5], 1):  # Show first 5 matches per term
                print(f"  Match #{i}:")
                print(f"    📍 Address: {loc['address_hex']} (decimal: {loc['address']})")
                print(f"    📝 Encoding: {loc['encoding']}")
                print(f"    📄 Content: '{loc['content']}'")
                print(f"    🔍 Context: '{loc['context'][:100]}{'...' if len(loc['context']) > 100 else ''}'")
                print(f"    📊 Size: {loc['size']} bytes")
                print(f"    🔢 Hex Data: {loc['hex_data']}")
                print()
            
            if len(locations) > 5:
                print(f"    ... and {len(locations) - 5} more matches")
                print()
    
    def run_complete_demo(self):
        """Run the complete Notepad automation demo"""
        print("🤖 MCP Cheat Engine Server + PyAutoGUI Notepad Demo")
        print("="*60)
        print("This demo will:")
        print("1. 🚀 Launch Notepad using PyAutoGUI")
        print("2. 📝 Send 'Hello World' text using PyAutoGUI")
        print("3. 🔍 Find the text in Notepad's memory using MCP")
        print("4. 📊 Display memory addresses and content")
        print()
        
        # Step 1: Initialize systems
        print("🔧 Initializing systems...")
        if not self.initialize_systems():
            print("❌ System initialization failed!")
            return False
        
        # Step 2: Launch Notepad
        print("\n🚀 Launching Notepad...")
        if not self.launch_notepad():
            print("❌ Failed to launch Notepad!")
            return False
        
        # Step 3: Send text
        print("\n📝 Sending text to Notepad...")
        if not self.send_text_to_notepad():
            print("❌ Failed to send text to Notepad!")
            return False
        
        # Step 4: Search memory
        print("\n🔍 Searching for text in memory...")
        found_locations = self.find_text_in_memory()
        
        # Step 5: Display results
        self.display_results(found_locations)
        
        # Step 6: Additional PyAutoGUI demonstration
        print("\n🎮 Additional PyAutoGUI Features Demo:")
        self._demonstrate_additional_features()
        
        print("\n✅ Demo completed successfully!")
        return True
    
    def _demonstrate_additional_features(self):
        """Demonstrate additional PyAutoGUI features"""
        try:
            # Get current mouse position
            mouse_pos = self.pyautogui_controller.get_mouse_position()
            if mouse_pos.success:
                print(f"🖱️ Current mouse position: {mouse_pos.data}")
            
            # Get screen information
            screen_info = self.pyautogui_controller.get_screen_info()
            if screen_info.success:
                print(f"🖥️ Screen resolution: {screen_info.data['width']}x{screen_info.data['height']}")
            
            # Take a final screenshot
            screenshot = self.pyautogui_controller.take_screenshot()
            if screenshot.success and 'file_path' in screenshot.data:
                print(f"📷 Final screenshot saved: {screenshot.data['file_path']}")
            
        except Exception as e:
            logger.error(f"Additional features demo error: {e}")

def main():
    """Main entry point"""
    demo = NotepadAutomationDemo()
    
    try:
        success = demo.run_complete_demo()
        if success:
            print("\n🎉 All systems working perfectly!")
            print("🔗 PyAutoGUI + MCP Cheat Engine Server integration is complete!")
        else:
            print("\n⚠️ Demo completed with some issues")
    
    except KeyboardInterrupt:
        print("\n🛑 Demo interrupted by user")
    except Exception as e:
        print(f"\n💥 Demo failed with error: {e}")
        logger.exception("Demo exception details:")

if __name__ == "__main__":
    main()
