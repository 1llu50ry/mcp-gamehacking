#!/usr/bin/env python3
"""
Test script for MCP Cheat Engine Server
"""

import sys
import os
import json
import subprocess
from pathlib import Path

# Add server directory to path
server_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'server')
sys.path.insert(0, server_path)

def test_imports():
    """Test importing required dependencies"""
    try:
        import mcp
        print("✅ MCP imported successfully")
    except ImportError as e:
        print(f"❌ MCP import failed: {e}")
        return False
        
    try:
        import trio
        print("✅ Trio imported successfully")
    except ImportError as e:
        print(f"❌ Trio import failed: {e}")
        return False
        
    try:
        import psutil
        print("✅ PSUtil imported successfully")
    except ImportError as e:
        print(f"❌ PSUtil import failed: {e}")
        return False
        
    try:
        import capstone
        print("✅ Capstone imported successfully")
    except ImportError as e:
        print(f"❌ Capstone import failed: {e}")
        return False
    
    return True

def test_server_modules():
    """Test importing server modules"""
    try:
        from process.manager import ProcessManager
        print("✅ ProcessManager imported")
    except ImportError as e:
        print(f"❌ ProcessManager import failed: {e}")
        return False
        
    # Note: Memory functionality removed - all memory searches now done via Cheat Engine
    print("✅ Memory functionality delegated to Cheat Engine")
        
    try:
        from config.whitelist import ProcessWhitelist
        print("✅ ProcessWhitelist imported")
    except ImportError as e:
        print(f"❌ ProcessWhitelist import failed: {e}")
        return False
    
    return True

def test_config_files():
    """Test configuration files"""
    # Test whitelist file
    try:
        with open('process_whitelist.json', 'r') as f:
            whitelist = json.load(f)
        print(f"✅ Whitelist loaded: {len(whitelist['entries'])} entries")
        
        # Check for notepad
        notepad_found = any(entry['process_name'] == 'notepad.exe' 
                           for entry in whitelist['entries'])
        if notepad_found:
            print("✅ Notepad.exe found in whitelist")
        else:
            print("⚠️  Notepad.exe not found in whitelist")
            
    except Exception as e:
        print(f"❌ Whitelist loading failed: {e}")
        return False
        
    return True

def test_processes():
    """Test process enumeration"""
    try:
        import psutil
        processes = list(psutil.process_iter(['pid', 'name']))
        print(f"✅ Process enumeration successful: {len(processes)} processes found")
        
        # Look for notepad
        notepad_processes = [p for p in processes if 'notepad' in p.info['name'].lower()]
        if notepad_processes:
            print(f"✅ Found {len(notepad_processes)} Notepad process(es)")
            for p in notepad_processes:
                print(f"   - PID {p.info['pid']}: {p.info['name']}")
        else:
            print("ℹ️  No Notepad processes found (start notepad.exe to test)")
            
    except Exception as e:
        print(f"❌ Process enumeration failed: {e}")
        return False
        
    return True

def main():
    """Run all tests"""
    print("🧪 MCP Cheat Engine Server - System Test")
    print("=" * 50)
    
    all_passed = True
    
    print("\n📦 Testing Dependencies...")
    if not test_imports():
        all_passed = False
    
    print("\n🔧 Testing Server Modules...")
    if not test_server_modules():
        all_passed = False
    
    print("\n📋 Testing Configuration...")
    if not test_config_files():
        all_passed = False
    
    print("\n🔍 Testing Process Access...")
    if not test_processes():
        all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("🎉 ALL TESTS PASSED! The system is ready to use.")
        print("\nNext steps:")
        print("1. Start the server: python server/main.py --debug")
        print("2. Use MCP tools through your AI assistant")
        print("3. Try attaching to notepad.exe for testing")
    else:
        print("❌ Some tests failed. Please check the errors above.")
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
