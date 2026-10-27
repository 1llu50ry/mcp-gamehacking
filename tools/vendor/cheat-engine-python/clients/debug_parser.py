#!/usr/bin/env python3
"""
Debug parser directly
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from cheatengine.table_parser import CheatTableParser
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG)

# Test parsing
parser = CheatTableParser()
test_file = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"

print("Testing direct parsing...")
try:
    cheat_table = parser.parse_file(test_file)
    if cheat_table:
        print(f"✅ CheatTable parsed successfully:")
        print(f"  Title: {cheat_table.title}")
        print(f"  Entries: {len(cheat_table.entries)}")
        print(f"  Structures: {len(cheat_table.structures)}")
        print(f"  Lua script: {'yes' if cheat_table.lua_script else 'no'}")
        print(f"  Comments: {len(cheat_table.disassembler_comments)}")
    else:
        print("❌ CheatTable parsing failed")
        
    print("\nTesting compatibility method...")
    address_list = parser.parse_file_to_addresslist(test_file)
    if address_list:
        print(f"✅ AddressList conversion successful:")
        print(f"  Title: {address_list.title}")
        print(f"  Entries: {len(address_list.entries)}")
        print(f"  Structures: {len(address_list.structures) if address_list.structures else 0}")
        print(f"  Lua script: {'yes' if address_list.lua_script else 'no'}")
        print(f"  Comments: {len(address_list.disassembler_comments) if address_list.disassembler_comments else 0}")
    else:
        print("❌ AddressList conversion failed")
        
except Exception as e:
    print(f"❌ Exception: {e}")
    import traceback
    traceback.print_exc()
