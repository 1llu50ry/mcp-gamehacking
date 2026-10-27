# Tests

This folder contains all test files for the MCP Cheat Engine Server Python project.

## Test Structure

### Root Level Tests

- [`quick_test.py`](quick_test.py) - Quick validation tests
- [`test_accessibility.py`](test_accessibility.py) - Accessibility testing
- [`test_automation_integration.py`](test_automation_integration.py) - Automation integration tests
- [`test_direct_automation.py`](test_direct_automation.py) - Direct automation tests
- [`test_enhanced_automation.py`](test_enhanced_automation.py) - Enhanced automation tests
- [`test_final_validation.py`](test_final_validation.py) - Final validation tests
- [`test_server_integration.py`](test_server_integration.py) - Server integration tests
- [`test_system.py`](test_system.py) - System-level tests

### GUI Automation Tests

- [`gui_automation/`](gui_automation/) - GUI automation module tests
  - [`test_integration.py`](gui_automation/test_integration.py) - GUI automation integration tests
  - [`test_simple.py`](gui_automation/test_simple.py) - Simple GUI automation tests

## Running Tests

### Run All Tests

```bash
# From project root
python -m pytest tests/
```

### Run Specific Test Categories

```bash
# Quick tests
python tests/quick_test.py

# GUI automation tests
python -m pytest tests/gui_automation/

# System tests
python tests/test_system.py
```

### Run Individual Tests

```bash
# Specific test file
python tests/test_accessibility.py
```

## Test Environment

Make sure to have the virtual environment activated and all dependencies installed:

```bash
# Activate virtual environment
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Test Dependencies

The tests may require additional packages for comprehensive testing. Install test-specific dependencies if needed:

```bash
pip install pytest pytest-asyncio
```
