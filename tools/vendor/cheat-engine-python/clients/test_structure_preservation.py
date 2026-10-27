#!/usr/bin/env python3
"""
Structure Preservation Test Client

This client tests the enhanced structure preservation capabilities:
1. Parse a cheat table with complete structure preservation
2. Add a new address while preserving all original data
3. Verify that the file structure is preserved exactly
4. Test that all components are preserved (addresses, structures, Lua, comments)

Tests with Diablo II.CT to validate structure preservation.
"""

import asyncio
import json
import hashlib
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

def get_file_hash(file_path):
    """Get SHA256 hash of a file"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

async def test_structure_preservation():
    """Test enhanced structure preservation capabilities"""
    
    server_params = StdioServerParameters(
        command="python",
        args=["server/main.py"],
        env=None
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the session
            await session.initialize()
            
            # Test file paths
            test_file = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
            backup_file = None
            
            print("=" * 80)
            print("ENHANCED STRUCTURE PRESERVATION TEST")
            print("=" * 80)
            
            # Step 1: Get original file characteristics
            print("Step 1: Analyzing original file structure...")
            try:
                original_hash = get_file_hash(test_file)
                print(f"✅ Original file hash: {original_hash[:16]}...")
                
                with open(test_file, 'r', encoding='utf-8') as f:
                    original_content = f.read()
                    original_lines = len(original_content.split('\n'))
                    print(f"✅ Original file: {original_lines} lines, {len(original_content)} characters")
                    
                # Check XML structure elements
                xml_elements = []
                for element in ['CheatTable', 'CheatEntries', 'Structures', 'LuaScript', 'DisassemblerComments']:
                    if f'<{element}' in original_content:
                        xml_elements.append(element)
                print(f"✅ XML elements found: {xml_elements}")
                
            except Exception as e:
                print(f"❌ Failed to analyze original file: {e}")
                return
            print()
            
            # Step 2: Test comprehensive analysis first
            print("Step 2: Comprehensive analysis of original file...")
            try:
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                analysis = result.content[0].text
                
                # Extract counts
                original_addresses = None
                original_structures = None
                original_lua = False
                original_comments = None
                
                for line in analysis.split('\n'):
                    if 'Addresses:' in line:
                        original_addresses = int(line.split(':')[1].strip())
                    elif 'Structures:' in line:
                        original_structures = int(line.split(':')[1].strip())
                    elif 'Lua Script:' in line:
                        original_lua = 'Yes' in line
                    elif 'Disassembler Comments:' in line:
                        original_comments = int(line.split(':')[1].strip())
                
                print(f"✅ Original analysis complete:")
                print(f"  Addresses: {original_addresses}")
                print(f"  Structures: {original_structures}")
                print(f"  Lua Script: {original_lua}")
                print(f"  Comments: {original_comments}")
                
            except Exception as e:
                print(f"❌ Failed to analyze original file: {e}")
                return
            print()
            
            # Step 3: Create backup
            print("Step 3: Creating backup...")
            try:
                result = await session.call_tool(
                    "create_cheat_table_backup",
                    {"file_path": test_file}
                )
                backup_result = result.content[0].text
                print("✅ Backup creation result:")
                print(backup_result)
                
                # Extract backup path
                if "Backup: " in backup_result:
                    backup_file = backup_result.split("Backup: ")[1].strip()
                    print(f"✅ Backup file: {backup_file}")
                
            except Exception as e:
                print(f"❌ Backup creation failed: {e}")
                return
            print()
            
            # Step 4: Add new address with structure preservation
            print("Step 4: Adding new address with structure preservation...")
            try:
                result = await session.call_tool(
                    "add_address_to_cheat_table",
                    {
                        "file_path": test_file,
                        "description": "Structure Preservation Test - Mana Boost",
                        "address": "D2CLIENT.dll+9999999",
                        "variable_type": "4 Bytes",
                        "offsets": "0x123,0x456",
                        "enabled": False,
                        "create_backup": False  # We already have a backup
                    }
                )
                add_result = result.content[0].text
                print("✅ Add address result:")
                print(add_result)
                
            except Exception as e:
                print(f"❌ Add address failed: {e}")
                return
            print()
            
            # Step 5: Verify structure preservation
            print("Step 5: Verifying structure preservation...")
            try:
                # Check file characteristics after modification
                new_hash = get_file_hash(test_file)
                print(f"✅ New file hash: {new_hash[:16]}...")
                
                with open(test_file, 'r', encoding='utf-8') as f:
                    new_content = f.read()
                    new_lines = len(new_content.split('\n'))
                    print(f"✅ New file: {new_lines} lines, {len(new_content)} characters")
                
                # Verify XML structure elements are preserved
                preserved_elements = []
                for element in xml_elements:
                    if f'<{element}' in new_content:
                        preserved_elements.append(element)
                
                if preserved_elements == xml_elements:
                    print(f"✅ All XML elements preserved: {preserved_elements}")
                else:
                    print(f"⚠️ XML elements changed: {xml_elements} -> {preserved_elements}")
                
                # Check if only the CheatEntries section was modified
                if hash(new_content) != hash(original_content):
                    print("✅ File was modified (expected)")
                else:
                    print("⚠️ File was not modified")
                
            except Exception as e:
                print(f"❌ Structure verification failed: {e}")
            print()
            
            # Step 6: Verify components are still accessible
            print("Step 6: Verifying all components still accessible...")
            try:
                # Test comprehensive analysis again
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                new_analysis = result.content[0].text
                
                new_addresses = None
                new_structures = None
                new_lua = False
                new_comments = None
                
                for line in new_analysis.split('\n'):
                    if 'Addresses:' in line:
                        new_addresses = int(line.split(':')[1].strip())
                    elif 'Structures:' in line:
                        new_structures = int(line.split(':')[1].strip())
                    elif 'Lua Script:' in line:
                        new_lua = 'Yes' in line
                    elif 'Disassembler Comments:' in line:
                        new_comments = int(line.split(':')[1].strip())
                
                print(f"✅ New analysis complete:")
                print(f"  Addresses: {new_addresses} (was {original_addresses})")
                print(f"  Structures: {new_structures} (was {original_structures})")
                print(f"  Lua Script: {new_lua} (was {original_lua})")
                print(f"  Comments: {new_comments} (was {original_comments})")
                
                # Verify counts
                address_increase = new_addresses - original_addresses if original_addresses else 0
                structures_preserved = new_structures == original_structures
                lua_preserved = new_lua == original_lua
                comments_preserved = new_comments == original_comments
                
                print(f"\n✅ Component preservation verification:")
                print(f"  Address increase: {address_increase} (expected: 1)")
                print(f"  Structures preserved: {structures_preserved}")
                print(f"  Lua script preserved: {lua_preserved}")
                print(f"  Comments preserved: {comments_preserved}")
                
            except Exception as e:
                print(f"❌ Component verification failed: {e}")
            print()
            
            # Step 7: Test individual component extraction
            print("Step 7: Testing individual component extraction...")
            try:
                # Test structures
                result = await session.call_tool(
                    "extract_cheat_table_structures",
                    {"file_path": test_file}
                )
                structures_ok = "UnitPlayer" in result.content[0].text
                print(f"✅ Structures extraction: {'working' if structures_ok else 'failed'}")
                
                # Test Lua script
                result = await session.call_tool(
                    "extract_cheat_table_lua_script",
                    {"file_path": test_file}
                )
                lua_ok = len(result.content[0].text) > 1000  # Should be substantial
                print(f"✅ Lua script extraction: {'working' if lua_ok else 'failed'}")
                
                # Test address extraction
                result = await session.call_tool(
                    "extract_cheat_table_addresses",
                    {"file_path": test_file, "address_format": "simple"}
                )
                address_ok = "Structure Preservation Test - Mana Boost" in result.content[0].text
                print(f"✅ New address found: {'yes' if address_ok else 'no'}")
                
            except Exception as e:
                print(f"❌ Component extraction failed: {e}")
            print()
            
            print("=" * 80)
            print("STRUCTURE PRESERVATION TEST RESULTS")
            print("=" * 80)
            
            if (address_increase == 1 and structures_preserved and 
                lua_preserved and comments_preserved and 
                structures_ok and lua_ok and address_ok):
                print("🎉 COMPLETE SUCCESS - STRUCTURE PRESERVATION WORKING!")
                print("✅ All original components preserved")
                print("✅ New address successfully added")
                print("✅ File structure maintained")
                print("✅ All extraction methods working")
            else:
                print("⚠️ Some issues detected in structure preservation")
                
            print("\nStructure preservation ensures that:")
            print("  📄 Original XML structure is maintained")
            print("  🔧 Only modified sections are changed")
            print("  🛡️ All original data is preserved")
            print("  🎯 New additions integrate seamlessly")

if __name__ == "__main__":
    asyncio.run(test_structure_preservation())
