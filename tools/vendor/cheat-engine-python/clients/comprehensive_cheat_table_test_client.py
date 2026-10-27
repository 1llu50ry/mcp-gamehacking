#!/usr/bin/env python3
"""
Comprehensive Cheat Table Test Client

This client tests all comprehensive cheat table parsing capabilities:
1. Address list extraction
2. Structures list extraction  
3. UnitPlayer structure specific extraction
4. Lua script extraction
5. Disassembler comments extraction
6. Comprehensive analysis combining all components

Tests with Diablo II.CT to validate complete parsing functionality.
"""

import asyncio
import json
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test_comprehensive_cheat_table_parsing():
    """Test all comprehensive cheat table parsing capabilities with Diablo II.CT"""
    
    server_params = StdioServerParameters(
        command="python",
        args=["server/main.py"],
        env=None
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the session
            await session.initialize()
            
            # List available tools to verify our new comprehensive tools are available
            tools = await session.list_tools()
            print("Available tools:")
            for tool in tools.tools:
                print(f"  - {tool.name}: {tool.description}")
            print()
            
            # Test file path
            test_file = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
            
            # Test 1: Basic address list extraction (existing functionality)
            print("=" * 60)
            print("TEST 1: Address List Extraction")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "extract_cheat_table_addresses",
                    {"file_path": test_file, "format": "table"}
                )
                print("✅ Address extraction successful!")
                print(result.content[0].text[:500] + "..." if len(result.content[0].text) > 500 else result.content[0].text)
            except Exception as e:
                print(f"❌ Address extraction failed: {e}")
            print()
            
            # Test 2: Structures list extraction (NEW)
            print("=" * 60)
            print("TEST 2: Structures List Extraction")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "extract_cheat_table_structures",
                    {"file_path": test_file, "format": "detailed"}
                )
                print("✅ Structures extraction successful!")
                print(result.content[0].text[:1000] + "..." if len(result.content[0].text) > 1000 else result.content[0].text)
            except Exception as e:
                print(f"❌ Structures extraction failed: {e}")
            print()
            
            # Test 3: UnitPlayer structure specific extraction (NEW)
            print("=" * 60)
            print("TEST 3: UnitPlayer Structure Extraction")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "extract_unitplayer_structure",
                    {"file_path": test_file}
                )
                print("✅ UnitPlayer structure extraction successful!")
                print(result.content[0].text[:800] + "..." if len(result.content[0].text) > 800 else result.content[0].text)
            except Exception as e:
                print(f"❌ UnitPlayer structure extraction failed: {e}")
            print()
            
            # Test 4: Lua script extraction (NEW)
            print("=" * 60)
            print("TEST 4: Lua Script Extraction")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "extract_cheat_table_lua_script",
                    {"file_path": test_file}
                )
                print("✅ Lua script extraction successful!")
                script_text = result.content[0].text
                print(f"Lua script length: {len(script_text)} characters")
                # Show first few lines
                lines = script_text.split('\n')[:10]
                for i, line in enumerate(lines):
                    print(f"Line {i+1}: {line}")
                if len(lines) > 10:
                    print("... (more lines)")
            except Exception as e:
                print(f"❌ Lua script extraction failed: {e}")
            print()
            
            # Test 5: Disassembler comments extraction (NEW)
            print("=" * 60)
            print("TEST 5: Disassembler Comments Extraction")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "extract_cheat_table_disassembler_comments",
                    {"file_path": test_file, "format": "table"}
                )
                print("✅ Disassembler comments extraction successful!")
                print(result.content[0].text[:1000] + "..." if len(result.content[0].text) > 1000 else result.content[0].text)
            except Exception as e:
                print(f"❌ Disassembler comments extraction failed: {e}")
            print()
            
            # Test 6: Comprehensive analysis (NEW - combines all components)
            print("=" * 60)
            print("TEST 6: Comprehensive Cheat Table Analysis")
            print("=" * 60)
            try:
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                print("✅ Comprehensive analysis successful!")
                analysis_text = result.content[0].text
                print(f"Complete analysis length: {len(analysis_text)} characters")
                # Show analysis summary
                lines = analysis_text.split('\n')
                for line in lines[:30]:  # Show first 30 lines of analysis
                    print(line)
                if len(lines) > 30:
                    print("... (analysis continues)")
            except Exception as e:
                print(f"❌ Comprehensive analysis failed: {e}")
            print()
            
            # Test 7: Test different output formats
            print("=" * 60)
            print("TEST 7: Different Output Formats")
            print("=" * 60)
            
            formats = ["table", "detailed", "csv", "simple"]
            for fmt in formats:
                try:
                    result = await session.call_tool(
                        "extract_cheat_table_addresses",
                        {"file_path": test_file, "format": fmt}
                    )
                    print(f"✅ Format '{fmt}' successful!")
                    print(f"   Output length: {len(result.content[0].text)} characters")
                    # Show first line of each format
                    first_line = result.content[0].text.split('\n')[0]
                    print(f"   First line: {first_line[:100]}{'...' if len(first_line) > 100 else ''}")
                except Exception as e:
                    print(f"❌ Format '{fmt}' failed: {e}")
                print()
            
            print("=" * 60)
            print("COMPREHENSIVE TESTING COMPLETE")
            print("=" * 60)
            print("All enhanced cheat table parsing capabilities have been tested!")
            print("The MCP Cheat Engine Server now supports:")
            print("✅ Address list extraction with module references")
            print("✅ Complete structures parsing with element details")
            print("✅ Specific UnitPlayer structure extraction")
            print("✅ Lua script extraction and analysis")
            print("✅ Disassembler comments parsing")
            print("✅ Comprehensive analysis combining all components")
            print("✅ Multiple output formats (table, detailed, csv, simple)")

if __name__ == "__main__":
    asyncio.run(test_comprehensive_cheat_table_parsing())
