"""
Unit Tests for Advanced Cheat Engine Bridge Functionality

Tests the new advanced memory scanning, disassembly, pointer analysis,
and data structure detection features added to the CheatEngineBridge class.
"""

import unittest
import struct
import ctypes
import tempfile
import os
from unittest.mock import Mock, patch, MagicMock, call
from typing import List, Dict, Any

# Import the module under test
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'server'))

from cheatengine.ce_bridge import (
    CheatEngineBridge, 
    MemoryScanResult, 
    DisassemblyResult,
    CEProcess,
    CEInstallation
)


class TestAdvancedMemoryScanning(unittest.TestCase):
    """Test advanced memory scanning functionality"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.bridge = CheatEngineBridge()
        
        # Mock the Windows API calls
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
        # Mock CE installation
        self.bridge.ce_installation = CEInstallation(
            path=r"C:\dbengine",
            version="7.5",
            executable=r"C:\dbengine\dbengine-x86_64.exe",
            available=True
        )
        
        # Sample test data
        self.test_handle = 1234
        self.test_address = 0x140000000
        self.test_data = bytearray(1024)
        
        # Fill test data with patterns
        struct.pack_into('<i', self.test_data, 0, 1000)      # int32 at offset 0
        struct.pack_into('<i', self.test_data, 4, 2000)      # int32 at offset 4
        struct.pack_into('<f', self.test_data, 8, 3.14)      # float at offset 8
        struct.pack_into('<d', self.test_data, 16, 2.718)    # double at offset 16
        self.test_data[100:108] = b"TestStr\x00"             # string at offset 100
        
    def test_value_to_bytes_conversion(self):
        """Test conversion of values to byte patterns"""
        # Test integer conversions
        patterns = self.bridge._value_to_bytes(1000, 'int32')
        expected = struct.pack('<i', 1000)
        self.assertIn(expected, patterns)
        
        # Test float conversion
        patterns = self.bridge._value_to_bytes(3.14, 'float')
        expected = struct.pack('<f', 3.14)
        self.assertIn(expected, patterns)
        
        # Test string conversion (multiple encodings)
        patterns = self.bridge._value_to_bytes("test", 'string')
        self.assertGreater(len(patterns), 1)  # Should have multiple encodings
        self.assertIn(b"test", patterns)
        
    def test_bytes_to_value_conversion(self):
        """Test conversion of bytes to typed values"""
        # Test int32
        data = struct.pack('<i', 1000)
        value = self.bridge._bytes_to_value(data, 'int32')
        self.assertEqual(value, 1000)
        
        # Test float
        data = struct.pack('<f', 3.14)
        value = self.bridge._bytes_to_value(data, 'float')
        self.assertAlmostEqual(value, 3.14, places=6)
        
        # Test with insufficient data
        value = self.bridge._bytes_to_value(b'\x01', 'int32')
        self.assertIsNone(value)
        
    def test_get_type_size(self):
        """Test data type size calculation"""
        self.assertEqual(self.bridge._get_type_size('int8'), 1)
        self.assertEqual(self.bridge._get_type_size('int16'), 2)
        self.assertEqual(self.bridge._get_type_size('int32'), 4)
        self.assertEqual(self.bridge._get_type_size('int64'), 8)
        self.assertEqual(self.bridge._get_type_size('float'), 4)
        self.assertEqual(self.bridge._get_type_size('double'), 8)
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    @patch.object(CheatEngineBridge, 'query_memory_info')
    @patch.object(CheatEngineBridge, '_is_memory_readable')
    def test_scan_memory_for_value(self, mock_readable, mock_query, mock_read):
        """Test memory scanning for specific values"""
        # Mock memory info
        mock_query.return_value = {
            'base_address': self.test_address,
            'region_size': 1024,
            'protect': 0x04  # PAGE_READWRITE
        }
        mock_readable.return_value = True
        mock_read.return_value = bytes(self.test_data)
        
        # Test scanning for int32 value
        results = self.bridge.scan_memory_for_value(self.test_handle, 1000, 'int32')
        
        # Should find the value at offset 0
        self.assertGreater(len(results), 0)
        self.assertIsInstance(results[0], MemoryScanResult)
        self.assertEqual(results[0].address, self.test_address)
        self.assertEqual(results[0].value, 1000)
        self.assertEqual(results[0].data_type, 'int32')
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    @patch.object(CheatEngineBridge, 'query_memory_info')
    @patch.object(CheatEngineBridge, '_is_memory_readable')
    def test_scan_memory_range(self, mock_readable, mock_query, mock_read):
        """Test memory scanning for value ranges"""
        mock_query.return_value = {
            'base_address': self.test_address,
            'region_size': 1024,
            'protect': 0x04
        }
        mock_readable.return_value = True
        mock_read.return_value = bytes(self.test_data)
        
        # Test range scan
        results = self.bridge.scan_memory_range(self.test_handle, 999, 1001, 'int32')
        
        # Should find value 1000 which is in range
        self.assertGreater(len(results), 0)
        found_values = [r.value for r in results]
        self.assertIn(1000, found_values)
        
    def test_wildcard_pattern_parsing(self):
        """Test wildcard pattern parsing and searching"""
        # Test pattern parsing
        pattern_string = "48 8B ? 48 ?? 05"
        test_data = bytes([0x48, 0x8B, 0x45, 0x48, 0x89, 0x05, 0x12, 0x34])
        
        # Parse pattern
        pattern_parts = pattern_string.upper().split()
        pattern_bytes = []
        mask = []
        
        for part in pattern_parts:
            if part == '?' or part == '??':
                pattern_bytes.append(0x00)
                mask.append(False)
            else:
                pattern_bytes.append(int(part, 16))
                mask.append(True)
        
        # Test wildcard search
        addresses = self.bridge._search_wildcard_pattern(test_data, bytes(pattern_bytes), mask, 0)
        self.assertGreater(len(addresses), 0)
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    @patch.object(CheatEngineBridge, 'query_memory_info')
    @patch.object(CheatEngineBridge, '_is_memory_readable')
    def test_find_pattern_with_wildcards(self, mock_readable, mock_query, mock_read):
        """Test wildcard pattern search in memory"""
        # Create test data with known pattern
        test_pattern_data = bytearray(1024)
        test_pattern_data[100:106] = bytes([0x48, 0x8B, 0x45, 0x48, 0x89, 0x05])
        
        mock_query.return_value = {
            'base_address': self.test_address,
            'region_size': 1024,
            'protect': 0x04
        }
        mock_readable.return_value = True
        mock_read.return_value = bytes(test_pattern_data)
        
        # Search for pattern with wildcards
        addresses = self.bridge.find_pattern_with_wildcards(
            self.test_handle, "48 8B ? 48 ?? 05"
        )
        
        # Should find the pattern at address + 100
        expected_address = self.test_address + 100
        self.assertIn(expected_address, addresses)


class TestDisassemblyFeatures(unittest.TestCase):
    """Test code disassembly functionality"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
        # Sample x64 instructions (MOV RAX, RBX; RET)
        self.test_code = bytes([0x48, 0x89, 0xD8, 0xC3])
        self.test_address = 0x140000000
        
    @patch('cheatengine.ce_bridge.CAPSTONE_AVAILABLE', True)
    @patch('cheatengine.ce_bridge.capstone')
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_disassemble_code_x64(self, mock_read, mock_capstone):
        """Test x64 code disassembly"""
        mock_read.return_value = self.test_code
        
        # Mock capstone disassembler
        mock_insn = Mock()
        mock_insn.address = self.test_address
        mock_insn.bytes = self.test_code[:3]
        mock_insn.mnemonic = "mov"
        mock_insn.op_str = "rax, rbx"
        mock_insn.size = 3
        mock_insn.groups = []
        
        mock_cs = Mock()
        mock_cs.disasm.return_value = [mock_insn]
        mock_capstone.Cs.return_value = mock_cs
        mock_capstone.CS_ARCH_X86 = 1
        mock_capstone.CS_MODE_64 = 2
        
        # Test disassembly
        results = self.bridge.disassemble_code(123, self.test_address, 64, 'x64')
        
        self.assertGreater(len(results), 0)
        self.assertIsInstance(results[0], DisassemblyResult)
        self.assertEqual(results[0].address, self.test_address)
        self.assertEqual(results[0].mnemonic, "mov")
        self.assertEqual(results[0].op_str, "rax, rbx")
        
    @patch('cheatengine.ce_bridge.CAPSTONE_AVAILABLE', False)
    def test_disassemble_code_no_capstone(self):
        """Test disassembly when Capstone is not available"""
        results = self.bridge.disassemble_code(123, self.test_address, 64, 'x64')
        self.assertEqual(len(results), 0)


class TestPointerAnalysis(unittest.TestCase):
    """Test pointer chain analysis functionality"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_resolve_pointer_chain(self, mock_read):
        """Test pointer chain resolution"""
        # Set up pointer chain: base -> pointer1 -> pointer2 -> final value
        base_address = 0x140000000
        pointer1_addr = 0x140001000
        pointer2_addr = 0x140002000
        final_addr = 0x140003000
        
        def mock_read_side_effect(handle, address, size):
            if address == base_address + 0x10:  # First offset
                return struct.pack('<Q', pointer1_addr)
            elif address == pointer1_addr + 0x20:  # Second offset
                return struct.pack('<Q', pointer2_addr)
            else:
                return None
                
        mock_read.side_effect = mock_read_side_effect
        
        # Test chain resolution
        offsets = [0x10, 0x20, 0x30]
        result = self.bridge.resolve_pointer_chain(123, base_address, offsets)
        
        expected = pointer2_addr + 0x30
        self.assertEqual(result, expected)
        
    @patch.object(CheatEngineBridge, 'get_detailed_memory_map')
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_find_pointer_chains_to_address(self, mock_read, mock_memory_map):
        """Test finding pointer chains to target address"""
        target_address = 0x140003000
        
        # Mock memory map
        mock_memory_map.return_value = [
            {
                'base_address': 0x140000000,
                'region_size': 0x1000,
                'readable': True,
                'executable': False
            }
        ]
        
        # Mock memory data containing pointer to target
        test_data = bytearray(0x1000)
        struct.pack_into('<Q', test_data, 0x100, target_address)
        mock_read.return_value = bytes(test_data)
        
        # Test finding chains
        chains = self.bridge.find_pointer_chains_to_address(
            123, target_address, max_depth=2, max_results=10
        )
        
        self.assertGreater(len(chains), 0)
        self.assertEqual(chains[0]['target_address'], target_address)
        self.assertEqual(chains[0]['depth'], 1)


class TestMemoryComparison(unittest.TestCase):
    """Test memory snapshot and comparison functionality"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_create_memory_snapshot(self, mock_read):
        """Test memory snapshot creation"""
        test_data = b"Test memory data for snapshot"
        mock_read.return_value = test_data
        
        snapshot = self.bridge.create_memory_snapshot(123, 0x140000000, len(test_data))
        
        self.assertEqual(snapshot, test_data)
        mock_read.assert_called_once_with(123, 0x140000000, len(test_data))
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_compare_memory_snapshots(self, mock_read):
        """Test memory snapshot comparison"""
        # Original data
        original_data = bytearray(b"Original memory data")
        
        # Modified data (change bytes at positions 5 and 10)
        modified_data = bytearray(original_data)
        modified_data[5] = 0xFF
        modified_data[10] = 0xAA
        
        mock_read.return_value = bytes(modified_data)
        
        # Compare snapshots
        comparison = self.bridge.compare_memory_snapshots(
            123, 0x140000000, len(original_data), bytes(original_data)
        )
        
        # Check results
        self.assertEqual(comparison['address'], 0x140000000)
        self.assertEqual(comparison['size'], len(original_data))
        self.assertGreater(len(comparison['changes']), 0)
        
        # Verify specific changes
        changes = comparison['changes']
        change_offsets = [c['offset'] for c in changes]
        self.assertIn(5, change_offsets)
        self.assertIn(10, change_offsets)
        
        # Check summary statistics
        summary = comparison['summary']
        self.assertEqual(summary['total_changes'], 2)
        self.assertGreater(summary['changed_bytes_percentage'], 0)
        
    @patch.object(CheatEngineBridge, 'scan_memory_for_value')
    @patch.object(CheatEngineBridge, '_read_typed_value')
    def test_search_for_changed_values(self, mock_read_value, mock_scan):
        """Test progressive value scanning"""
        # Mock previous results
        previous_results = [
            MemoryScanResult(
                address=0x140000000,
                value=100,
                data_type='int32',
                size=4
            ),
            MemoryScanResult(
                address=0x140000004,
                value=100,
                data_type='int32',
                size=4
            )
        ]
        
        # Mock current values (one changed, one unchanged)
        def mock_read_side_effect(handle, address, data_type):
            if address == 0x140000000:
                return 150  # Changed value
            elif address == 0x140000004:
                return 200  # Different value
            return None
            
        mock_read_value.side_effect = mock_read_side_effect
        
        # Test filtering
        results = self.bridge.search_for_changed_values(
            123, 100, 150, 'int32', previous_results
        )
        
        # Should only find the address where value changed to 150
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].address, 0x140000000)
        self.assertEqual(results[0].value, 150)


class TestDataStructureAnalysis(unittest.TestCase):
    """Test data structure analysis functionality"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_analyze_data_structures_with_pointers(self, mock_read):
        """Test data structure analysis with pointer detection"""
        # Create test data with pointers
        test_data = bytearray(256)
        
        # Add some pointers (assuming 64-bit)
        struct.pack_into('<Q', test_data, 0, 0x140000000)    # Valid pointer
        struct.pack_into('<Q', test_data, 8, 0x140001000)    # Valid pointer
        struct.pack_into('<Q', test_data, 16, 0x12345678)    # Valid pointer
        struct.pack_into('<Q', test_data, 24, 0x1000)        # Invalid (too small)
        
        # Mock pointed-to data
        def mock_read_side_effect(handle, address, size):
            if address == 0x140002000:  # Analysis target
                return bytes(test_data)
            elif address in [0x140000000, 0x140001000, 0x12345678]:
                return b"pointed_data_preview"
            return None
            
        mock_read.side_effect = mock_read_side_effect
        
        # Test analysis
        analysis = self.bridge.analyze_data_structures(123, 0x140002000, 256)
        
        # Check results
        self.assertEqual(analysis['address'], 0x140002000)
        self.assertEqual(analysis['size'], 256)
        self.assertGreater(len(analysis['pointers']), 0)
        
        # Should detect multiple valid pointers
        pointer_addresses = [p['address'] for p in analysis['pointers']]
        self.assertIn(0x140000000, pointer_addresses)
        self.assertIn(0x140001000, pointer_addresses)
        
        # Should suggest vtable type
        self.assertIn('vtable or function pointer array', analysis['potential_types'])
        
    @patch.object(CheatEngineBridge, 'read_process_memory')
    def test_analyze_data_structures_with_strings(self, mock_read):
        """Test data structure analysis with string detection"""
        # Create test data with strings
        test_data = bytearray(256)
        test_data[50:58] = b"TestStr\x00"  # Null-terminated string
        test_data[100:112] = b"AnotherTest\x00"
        
        mock_read.return_value = bytes(test_data)
        
        # Test analysis
        analysis = self.bridge.analyze_data_structures(123, 0x140000000, 256)
        
        # Should detect strings
        self.assertGreater(len(analysis['strings']), 0)
        string_values = [s['value'] for s in analysis['strings']]
        self.assertIn('TestStr', string_values)
        
        # Should suggest object with string members
        self.assertIn('object with string members', analysis['potential_types'])


class TestStringReferences(unittest.TestCase):
    """Test string reference detection functionality"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
    @patch.object(CheatEngineBridge, 'find_pattern_in_memory')
    @patch.object(CheatEngineBridge, 'query_memory_info')
    @patch.object(CheatEngineBridge, '_is_memory_executable')
    def test_find_string_references(self, mock_executable, mock_query, mock_find):
        """Test finding references to strings"""
        target_string = "TestString"
        string_address = 0x140001000
        reference_address = 0x140002000
        
        # Mock finding pattern in memory
        def mock_find_side_effect(handle, pattern, start_addr=0, end_addr=0x7FFFFFFF):
            # Check if this is a string pattern search
            try:
                if pattern == target_string.encode('utf-8'):
                    return [string_address]
                elif pattern == target_string.encode('utf-16le'):
                    return []
                elif pattern == target_string.encode('ascii'):
                    return []
                # Check if this is a pointer pattern search
                elif len(pattern) == 8:  # 64-bit pointer
                    pointer_value = struct.unpack('<Q', pattern)[0]
                    if pointer_value == string_address:
                        return [reference_address]
                return []
            except:
                return []
                
        mock_find.side_effect = mock_find_side_effect
        
        # Mock memory info for reference address
        mock_query.return_value = {
            'protect': 0x20  # PAGE_EXECUTE_READ
        }
        mock_executable.return_value = True
        
        # Test finding references
        references = self.bridge.find_string_references(123, target_string)
        
        # Should find reference
        self.assertGreater(len(references), 0)
        self.assertEqual(references[0]['reference_address'], reference_address)
        self.assertEqual(references[0]['string_address'], string_address)
        self.assertEqual(references[0]['string_value'], target_string)


class TestMemoryUtilities(unittest.TestCase):
    """Test memory utility functions"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        
    def test_memory_protection_checking(self):
        """Test memory protection flag checking"""
        # Test readable
        self.assertTrue(self.bridge._is_memory_readable(0x02))  # PAGE_READONLY
        self.assertTrue(self.bridge._is_memory_readable(0x04))  # PAGE_READWRITE
        self.assertFalse(self.bridge._is_memory_readable(0x01)) # PAGE_NOACCESS
        
        # Test writable
        self.assertTrue(self.bridge._is_memory_writable(0x04))  # PAGE_READWRITE
        self.assertFalse(self.bridge._is_memory_writable(0x02)) # PAGE_READONLY
        
        # Test executable
        self.assertTrue(self.bridge._is_memory_executable(0x20)) # PAGE_EXECUTE_READ
        self.assertFalse(self.bridge._is_memory_executable(0x04)) # PAGE_READWRITE
        
    def test_memory_protection_strings(self):
        """Test memory protection constant to string conversion"""
        # Test state conversion
        self.assertEqual(
            self.bridge._memory_state_to_string(0x1000), 
            "MEM_COMMIT"
        )
        self.assertEqual(
            self.bridge._memory_state_to_string(0x10000), 
            "MEM_FREE"
        )
        
        # Test protection conversion
        self.assertEqual(
            self.bridge._memory_protect_to_string(0x04), 
            "PAGE_READWRITE"
        )
        self.assertEqual(
            self.bridge._memory_protect_to_string(0x20), 
            "PAGE_EXECUTE_READ"
        )
        
        # Test type conversion
        self.assertEqual(
            self.bridge._memory_type_to_string(0x1000000), 
            "MEM_IMAGE"
        )


class TestDataTypes(unittest.TestCase):
    """Test data type handling and structures"""
    
    def test_memory_scan_result_structure(self):
        """Test MemoryScanResult data structure"""
        result = MemoryScanResult(
            address=0x140000000,
            value=1000,
            data_type='int32',
            size=4,
            region_info={'protect': 0x04}
        )
        
        self.assertEqual(result.address, 0x140000000)
        self.assertEqual(result.value, 1000)
        self.assertEqual(result.data_type, 'int32')
        self.assertEqual(result.size, 4)
        self.assertIsNotNone(result.region_info)
        
    def test_disassembly_result_structure(self):
        """Test DisassemblyResult data structure"""
        result = DisassemblyResult(
            address=0x140000000,
            bytes_data=b'\x48\x89\xd8',
            mnemonic='mov',
            op_str='rax, rbx',
            size=3,
            groups=['general']
        )
        
        self.assertEqual(result.address, 0x140000000)
        self.assertEqual(result.bytes_data, b'\x48\x89\xd8')
        self.assertEqual(result.mnemonic, 'mov')
        self.assertEqual(result.op_str, 'rax, rbx')
        self.assertEqual(result.size, 3)
        self.assertEqual(result.groups, ['general'])


if __name__ == '__main__':
    # Create test suite
    test_suite = unittest.TestSuite()
    
    # Add all test classes
    test_classes = [
        TestAdvancedMemoryScanning,
        TestDisassemblyFeatures,
        TestPointerAnalysis,
        TestMemoryComparison,
        TestDataStructureAnalysis,
        TestStringReferences,
        TestMemoryUtilities,
        TestDataTypes
    ]
    
    for test_class in test_classes:
        tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
        test_suite.addTests(tests)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    # Print summary
    print(f"\n{'='*50}")
    print(f"Tests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Success rate: {((result.testsRun - len(result.failures) - len(result.errors)) / result.testsRun * 100):.1f}%")
    print(f"{'='*50}")
