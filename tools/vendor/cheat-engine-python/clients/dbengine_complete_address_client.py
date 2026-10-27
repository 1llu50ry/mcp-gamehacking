#!/usr/bin/env python3
"""
DBEngine Complete Address List MCP Client
Tests launching and terminating DBEngine Application and loading the cheat table
Focuses on outputting the complete address list from Diablo II.CT

This client demonstrates:
- Launching DBEngine application
- Loading cheat table from file system
- Extracting and displaying ALL memory addresses
- Testing memory read operations
- Clean termination of the application
"""

import logging
import time
import asyncio
import sys
import os
from pathlib import Path
from typing import Dict, List, Optional, Any

# Configure logging with detailed formatting
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

class DBEngineCompleteAddressClient:
    """MCP client focused on complete address extraction from cheat tables"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            # Import required MCP server components
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            from cheatengine.ce_bridge import CheatEngineBridge
            from cheatengine.table_parser import CheatTableParser
            from process.manager import ProcessManager
            
            # Initialize components
            self.whitelist = ProcessWhitelist()
            self.whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            self.launcher = ApplicationLauncher(self.whitelist)
            self.ce_bridge = CheatEngineBridge()
            self.table_parser = CheatTableParser()
            self.process_manager = ProcessManager()
            
            # Application state
            self.dbengine_pid = None
            self.process_handle = None
            self.loaded_cheat_table = None
            self.complete_address_list = []
            
            logger.info("✅ DBEngine Complete Address Client initialized successfully")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import MCP server components: {e}")
            raise
        except Exception as e:
            logger.error(f"❌ Failed to initialize client: {e}")
            raise

    async def run_complete_test(self):
        """Run the complete DBEngine test with address extraction"""
        start_time = time.time()
        success = False
        
        try:
            self._print_header("DBEngine Complete Address List Test")
            
            # Step 1: Launch DBEngine
            if not await self.launch_dbengine():
                logger.error("❌ Failed to launch DBEngine - aborting test")
                return False
            
            # Step 2: Load cheat table
            cheat_table_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
            if not await self.load_cheat_table(cheat_table_path):
                logger.error("❌ Failed to load cheat table - aborting test")
                return False
            
            # Step 3: Extract complete address list
            await self.extract_complete_address_list()
            
            # Step 4: Display complete address list
            await self.display_complete_address_list()
            
            # Step 5: Test memory operations (if handle available)
            await self.test_memory_operations()
            
            success = True
            
        except Exception as e:
            logger.error(f"❌ Test execution failed: {e}")
            success = False
        finally:
            # Always cleanup
            await self.cleanup()
            
            # Summary
            elapsed_time = time.time() - start_time
            self._print_summary(success, elapsed_time)
            
        return success

    async def launch_dbengine(self) -> bool:
        """Launch DBEngine application with comprehensive logging"""
        try:
            self._print_section("Launching DBEngine Application")
            
            # Verify whitelist status
            whitelisted_apps = self.launcher.get_whitelisted_applications()
            dbengine_app = None
            
            for app in whitelisted_apps:
                if 'dbengine' in app['process_name'].lower():
                    dbengine_app = app
                    logger.info(f"✅ Found whitelisted: {app['process_name']} - {app['description']}")
                    break
            
            if not dbengine_app:
                logger.error("❌ DBEngine not found in process whitelist")
                logger.info("💡 Check process_whitelist.json configuration")
                return False
            
            # Launch application
            dbengine_path = r"C:\dbengine\dbengine-x86_64.exe"
            logger.info(f"🚀 Launching application: {dbengine_path}")
            
            if not Path(dbengine_path).exists():
                logger.error(f"❌ DBEngine executable not found: {dbengine_path}")
                return False
            
            success, message, pid = self.launcher.launch_application(dbengine_path)
            
            if success:
                self.dbengine_pid = pid
                logger.info(f"✅ Launch successful: {message}")
                logger.info(f"📍 Process ID: {pid}")
                
                # Wait for process initialization
                logger.info("⏳ Waiting for process initialization...")
                await asyncio.sleep(3)
                
                # Attempt to open process handle
                logger.info("🔓 Opening process handle for memory operations...")
                self.process_handle = self.ce_bridge.open_process_handle(pid)
                
                if self.process_handle:
                    logger.info(f"✅ Process handle opened successfully: {self.process_handle}")
                    logger.info("🔧 Memory operations will be available")
                else:
                    logger.warning("⚠️ Failed to open process handle")
                    logger.info("💡 Continuing in demonstration mode (cheat table parsing only)")
                
                return True
            else:
                logger.error(f"❌ Launch failed: {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error during DBEngine launch: {e}")
            return False

    async def load_cheat_table(self, table_path: str) -> bool:
        """Load and parse cheat table with detailed validation"""
        try:
            self._print_section("Loading Cheat Table")
            logger.info(f"📁 Target file: {table_path}")
            
            # Validate file existence
            table_file = Path(table_path)
            if not table_file.exists():
                logger.error(f"❌ Cheat table file not found: {table_path}")
                logger.info(f"💡 Please ensure the file exists at the specified location")
                return False
            
            # Get file information
            file_size = table_file.stat().st_size
            logger.info(f"📊 File size: {file_size:,} bytes ({file_size / 1024:.1f} KB)")
            
            # Parse cheat table
            logger.info("🔄 Parsing cheat table structure...")
            self.loaded_cheat_table = self.table_parser.parse_file(table_path)
            
            if not self.loaded_cheat_table:
                logger.error("❌ Failed to parse cheat table")
                logger.info("💡 File may be corrupted or in unsupported format")
                return False
            
            # Display comprehensive table information
            logger.info("✅ Cheat table loaded successfully!")
            logger.info(f"📝 Table title: {self.loaded_cheat_table.title or 'Untitled'}")
            logger.info(f"🎯 Target process: {self.loaded_cheat_table.target_process or 'Not specified'}")
            logger.info(f"📊 Total entries: {len(self.loaded_cheat_table.entries)}")
            
            # Analyze entry statistics
            entry_stats = self._analyze_table_entries()
            self._display_entry_statistics(entry_stats)
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error loading cheat table: {e}")
            return False

    def _analyze_table_entries(self) -> Dict[str, int]:
        """Analyze cheat table entries and return statistics"""
        stats = {
            'total': len(self.loaded_cheat_table.entries),
            'enabled': 0,
            'disabled': 0,
            'groups': 0,
            'addresses': 0,
            'pointers': 0,
            'with_offsets': 0,
            'with_hotkeys': 0,
            'with_values': 0
        }
        
        for entry in self.loaded_cheat_table.entries:
            if entry.group_header:
                stats['groups'] += 1
            else:
                if entry.enabled:
                    stats['enabled'] += 1
                else:
                    stats['disabled'] += 1
                
                if entry.address:
                    stats['addresses'] += 1
                
                if entry.variable_type == "Pointer":
                    stats['pointers'] += 1
                
                if entry.offsets:
                    stats['with_offsets'] += 1
                
                if entry.hotkey:
                    stats['with_hotkeys'] += 1
                
                if entry.value is not None:
                    stats['with_values'] += 1
        
        return stats

    def _display_entry_statistics(self, stats: Dict[str, int]):
        """Display comprehensive entry statistics"""
        logger.info("📈 Entry Statistics:")
        logger.info(f"   📁 Groups: {stats['groups']}")
        logger.info(f"   ✅ Enabled entries: {stats['enabled']}")
        logger.info(f"   ⭕ Disabled entries: {stats['disabled']}")
        logger.info(f"   📍 Entries with addresses: {stats['addresses']}")
        logger.info(f"   👉 Pointer entries: {stats['pointers']}")
        logger.info(f"   🔗 Entries with offsets: {stats['with_offsets']}")
        logger.info(f"   ⌨️ Entries with hotkeys: {stats['with_hotkeys']}")
        logger.info(f"   🎯 Entries with values: {stats['with_values']}")

    async def extract_complete_address_list(self):
        """Extract all memory addresses from the cheat table"""
        try:
            self._print_section("Extracting Complete Address List")
            
            if not self.loaded_cheat_table:
                logger.error("❌ No cheat table loaded")
                return
            
            self.complete_address_list = []
            group_context = []
            
            logger.info("🔍 Processing all table entries...")
            
            for i, entry in enumerate(self.loaded_cheat_table.entries, 1):
                if entry.group_header:
                    # Track group hierarchy
                    group_context.append(entry.description)
                    logger.info(f"📁 Group [{i:3d}]: {entry.description}")
                    continue
                
                # Extract address information
                address_info = {
                    'index': i,
                    'description': entry.description or f"Entry_{i}",
                    'address': entry.address,
                    'enabled': entry.enabled,
                    'variable_type': entry.variable_type or "Unknown",
                    'offsets': entry.offsets or [],
                    'value': entry.value,
                    'hotkey': entry.hotkey,
                    'group_path': " > ".join(group_context) if group_context else "Root",
                    'has_address': bool(entry.address),
                    'is_pointer': entry.variable_type == "Pointer"
                }
                
                self.complete_address_list.append(address_info)
                
                # Log basic info during extraction
                status = "✅" if entry.enabled else "⭕"
                addr_str = f"0x{entry.address:X}" if entry.address else "No Address"
                logger.info(f"   {status} [{i:3d}] {entry.description} - {addr_str}")
            
            # Summary
            total_entries = len(self.complete_address_list)
            addressable_entries = sum(1 for addr in self.complete_address_list if addr['has_address'])
            
            logger.info(f"✅ Extraction complete!")
            logger.info(f"📊 Total entries processed: {total_entries}")
            logger.info(f"📍 Entries with addresses: {addressable_entries}")
            logger.info(f"📈 Address extraction rate: {(addressable_entries/total_entries*100):.1f}%")
            
        except Exception as e:
            logger.error(f"❌ Error extracting address list: {e}")

    async def display_complete_address_list(self):
        """Display the complete address list in a formatted way"""
        try:
            self._print_section("Complete Address List Output")
            
            if not self.complete_address_list:
                logger.error("❌ No address list available")
                return
            
            logger.info("📋 COMPLETE MEMORY ADDRESS LIST")
            logger.info("=" * 80)
            
            # Sort addresses for better readability
            addressable_entries = [addr for addr in self.complete_address_list if addr['has_address']]
            addressable_entries.sort(key=lambda x: x['address'] if x['address'] else 0)
            
            # Display addressable entries
            logger.info(f"📍 ADDRESSABLE ENTRIES ({len(addressable_entries)} total):")
            logger.info("-" * 80)
            
            for i, addr_info in enumerate(addressable_entries, 1):
                status_icon = "✅" if addr_info['enabled'] else "⭕"
                address_hex = f"0x{addr_info['address']:X}" if addr_info['address'] else "None"
                
                logger.info(f"{status_icon} [{i:3d}] ADDRESS: {address_hex}")
                logger.info(f"    📝 Description: {addr_info['description']}")
                logger.info(f"    📊 Type: {addr_info['variable_type']}")
                
                if addr_info['group_path'] != "Root":
                    logger.info(f"    📁 Group: {addr_info['group_path']}")
                
                if addr_info['offsets']:
                    offset_str = ", ".join([f"0x{offset:X}" for offset in addr_info['offsets']])
                    logger.info(f"    🔗 Offsets: [{offset_str}]")
                
                if addr_info['value'] is not None:
                    logger.info(f"    🎯 Target Value: {addr_info['value']}")
                
                if addr_info['hotkey']:
                    logger.info(f"    ⌨️ Hotkey: {addr_info['hotkey']}")
                
                logger.info("")  # Empty line for readability
            
            # Display summary of addresses only
            logger.info("📊 ADDRESS SUMMARY (Hexadecimal):")
            logger.info("-" * 40)
            
            hex_addresses = [f"0x{addr['address']:X}" for addr in addressable_entries if addr['address']]
            
            # Display in columns for readability
            addresses_per_line = 4
            for i in range(0, len(hex_addresses), addresses_per_line):
                line_addresses = hex_addresses[i:i+addresses_per_line]
                logger.info("    " + "  |  ".join(f"{addr:>12}" for addr in line_addresses))
            
            # Final statistics
            logger.info("")
            logger.info("📈 FINAL STATISTICS:")
            logger.info(f"    Total table entries: {len(self.complete_address_list)}")
            logger.info(f"    Addressable entries: {len(addressable_entries)}")
            logger.info(f"    Enabled entries: {sum(1 for addr in addressable_entries if addr['enabled'])}")
            logger.info(f"    Pointer entries: {sum(1 for addr in addressable_entries if addr['is_pointer'])}")
            
            if hex_addresses:
                logger.info(f"    Address range: {min(hex_addresses)} to {max(hex_addresses)}")
            
        except Exception as e:
            logger.error(f"❌ Error displaying address list: {e}")

    async def test_memory_operations(self):
        """Test memory operations if process handle is available"""
        try:
            self._print_section("Testing Memory Operations")
            
            if not self.process_handle:
                logger.warning("⚠️ No process handle available - skipping memory tests")
                logger.info("💡 Memory operations require elevated privileges")
                return
            
            if not self.complete_address_list:
                logger.error("❌ No address list available for testing")
                return
            
            # Test memory reads on addressable entries
            addressable_entries = [addr for addr in self.complete_address_list if addr['has_address']]
            test_count = min(5, len(addressable_entries))  # Test first 5 addresses
            
            logger.info(f"🧪 Testing memory reads on {test_count} addresses...")
            
            for i, addr_info in enumerate(addressable_entries[:test_count], 1):
                try:
                    address = addr_info['address']
                    logger.info(f"[{i}] Testing address 0x{address:X} ({addr_info['description']})")
                    
                    # Try to read 8 bytes from the address
                    memory_data = self.ce_bridge.read_process_memory(self.process_handle, address, 8)
                    
                    if memory_data:
                        hex_data = memory_data.hex().upper()
                        logger.info(f"    ✅ Read successful: {hex_data}")
                        
                        # Try to interpret as different data types
                        if len(memory_data) >= 4:
                            import struct
                            try:
                                int32_val = struct.unpack('<I', memory_data[:4])[0]
                                logger.info(f"    📊 As uint32: {int32_val}")
                            except:
                                pass
                    else:
                        logger.info(f"    ❌ Read failed (access denied or invalid address)")
                
                except Exception as e:
                    logger.info(f"    ⚠️ Read error: {e}")
            
            logger.info("✅ Memory operation testing complete")
            
        except Exception as e:
            logger.error(f"❌ Error during memory operation testing: {e}")

    async def cleanup(self):
        """Clean up resources and terminate applications"""
        try:
            self._print_section("Cleanup and Termination")
            
            # Close process handle
            if self.process_handle:
                logger.info("🔒 Closing process handle...")
                try:
                    self.ce_bridge.close_process_handle(self.process_handle)
                    logger.info("✅ Process handle closed")
                except Exception as e:
                    logger.warning(f"⚠️ Error closing process handle: {e}")
                finally:
                    self.process_handle = None
            
            # Terminate DBEngine if running
            if self.dbengine_pid:
                logger.info(f"🛑 Terminating DBEngine (PID: {self.dbengine_pid})...")
                try:
                    success, message = self.launcher.terminate_application(self.dbengine_pid)
                    if success:
                        logger.info(f"✅ Termination successful: {message}")
                    else:
                        logger.warning(f"⚠️ Termination issue: {message}")
                except Exception as e:
                    logger.warning(f"⚠️ Error during termination: {e}")
                finally:
                    self.dbengine_pid = None
            
            # Clear loaded data
            self.loaded_cheat_table = None
            self.complete_address_list = []
            
            logger.info("✅ Cleanup completed")
            
        except Exception as e:
            logger.error(f"❌ Error during cleanup: {e}")

    def _print_header(self, title: str):
        """Print a formatted header"""
        logger.info("=" * 80)
        logger.info(f"🎯 {title.center(74)} 🎯")
        logger.info("=" * 80)

    def _print_section(self, title: str):
        """Print a formatted section header"""
        logger.info(f"\n🔧 {title}")
        logger.info("-" * (len(title) + 5))

    def _print_summary(self, success: bool, elapsed_time: float):
        """Print test summary"""
        self._print_section("Test Summary")
        
        status = "✅ SUCCESS" if success else "❌ FAILED"
        logger.info(f"Result: {status}")
        logger.info(f"Duration: {elapsed_time:.2f} seconds")
        
        if success:
            logger.info("🎉 All operations completed successfully!")
            if self.complete_address_list:
                addressable_count = sum(1 for addr in self.complete_address_list if addr['has_address'])
                logger.info(f"📍 Extracted {addressable_count} memory addresses from cheat table")
        else:
            logger.info("💔 Test execution encountered errors")
        
        logger.info("=" * 80)

# Main execution
async def main():
    """Main execution function"""
    try:
        logger.info("🚀 Starting DBEngine Complete Address List Test")
        
        # Create and run client
        client = DBEngineCompleteAddressClient()
        success = await client.run_complete_test()
        
        # Exit with appropriate code
        exit_code = 0 if success else 1
        logger.info(f"🏁 Exiting with code: {exit_code}")
        return exit_code
        
    except KeyboardInterrupt:
        logger.info("\n⚠️ Test interrupted by user")
        return 1
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
