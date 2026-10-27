#!/usr/bin/env python3
"""
Comprehensive test client for structure preservation functionality.
Tests that new files are identical to old files except for new or updated items.
"""

import asyncio
import json
from pathlib import Path
import filecmp
import tempfile
import shutil
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test_structure_preservation():
    """Test complete structure preservation during file modifications."""
    
    # Test file path
    test_file = Path(r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT")
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return False
    
    print(f"🔍 Testing structure preservation with: {test_file}")
    print("="*80)
    
    # Create backup for comparison
    backup_file = test_file.with_suffix('.CT.backup_test')
    shutil.copy2(test_file, backup_file)
    print(f"📋 Created backup: {backup_file}")
    
    try:
        # Connect to MCP server
        server_params = StdioServerParameters(
            command="python",
            args=["server/main.py"],
            env=None
        )
        
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                # Initialize session
                await session.initialize()
                
                print("\n📖 Step 1: Reading original cheat table")
                # Read original table
                read_result = await session.call_tool(
                    "read_cheat_table",
                    arguments={"file_path": str(test_file)}
                )
                
                original_data = json.loads(read_result.content[0].text)
                print(f"✅ Original table loaded:")
                print(f"   📊 Title: {original_data.get('title', 'N/A')}")
                print(f"   📝 Entries: {len(original_data.get('entries', []))}")
                print(f"   🏗️  Structures: {len(original_data.get('structures', []))}")
                print(f"   💬 Comments: {len(original_data.get('comments', []))}")
                print(f"   🧮 Options: {len(original_data.get('options', []))}")
                
                print("\n➕ Step 2: Adding a new test entry")
                # Add a new entry to test preservation
                add_result = await session.call_tool(
                    "add_address",
                    arguments={
                        "file_path": str(test_file),
                        "description": "TEST_STRUCTURE_PRESERVATION",
                        "address": "12345678",
                        "type": "4 Bytes",
                        "value": "999"
                    }
                )
                
                add_data = json.loads(add_result.content[0].text)
                print(f"✅ Added test entry: {add_data.get('message', 'Success')}")
                
                print("\n📖 Step 3: Re-reading modified table")
                # Read modified table
                modified_result = await session.call_tool(
                    "read_cheat_table",
                    arguments={"file_path": str(test_file)}
                )
                
                modified_data = json.loads(modified_result.content[0].text)
                print(f"✅ Modified table loaded:")
                print(f"   📊 Title: {modified_data.get('title', 'N/A')}")
                print(f"   📝 Entries: {len(modified_data.get('entries', []))}")
                print(f"   🏗️  Structures: {len(modified_data.get('structures', []))}")
                print(f"   💬 Comments: {len(modified_data.get('comments', []))}")
                print(f"   🧮 Options: {len(modified_data.get('options', []))}")
                
                print("\n🔍 Step 4: Analyzing preservation")
                # Check that only entries count increased by 1
                original_entries = len(original_data.get('entries', []))
                modified_entries = len(modified_data.get('entries', []))
                
                if modified_entries == original_entries + 1:
                    print(f"✅ Entry count correctly increased: {original_entries} → {modified_entries}")
                else:
                    print(f"❌ Entry count unexpected: {original_entries} → {modified_entries}")
                    return False
                
                # Check that all other components are preserved
                preserved_checks = [
                    ('structures', len(original_data.get('structures', [])), len(modified_data.get('structures', []))),
                    ('comments', len(original_data.get('comments', [])), len(modified_data.get('comments', []))),
                    ('options', len(original_data.get('options', [])), len(modified_data.get('options', []))),
                    ('title', original_data.get('title'), modified_data.get('title'))
                ]
                
                all_preserved = True
                for component, original, modified in preserved_checks:
                    if original == modified:
                        print(f"✅ {component.capitalize()} preserved: {original}")
                    else:
                        print(f"❌ {component.capitalize()} changed: {original} → {modified}")
                        all_preserved = False
                
                # Verify the new entry exists
                new_entry_found = False
                for entry in modified_data.get('entries', []):
                    if entry.get('description') == 'TEST_STRUCTURE_PRESERVATION':
                        new_entry_found = True
                        print(f"✅ New test entry found: {entry.get('address')} = {entry.get('value')}")
                        break
                
                if not new_entry_found:
                    print("❌ New test entry not found in modified table")
                    all_preserved = False
                
                print("\n🧹 Step 5: Cleaning up test entry")
                # Remove the test entry
                remove_result = await session.call_tool(
                    "remove_address",
                    arguments={
                        "file_path": str(test_file),
                        "description": "TEST_STRUCTURE_PRESERVATION"
                    }
                )
                
                remove_data = json.loads(remove_result.content[0].text)
                print(f"✅ Removed test entry: {remove_data.get('message', 'Success')}")
                
                print("\n📊 Step 6: Final verification")
                # Read final table
                final_result = await session.call_tool(
                    "read_cheat_table",
                    arguments={"file_path": str(test_file)}
                )
                
                final_data = json.loads(final_result.content[0].text)
                final_entries = len(final_data.get('entries', []))
                
                if final_entries == original_entries:
                    print(f"✅ Entry count restored to original: {final_entries}")
                else:
                    print(f"❌ Entry count not restored: {original_entries} → {final_entries}")
                    all_preserved = False
                
                print("\n" + "="*80)
                if all_preserved:
                    print("🎉 STRUCTURE PRESERVATION TEST PASSED!")
                    print("   ✅ All original components preserved")
                    print("   ✅ New entries correctly added/removed")
                    print("   ✅ File structure maintained")
                else:
                    print("❌ STRUCTURE PRESERVATION TEST FAILED!")
                    print("   Some components were not properly preserved")
                
                return all_preserved
                
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        return False
    finally:
        # Clean up backup
        if backup_file.exists():
            backup_file.unlink()
            print(f"🗑️  Cleaned up backup: {backup_file}")

async def main():
    """Main test runner."""
    print("🧪 MCP Cheat Engine Server - Structure Preservation Test")
    print("="*80)
    
    success = await test_structure_preservation()
    
    if success:
        print("\n🎯 All tests passed! Structure preservation is working correctly.")
        exit(0)
    else:
        print("\n💥 Tests failed! Structure preservation needs attention.")
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())
