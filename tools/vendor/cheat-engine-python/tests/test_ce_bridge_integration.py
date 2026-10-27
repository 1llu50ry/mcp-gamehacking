"""
Integration Tests for Advanced Cheat Engine Bridge Functionality

Focused integration tests that test the complete workflow of advanced features
with realistic mock data and scenarios.
"""

import unittest
import struct
import ctypes
import os
import sys
from unittest.mock import Mock, patch, MagicMock

# Import the module under test
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'server'))

from cheatengine.ce_bridge import CheatEngineBridge, MemoryScanResult, DisassemblyResult


class TestAdvancedFeaturesIntegration(unittest.TestCase):
    """Integration tests for advanced CE bridge features"""
    
    def setUp(self):
        """Set up integration test environment"""
        self.bridge = CheatEngineBridge()
        
        # Mock Windows API
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
        # Create realistic test memory data
        self.test_memory = self._create_test_memory()
        
        # Mock process handle
        self.test_handle = 0x1234
        
    def _create_test_memory(self):
        """Create realistic test memory with various data types"""
        memory = bytearray(8192)  # 8KB of test memory
        
        # Add integers at known locations
        struct.pack_into('<i', memory, 0x100, 1000)      # Player health
        struct.pack_into('<i', memory, 0x104, 500)       # Player mana
        struct.pack_into('<i', memory, 0x108, 999999)    # Player money
        
        # Add floats
        struct.pack_into('<f', memory, 0x200, 3.14159)   # Pi
        struct.pack_into('<f', memory, 0x204, 2.71828)   # E
        
        # Add strings
        memory[0x300:0x310] = b"PlayerName\x00\x00\x00\x00\x00"
        memory[0x320:0x330] = b"ItemSword\x00\x00\x00\x00\x00\x00"
        
        # Add pointer chain: 0x400 -> 0x500 -> 0x600 -> final value
        # Also add more pointers to trigger vtable detection
        if ctypes.sizeof(ctypes.c_void_p) == 8:  # 64-bit
            struct.pack_into('<Q', memory, 0x400, 0x140000500)  # Points to 0x500
            struct.pack_into('<Q', memory, 0x408, 0x140000600)  # Points to 0x600
            struct.pack_into('<Q', memory, 0x410, 0x140000700)  # Points to 0x700
            struct.pack_into('<Q', memory, 0x418, 0x140000800)  # Points to 0x800
            struct.pack_into('<Q', memory, 0x500, 0x140000600)  # Points to 0x600
            struct.pack_into('<i', memory, 0x600, 42)           # Final value
        else:  # 32-bit
            struct.pack_into('<I', memory, 0x400, 0x10000500)
            struct.pack_into('<I', memory, 0x404, 0x10000600)
            struct.pack_into('<I', memory, 0x408, 0x10000700)
            struct.pack_into('<I', memory, 0x40C, 0x10000800)
            struct.pack_into('<I', memory, 0x500, 0x10000600)
            struct.pack_into('<i', memory, 0x600, 42)
        
        # Add code pattern (common x64 function prologue)
        memory[0x700:0x710] = bytes([
            0x48, 0x89, 0x5C, 0x24, 0x08,  # mov [rsp+8], rbx
            0x48, 0x89, 0x6C, 0x24, 0x10,  # mov [rsp+10h], rbp
            0x48, 0x89, 0x74, 0x24, 0x18   # mov [rsp+18h], rsi
        ])
        
        return memory
    
    def _mock_memory_operations(self, base_address=0x140000000):
        """Set up mocks for memory operations"""
        def mock_read_memory(handle, address, size):
            if handle != self.test_handle:
                return None
            
            offset = address - base_address
            if offset < 0 or offset >= len(self.test_memory):
                return None
            
            end_offset = min(offset + size, len(self.test_memory))
            return bytes(self.test_memory[offset:end_offset])
        
        def mock_query_memory(handle, address):
            if handle != self.test_handle:
                return None
            
            return {
                'base_address': base_address,
                'region_size': len(self.test_memory),
                'state': 0x1000,    # MEM_COMMIT
                'protect': 0x04,    # PAGE_READWRITE
                'type': 0x20000     # MEM_PRIVATE
            }
        
        self.bridge.read_process_memory = Mock(side_effect=mock_read_memory)
        self.bridge.query_memory_info = Mock(side_effect=mock_query_memory)
        self.bridge._is_memory_readable = Mock(return_value=True)
        
        return base_address
    
    def test_complete_memory_scan_workflow(self):
        """Test complete memory scanning workflow"""
        base_address = self._mock_memory_operations()
        
        # Test 1: Scan for specific integer value
        results = self.bridge.scan_memory_for_value(self.test_handle, 1000, 'int32')
        
        self.assertGreater(len(results), 0)
        health_result = next((r for r in results if r.value == 1000), None)
        self.assertIsNotNone(health_result)
        self.assertEqual(health_result.address, base_address + 0x100)
        
        # Test 2: Range scan for values between 500-1000
        range_results = self.bridge.scan_memory_range(
            self.test_handle, 500, 1000, 'int32'
        )
        
        values_found = [r.value for r in range_results]
        self.assertIn(1000, values_found)  # Health
        self.assertIn(500, values_found)   # Mana
        
        # Test 3: String search
        string_results = self.bridge.scan_memory_for_value(
            self.test_handle, "PlayerName", 'string'
        )
        self.assertGreater(len(string_results), 0)
        
    def test_progressive_value_scanning(self):
        """Test progressive scanning (next scan functionality)"""
        base_address = self._mock_memory_operations()
        
        # Initial scan for value 1000
        initial_results = self.bridge.scan_memory_for_value(
            self.test_handle, 1000, 'int32'
        )
        self.assertGreater(len(initial_results), 0)
        
        # Simulate value change: health changes from 1000 to 950
        struct.pack_into('<i', self.test_memory, 0x100, 950)
        
        # Search for values that changed from 1000 to 950
        changed_results = self.bridge.search_for_changed_values(
            self.test_handle, 1000, 950, 'int32', initial_results
        )
        
        self.assertGreater(len(changed_results), 0)
        self.assertEqual(changed_results[0].value, 950)
        self.assertEqual(changed_results[0].address, base_address + 0x100)
        
    def test_pointer_chain_resolution(self):
        """Test pointer chain resolution"""
        base_address = self._mock_memory_operations()
        
        # Test resolving the pointer chain we set up
        if ctypes.sizeof(ctypes.c_void_p) == 8:  # 64-bit
            chain_base = base_address + 0x400
            offsets = [0x0, 0x0, 0x0]  # Follow pointers directly
            
            result = self.bridge.resolve_pointer_chain(
                self.test_handle, chain_base, offsets
            )
            
            # Should resolve to address containing value 42
            expected_final_address = base_address + 0x600
            self.assertEqual(result, expected_final_address)
            
            # Verify the value at the final address
            final_data = self.bridge.read_process_memory(self.test_handle, result, 4)
            final_value = struct.unpack('<i', final_data)[0]
            self.assertEqual(final_value, 42)
    
    def test_wildcard_pattern_search(self):
        """Test wildcard pattern searching"""
        base_address = self._mock_memory_operations()
        
        # Search for the function prologue pattern with wildcards
        # Looking for: mov [rsp+?], rbx; mov [rsp+?], rbp
        pattern = "48 89 5C 24 ?? 48 89 6C 24 ??"
        
        addresses = self.bridge.find_pattern_with_wildcards(
            self.test_handle, pattern
        )
        
        self.assertGreater(len(addresses), 0)
        expected_address = base_address + 0x700
        self.assertIn(expected_address, addresses)
        
    def test_memory_snapshot_and_comparison(self):
        """Test memory snapshot and change detection"""
        base_address = self._mock_memory_operations()
        
        # Create initial snapshot
        snapshot_address = base_address + 0x100
        snapshot_size = 16
        
        snapshot = self.bridge.create_memory_snapshot(
            self.test_handle, snapshot_address, snapshot_size
        )
        self.assertIsNotNone(snapshot)
        
        # Modify memory (change health from 1000 to 800)
        struct.pack_into('<i', self.test_memory, 0x100, 800)
        
        # Compare with snapshot
        comparison = self.bridge.compare_memory_snapshots(
            self.test_handle, snapshot_address, snapshot_size, snapshot
        )
        
        # Should detect changes
        self.assertGreater(len(comparison['changes']), 0)
        self.assertGreater(comparison['summary']['total_changes'], 0)
        
        # Verify specific change detected
        changes = comparison['changes']
        health_change = next((c for c in changes if c['offset'] == 0), None)
        self.assertIsNotNone(health_change)
        
    @patch('cheatengine.ce_bridge.CAPSTONE_AVAILABLE', True)
    @patch('cheatengine.ce_bridge.capstone')
    def test_code_disassembly_integration(self, mock_capstone):
        """Test code disassembly integration"""
        base_address = self._mock_memory_operations()
        
        # Mock capstone disassembler
        mock_insn1 = Mock()
        mock_insn1.address = base_address + 0x700
        mock_insn1.bytes = bytes([0x48, 0x89, 0x5C, 0x24, 0x08])
        mock_insn1.mnemonic = "mov"
        mock_insn1.op_str = "qword ptr [rsp + 8], rbx"
        mock_insn1.size = 5
        mock_insn1.groups = []
        
        mock_insn2 = Mock()
        mock_insn2.address = base_address + 0x705
        mock_insn2.bytes = bytes([0x48, 0x89, 0x6C, 0x24, 0x10])
        mock_insn2.mnemonic = "mov"
        mock_insn2.op_str = "qword ptr [rsp + 0x10], rbp"
        mock_insn2.size = 5
        mock_insn2.groups = []
        
        mock_cs = Mock()
        mock_cs.disasm.return_value = [mock_insn1, mock_insn2]
        mock_capstone.Cs.return_value = mock_cs
        mock_capstone.CS_ARCH_X86 = 1
        mock_capstone.CS_MODE_64 = 2
        
        # Test disassembly
        results = self.bridge.disassemble_code(
            self.test_handle, base_address + 0x700, 16, 'x64'
        )
        
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].mnemonic, "mov")
        self.assertEqual(results[1].mnemonic, "mov")
        self.assertEqual(results[0].address, base_address + 0x700)
        
    def test_data_structure_analysis_integration(self):
        """Test data structure analysis on realistic data"""
        base_address = self._mock_memory_operations()
        
        # Analyze the area with pointers (around 0x400)
        analysis = self.bridge.analyze_data_structures(
            self.test_handle, base_address + 0x400, 64
        )
        
        # Should detect pointers
        self.assertGreater(len(analysis['pointers']), 0)
        self.assertIn('vtable or function pointer array', analysis['potential_types'])
        
        # Analyze the area with strings (around 0x300)
        string_analysis = self.bridge.analyze_data_structures(
            self.test_handle, base_address + 0x300, 64
        )
        
        # Should detect strings
        self.assertGreater(len(string_analysis['strings']), 0)
        string_values = [s['value'] for s in string_analysis['strings']]
        self.assertTrue(any('Player' in s for s in string_values))
        
    def test_error_handling_and_edge_cases(self):
        """Test error handling and edge cases"""
        # Test with invalid handle
        results = self.bridge.scan_memory_for_value(0xFFFF, 1000, 'int32')
        self.assertEqual(len(results), 0)
        
        # Test with invalid data type
        patterns = self.bridge._value_to_bytes(1000, 'invalid_type')
        self.assertEqual(len(patterns), 0)
        
        # Test wildcard pattern with invalid hex
        addresses = self.bridge.find_pattern_with_wildcards(
            self.test_handle, "48 8B ZZ"  # Invalid hex
        )
        self.assertEqual(len(addresses), 0)
        
        # Test pointer chain with broken chain
        base_address = self._mock_memory_operations()
        
        # Corrupt the pointer chain
        struct.pack_into('<Q', self.test_memory, 0x400, 0x0)  # Null pointer
        
        result = self.bridge.resolve_pointer_chain(
            self.test_handle, base_address + 0x400, [0x0, 0x0, 0x0]
        )
        self.assertIsNone(result)


class TestPerformanceAndLimits(unittest.TestCase):
    """Test performance characteristics and result limiting"""
    
    def setUp(self):
        self.bridge = CheatEngineBridge()
        self.bridge.kernel32 = Mock()
        self.bridge.psapi = Mock()
        self.bridge.user32 = Mock()
        
    def test_result_limiting(self):
        """Test that result limiting works correctly"""
        # Create memory with many repeated values
        large_memory = bytearray(100000)  # 100KB
        
        # Fill with repeated pattern (value 1000 every 4 bytes)
        for i in range(0, len(large_memory) - 4, 4):
            struct.pack_into('<i', large_memory, i, 1000)
        
        def mock_read_memory(handle, address, size):
            return bytes(large_memory[:size])
        
        def mock_query_memory(handle, address):
            return {
                'base_address': 0x140000000,
                'region_size': len(large_memory),
                'state': 0x1000,
                'protect': 0x04,
                'type': 0x20000
            }
        
        self.bridge.read_process_memory = Mock(side_effect=mock_read_memory)
        self.bridge.query_memory_info = Mock(side_effect=mock_query_memory)
        self.bridge._is_memory_readable = Mock(return_value=True)
        
        # Scan for the repeated value
        results = self.bridge.scan_memory_for_value(123, 1000, 'int32')
        
        # Should be limited to prevent memory issues
        self.assertLessEqual(len(results), 10000)


if __name__ == '__main__':
    unittest.main(verbosity=2)
