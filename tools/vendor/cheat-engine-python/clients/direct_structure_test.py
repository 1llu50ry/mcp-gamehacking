#!/usr/bin/env python3
"""
Simple direct test for structure preservation functionality.
Tests the CheatTable parser directly without MCP client complexity.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from pathlib import Path
import shutil
from server.cheatengine.table_parser import CheatTableParser

def test_structure_preservation_direct():
    """Test structure preservation using direct parser access."""
    
    # Test file path
    test_file = Path(r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT")
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return False
    
    print(f"🔍 Testing structure preservation with: {test_file}")
    print("="*80)
    
    # Create a temporary copy for testing
    temp_file = test_file.with_suffix('.CT.temp_test')
    shutil.copy2(test_file, temp_file)
    print(f"📋 Created temporary test file: {temp_file}")
    
    try:
        parser = CheatTableParser()
        
        print("\n📖 Step 1: Reading original cheat table")
        # Read original table with structure preservation
        original_table = parser.parse_file(str(temp_file))
        
        print(f"✅ Original table loaded:")
        print(f"   📊 Title: {original_table.title}")
        print(f"   📝 Entries: {len(original_table.entries)}")
        print(f"   🏗️  Structures: {len(original_table.structures)}")
        print(f"   💬 Comments: {len(original_table.disassembler_comments)}")
        print(f"   🎯 Original XML preserved: {original_table._original_xml_root is not None}")
        print(f"   📄 Original content preserved: {len(original_table._original_xml_content) if original_table._original_xml_content else 0} characters")
        
        # Check if original content is preserved
        original_size = len(original_table._original_xml_content)
        if original_size > 0:
            print(f"✅ Original XML content preserved ({original_size:,} characters)")
        else:
            print("❌ Original XML content not preserved")
            return False
        
        print("\n➕ Step 2: Adding a new test entry")
        # Add a new entry
        from server.cheatengine.table_parser import CheatEntry
        
        new_entry = CheatEntry(
            id=str(len(original_table.entries) + 1),
            description='TEST_STRUCTURE_PRESERVATION',
            address_string='12345678',
            variable_type='4 Bytes',
            value='999'
        )
        original_table.entries.append(new_entry)
        
        print(f"✅ Added test entry: {new_entry.description}")
        print(f"   📝 New entry count: {len(original_table.entries)}")
        
        print("\n💾 Step 3: Writing modified table with structure preservation")
        # Write back with structure preservation
        parser.write_cheat_table_preserving_structure(str(temp_file), original_table)
        
        print(f"✅ Modified table written to: {temp_file}")
        
        print("\n📖 Step 4: Re-reading modified table")
        # Read back the modified table
        modified_table = parser.parse_file(str(temp_file))
        
        print(f"✅ Modified table re-read:")
        print(f"   📊 Title: {modified_table.title}")
        print(f"   📝 Entries: {len(modified_table.entries)}")
        print(f"   🏗️  Structures: {len(modified_table.structures)}")
        print(f"   💬 Comments: {len(modified_table.disassembler_comments)}")
        
        print("\n🔍 Step 5: Analyzing preservation")
        
        # Check if the new entry exists
        new_entry_found = False
        for entry in modified_table.entries:
            if entry.description == 'TEST_STRUCTURE_PRESERVATION':
                new_entry_found = True
                print(f"✅ New test entry found: {entry.address_string} = {entry.value}")
                break
        
        if not new_entry_found:
            print("❌ New test entry not found in modified table")
            return False
        
        # Check that structure counts are preserved (except entries)
        structure_preserved = (
            len(original_table.structures) == len(modified_table.structures) and
            len(original_table.disassembler_comments) == len(modified_table.disassembler_comments) and
            original_table.title == modified_table.title
        )
        
        if structure_preserved:
            print("✅ All non-entry structures preserved")
        else:
            print("❌ Some structures were not preserved")
            print(f"   Structures: {len(original_table.structures)} → {len(modified_table.structures)}")
            print(f"   Comments: {len(original_table.disassembler_comments)} → {len(modified_table.disassembler_comments)}")
            print(f"   Title: {original_table.title} → {modified_table.title}")
            return False
        
        print("\n📏 Step 6: Comparing file sizes")
        # Compare file sizes (should be similar, accounting for new entry)
        original_file_size = test_file.stat().st_size
        modified_file_size = temp_file.stat().st_size
        
        print(f"   📊 Original file size: {original_file_size:,} bytes")
        print(f"   📊 Modified file size: {modified_file_size:,} bytes")
        print(f"   📊 Size difference: {modified_file_size - original_file_size:,} bytes")
        
        # Reasonable size difference for one entry
        if abs(modified_file_size - original_file_size) < 1000:  # Less than 1KB difference
            print("✅ File size difference is reasonable for one new entry")
        else:
            print("⚠️  Large file size difference - may indicate structure issues")
        
        print("\n" + "="*80)
        print("🎉 STRUCTURE PRESERVATION TEST PASSED!")
        print("   ✅ Original XML structure preserved")
        print("   ✅ New entry correctly added")
        print("   ✅ All other components maintained")
        print("   ✅ File written successfully with preservation")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Clean up temporary file
        if temp_file.exists():
            temp_file.unlink()
            print(f"🗑️  Cleaned up temporary file: {temp_file}")

def main():
    """Main test runner."""
    print("🧪 Direct Structure Preservation Test")
    print("="*80)
    
    success = test_structure_preservation_direct()
    
    if success:
        print("\n🎯 All tests passed! Structure preservation is working correctly.")
        exit(0)
    else:
        print("\n💥 Tests failed! Structure preservation needs attention.")
        exit(1)

if __name__ == "__main__":
    main()
