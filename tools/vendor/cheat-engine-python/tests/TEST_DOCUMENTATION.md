# Advanced Cheat Engine Bridge Test Suite

This document describes the comprehensive test suite for the advanced Cheat Engine Bridge functionality.

## Test Files Overview

### 1. `test_ce_bridge_advanced.py`
**Purpose**: Unit tests for individual advanced features
**Coverage**: 
- Memory scanning (value-based, range-based, wildcard patterns)
- Code disassembly functionality
- Pointer chain analysis
- Memory comparison and snapshots
- Data structure analysis
- String reference detection
- Memory utility functions
- Data type handling

**Test Classes**:
- `TestAdvancedMemoryScanning`: Tests all memory scanning features
- `TestDisassemblyFeatures`: Tests code disassembly with Capstone
- `TestPointerAnalysis`: Tests pointer chain resolution and discovery
- `TestMemoryComparison`: Tests snapshot and comparison functionality
- `TestDataStructureAnalysis`: Tests automated structure detection
- `TestStringReferences`: Tests string reference finding
- `TestMemoryUtilities`: Tests utility functions
- `TestDataTypes`: Tests data structure definitions

### 2. `test_ce_bridge_integration.py`
**Purpose**: Integration tests simulating real-world usage
**Coverage**:
- Complete memory scanning workflows
- Progressive value scanning (next scan)
- Pointer chain resolution with realistic data
- Wildcard pattern searching in code
- Memory snapshot and change detection
- Code disassembly integration
- Data structure analysis on realistic data
- Error handling and edge cases
- Performance characteristics and limits

**Test Classes**:
- `TestAdvancedFeaturesIntegration`: End-to-end feature testing
- `TestPerformanceAndLimits`: Performance and scaling tests

### 3. `run_advanced_tests.py`
**Purpose**: Test runner with dependency checking and reporting
**Features**:
- Automatic test discovery
- Dependency verification
- Detailed test reporting
- Success rate calculation
- Failure/error summarization

## Test Coverage

### Memory Scanning Features ✅
- [x] Value-based scanning (all data types)
- [x] Range-based scanning  
- [x] Wildcard pattern search
- [x] Multi-encoding string search
- [x] Progressive scanning (next scan)
- [x] Result limiting and performance

### Code Analysis Features ✅
- [x] Code disassembly (x86/x64)
- [x] String reference detection
- [x] Pattern matching in code regions
- [x] Instruction analysis and grouping

### Pointer Analysis Features ✅
- [x] Pointer chain resolution
- [x] Reverse pointer chain discovery
- [x] Multi-level chain traversal
- [x] Broken chain handling

### Memory Management Features ✅
- [x] Memory snapshot creation
- [x] Snapshot comparison and diff
- [x] Change detection and statistics
- [x] Memory region analysis

### Data Structure Features ✅
- [x] Automated structure detection
- [x] Pointer identification
- [x] String extraction
- [x] Pattern recognition
- [x] Type suggestion

### Utility Functions ✅
- [x] Data type conversions
- [x] Memory protection checking
- [x] Error handling
- [x] Result data structures

## Running Tests

### Prerequisites
```bash
# Required dependencies (built-in)
- ctypes
- struct  
- unittest
- pathlib

# Optional dependencies (for full functionality)
pip install capstone  # For disassembly
pip install psutil    # For process information
pip install pywin32   # For Windows API extensions
```

### Running All Tests
```bash
# Method 1: Using the test runner
cd cheat-engine-server-python
python tests/run_advanced_tests.py

# Method 2: Using unittest directly
python -m unittest tests.test_ce_bridge_advanced -v
python -m unittest tests.test_ce_bridge_integration -v

# Method 3: Individual test classes
python -m unittest tests.test_ce_bridge_advanced.TestAdvancedMemoryScanning -v
```

### Test Configuration

The tests use comprehensive mocking to simulate:
- Windows API calls (kernel32, psapi)
- Process memory access
- Memory region information
- Cheat Engine installation detection

Test data includes:
- Various data types (integers, floats, strings)
- Pointer chains
- Code patterns (x64 function prologues)
- Memory protection scenarios
- Large datasets for performance testing

## Mock Strategy

### Memory Simulation
Tests create realistic memory layouts with:
- Player statistics (health, mana, money)
- String data (player names, item names)
- Pointer chains (multi-level indirection)
- Code sections (function prologues)
- Various data structures

### API Mocking
Windows API functions are mocked to:
- Return controlled test data
- Simulate different memory protection states
- Test error conditions
- Verify correct API usage

### Dependency Handling
Optional dependencies (Capstone, psutil) are conditionally mocked:
- Tests gracefully degrade when dependencies unavailable
- Capstone disassembly tests skip when engine not available
- Process information uses fallback implementations

## Expected Results

### Success Criteria
- All unit tests pass (100% success rate)
- Integration tests demonstrate real-world workflows
- Performance tests show reasonable scaling
- Error handling tests verify robust failure modes

### Performance Benchmarks
- Memory scanning: < 10,000 results per operation
- Pattern searching: 1MB chunks processed efficiently  
- Result limiting: Prevents memory exhaustion
- Snapshot comparison: Handles reasonable data sizes

### Error Handling
Tests verify proper handling of:
- Invalid process handles
- Corrupted memory regions
- Invalid data types
- Missing dependencies
- Memory access failures
- Broken pointer chains

## Test Data Scenarios

### Realistic Game Memory Layout
```
0x100: Player Health (int32) = 1000
0x104: Player Mana (int32) = 500  
0x108: Player Money (int32) = 999999
0x200: Position X (float) = 3.14159
0x204: Position Y (float) = 2.71828
0x300: Player Name (string) = "PlayerName"
0x320: Current Item (string) = "ItemSword"
0x400: Pointer Chain Base -> 0x500 -> 0x600 -> Value: 42
0x700: x64 Function Prologue (15 bytes)
```

### Test Scenarios
1. **Initial Scan**: Find all instances of health value (1000)
2. **Range Scan**: Find values between 500-1000 (health, mana)
3. **Next Scan**: Health changes 1000 → 950, filter results
4. **String Search**: Find references to "PlayerName"
5. **Pointer Resolution**: Follow chain to get final value (42)
6. **Pattern Search**: Find function prologues with wildcards
7. **Memory Comparison**: Detect changes after value modification
8. **Structure Analysis**: Identify pointers and strings in data

## Continuous Integration

The test suite is designed for:
- Automated CI/CD pipelines
- Windows-specific testing environments
- Dependency isolation
- Performance regression detection
- Code coverage analysis

## Extending Tests

### Adding New Test Cases
1. Create test methods in appropriate test class
2. Use realistic mock data
3. Test both success and failure scenarios
4. Include performance considerations
5. Document expected behavior

### Best Practices
- Mock Windows API calls consistently
- Use representative test data
- Test edge cases and error conditions
- Verify result limiting works
- Include integration scenarios
- Document test intent clearly

## Known Limitations

### Platform Dependencies
- Tests assume Windows environment
- Some mocking may not reflect exact API behavior
- 64-bit vs 32-bit pointer handling

### Mock Limitations  
- Simplified memory model
- Limited error condition simulation
- API timing not simulated

### Coverage Gaps
- Real process memory access not tested
- Actual Cheat Engine integration not tested
- Performance under memory pressure not simulated

The test suite provides comprehensive coverage of the advanced functionality while maintaining safety through extensive mocking and realistic test scenarios.
