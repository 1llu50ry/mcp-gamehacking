#!/usr/bin/env python3
"""
Test Runner for Advanced Cheat Engine Bridge Features

This script runs all tests for the new advanced functionality
and provides a summary of results.
"""

import sys
import os
import unittest
from io import StringIO

# Add the server directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

def run_tests():
    """Run all tests and return results"""
    
    # Discover and load tests
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Load our specific test modules
    try:
        import test_ce_bridge_advanced as advanced_module
        advanced_tests = loader.loadTestsFromModule(advanced_module)
        suite.addTests(advanced_tests)
        print("✓ Loaded advanced functionality tests")
    except ImportError as e:
        print(f"✗ Failed to load advanced tests: {e}")
    
    try:
        import test_ce_bridge_integration as integration_module
        integration_tests = loader.loadTestsFromModule(integration_module)
        suite.addTests(integration_tests)
        print("✓ Loaded integration tests")
    except ImportError as e:
        print(f"✗ Failed to load integration tests: {e}")
    
    if suite.countTestCases() == 0:
        print("No tests found!")
        return False
    
    print(f"\nRunning {suite.countTestCases()} tests...\n")
    
    # Run tests with detailed output
    stream = StringIO()
    runner = unittest.TextTestRunner(
        stream=stream,
        verbosity=2,
        buffer=True
    )
    
    # Also run with console output
    console_runner = unittest.TextTestRunner(verbosity=1)
    result = console_runner.run(suite)
    
    # Print summary
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")
    print(f"Tests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Skipped: {len(result.skipped) if hasattr(result, 'skipped') else 0}")
    
    if result.failures:
        print(f"\nFAILURES ({len(result.failures)}):")
        for test, traceback in result.failures:
            print(f"- {test}: {traceback.split('AssertionError:')[-1].strip()}")
    
    if result.errors:
        print(f"\nERRORS ({len(result.errors)}):")
        for test, traceback in result.errors:
            print(f"- {test}: {traceback.split('Exception:')[-1].strip()}")
    
    success_rate = (result.testsRun - len(result.failures) - len(result.errors)) / result.testsRun * 100
    print(f"\nSuccess rate: {success_rate:.1f}%")
    
    if success_rate == 100:
        print("🎉 All tests passed!")
    elif success_rate >= 90:
        print("✅ Most tests passed - good job!")
    elif success_rate >= 70:
        print("⚠️  Some tests failed - needs attention")
    else:
        print("❌ Many tests failed - requires investigation")
    
    print(f"{'='*60}")
    
    return result.wasSuccessful()

def check_dependencies():
    """Check if required dependencies are available"""
    print("Checking dependencies...")
    
    dependencies = {
        'ctypes': True,
        'struct': True,
        'unittest': True,
        'pathlib': True
    }
    
    optional_dependencies = {
        'capstone': False,
        'psutil': False,
        'win32api': False
    }
    
    # Check required dependencies
    for dep in dependencies:
        try:
            __import__(dep)
            print(f"✓ {dep}")
        except ImportError:
            print(f"✗ {dep} (REQUIRED)")
            dependencies[dep] = False
    
    # Check optional dependencies
    for dep in optional_dependencies:
        try:
            __import__(dep)
            print(f"✓ {dep} (optional)")
            optional_dependencies[dep] = True
        except ImportError:
            print(f"- {dep} (optional - not available)")
    
    missing_required = [dep for dep, available in dependencies.items() if not available]
    if missing_required:
        print(f"\n❌ Missing required dependencies: {missing_required}")
        return False
    
    print("\n✅ All required dependencies available")
    
    # Show optional dependency status
    available_optional = [dep for dep, available in optional_dependencies.items() if available]
    if available_optional:
        print(f"📦 Optional features available: {available_optional}")
    
    return True

def main():
    """Main test runner function"""
    print("Advanced Cheat Engine Bridge Test Runner")
    print("=" * 50)
    
    # Check dependencies first
    if not check_dependencies():
        print("\nPlease install missing dependencies before running tests.")
        return 1
    
    print()
    
    # Run tests
    try:
        success = run_tests()
        return 0 if success else 1
    except Exception as e:
        print(f"❌ Test runner error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
