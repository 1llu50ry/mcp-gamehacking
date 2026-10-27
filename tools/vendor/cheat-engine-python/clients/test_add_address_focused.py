#!/usr/bin/env python3
"""
Focused Test for Add Address Functionality

This test specifically validates the add address to cheat table functionality
that failed in the previous test, and then verifies comprehensive operations.
"""

import asyncio
import json
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test_add_address_functionality():
    """Test specifically the add address functionality with improved error handling"""
    
    server_params = StdioServerParameters(
        command="python",
        args=["server/main.py"],
        env=None
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the session
            await session.initialize()
            
            # Test file path
            test_file = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
            
            print("=" * 60)
            print("FOCUSED TEST: Add Address to Cheat Table")
            print("=" * 60)
            
            # Step 1: Create backup first
            print("Step 1: Creating backup...")
            try:
                result = await session.call_tool(
                    "create_cheat_table_backup",
                    {"file_path": test_file}
                )
                print("✅ Backup creation successful!")
                print(result.content[0].text)
            except Exception as e:
                print(f"❌ Backup creation failed: {e}")
                return
            print()
            
            # Step 2: Get original count
            print("Step 2: Getting original address count...")
            try:
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                analysis = result.content[0].text
                # Extract address count
                original_count = None
                for line in analysis.split('\n'):
                    if 'Addresses:' in line:
                        original_count = int(line.split(':')[1].strip())
                        break
                print(f"✅ Original address count: {original_count}")
            except Exception as e:
                print(f"❌ Failed to get original count: {e}")
                original_count = None
            print()
            
            # Step 3: Add new address with detailed debugging
            print("Step 3: Adding new address with detailed parameters...")
            try:
                result = await session.call_tool(
                    "add_address_to_cheat_table",
                    {
                        "file_path": test_file,
                        "description": "Test Gold Amount - Added by MCP",
                        "address": "D2GAME.dll+1234567",  # Module+offset format
                        "variable_type": "4 Bytes", 
                        "offsets": "0x490,0x10",
                        "enabled": True,
                        "create_backup": False  # We already created backup
                    }
                )
                add_result = result.content[0].text
                print("Add address result:")
                print(add_result)
                
                if "✅" in add_result:
                    print("✅ Add operation reported success!")
                else:
                    print("⚠️ Add operation may have failed")
                    
            except Exception as e:
                print(f"❌ Add address failed with exception: {e}")
                return
            print()
            
            # Step 4: Verify by getting new count
            print("Step 4: Verifying address was added...")
            try:
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                analysis = result.content[0].text
                # Extract new address count
                new_count = None
                for line in analysis.split('\n'):
                    if 'Addresses:' in line:
                        new_count = int(line.split(':')[1].strip())
                        break
                
                print(f"New address count: {new_count}")
                if original_count and new_count:
                    if new_count > original_count:
                        print(f"✅ Address successfully added! Count increased from {original_count} to {new_count}")
                    else:
                        print(f"❌ Address count unchanged: {original_count} -> {new_count}")
                else:
                    print("⚠️ Could not verify count change")
                    
            except Exception as e:
                print(f"❌ Failed to verify new count: {e}")
            print()
            
            # Step 5: Look for the specific address in the list
            print("Step 5: Searching for the new address in address list...")
            try:
                result = await session.call_tool(
                    "extract_cheat_table_addresses",
                    {"file_path": test_file, "address_format": "simple"}
                )
                addresses_text = result.content[0].text
                
                if "Test Gold Amount - Added by MCP" in addresses_text:
                    print("✅ New address found in address list!")
                    # Find the line containing our address
                    lines = addresses_text.split('\n')
                    for line in lines:
                        if "Test Gold Amount - Added by MCP" in line:
                            print(f"  Found: {line}")
                            break
                else:
                    print("❌ New address not found in address list")
                    print("First 10 lines of address list:")
                    lines = addresses_text.split('\n')
                    for i, line in enumerate(lines[:10]):
                        print(f"  {i+1}: {line}")
                    
            except Exception as e:
                print(f"❌ Failed to search address list: {e}")
            print()
            
            # Step 6: Test creating a new table and adding address
            print("Step 6: Testing with new empty table...")
            new_table_path = r"C:\Users\benam\Documents\My Cheat Tables\Test_Add_Address.CT"
            
            try:
                # Create new table
                result = await session.call_tool(
                    "create_new_cheat_table",
                    {
                        "file_path": new_table_path,
                        "title": "Add Address Test Table",
                        "target_process": "TestGame.exe"
                    }
                )
                print("✅ New test table created")
                
                # Add address to new table
                result = await session.call_tool(
                    "add_address_to_cheat_table",
                    {
                        "file_path": new_table_path,
                        "description": "Test Health",
                        "address": "0x12345678",
                        "variable_type": "4 Bytes",
                        "enabled": False,
                        "create_backup": False
                    }
                )
                add_result = result.content[0].text
                print("Add to new table result:")
                print(add_result)
                
                # Verify new table
                result = await session.call_tool(
                    "extract_cheat_table_addresses",
                    {"file_path": new_table_path, "address_format": "table"}
                )
                verification = result.content[0].text
                print("New table verification:")
                print(verification[:500] + "..." if len(verification) > 500 else verification)
                
                # Clean up
                if Path(new_table_path).exists():
                    Path(new_table_path).unlink()
                    print("🧹 Test table cleaned up")
                    
            except Exception as e:
                print(f"❌ New table test failed: {e}")
            
            print("=" * 60)
            print("ADD ADDRESS TEST COMPLETE")
            print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_add_address_functionality())
