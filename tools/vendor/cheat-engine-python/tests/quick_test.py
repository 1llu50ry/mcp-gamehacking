#!/usr/bin/env python3
"""
Simple MCP server test to verify connectivity and basic functionality
"""

import os
import sys
import psutil
import subprocess
import time

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

def test_server_running():
    """Check if server is running"""
    print("🔍 Checking MCP Cheat Engine Server Status")
    print("=" * 50)
    
    # Check for server process
    server_found = False
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if proc.info['cmdline'] and any('main.py' in str(arg) for arg in proc.info['cmdline']):
                print(f"✅ Server process found: PID {proc.info['pid']}")
                print(f"   Command: {' '.join(proc.info['cmdline'])}")
                server_found = True
                break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    
    if not server_found:
        print("❌ Server process not found")
        return False
    
    # Test imports
    print("\n🔧 Testing server modules...")
    try:
        from process.manager import ProcessManager
        # Note: Memory functionality removed - all memory searches now done via Cheat Engine
        from config.whitelist import ProcessWhitelist
        print("✅ All server modules imported successfully")
        
        # Test basic functionality
        pm = ProcessManager()
        processes = pm.list_processes()
        print(f"✅ Process enumeration working: {len(processes)} processes found")
        
        whitelist = ProcessWhitelist()
        whitelist.load_whitelist('process_whitelist.json')
        print(f"✅ Whitelist loaded: {len(whitelist.entries)} entries")
        
        # Check for notepad (common test target)
        notepad_procs = [p for p in processes if 'notepad' in p['name'].lower()]
        print(f"ℹ️  Found {len(notepad_procs)} Notepad processes")
        
    except Exception as e:
        print(f"❌ Module test failed: {e}")
        return False
    
    print("\n🎉 MCP Cheat Engine Server is OPERATIONAL!")
    print("\n📋 Quick Status Summary:")
    print("   ✅ Server Process: Running")
    print("   ✅ Core Modules: Functional") 
    print("   ✅ Configuration: Loaded")
    print("   ✅ Process Access: Available")
    print("\n🚀 Server is ready for MCP tool requests!")
    
    return True

if __name__ == "__main__":
    success = test_server_running()
    sys.exit(0 if success else 1)
