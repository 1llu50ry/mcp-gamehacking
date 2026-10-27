#!/usr/bin/env python3
"""
Debug test for PyWinAuto launch and window discovery
"""

import sys
import os
import time
import asyncio

# Add server directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

async def debug_notepad_launch():
    """Debug notepad launch and window discovery"""
    
    try:
        from window_automation.tools.mcp_tools import PyWinAutoToolHandler
        handler = PyWinAutoToolHandler()
        
        print("=== Debugging Notepad Launch ===")
        
        # Launch notepad
        print("1. Launching notepad...")
        result = await handler.handle_launch_application({
            "path": "notepad.exe",
            "timeout": 10
        })
        
        if not result["success"]:
            print(f"Failed to launch: {result['error']}")
            return
        
        app_info = result['data']['application']
        process_id = app_info['process_id']
        print(f"Launched PID: {process_id}")
        print(f"Initial windows: {len(app_info['windows'])}")
        
        # Wait a bit and try to find windows
        for delay in [1, 2, 3, 5]:
            print(f"\n2. Waiting {delay} seconds, then finding windows...")
            time.sleep(delay)
            
            # Try finding by title
            result = await handler.handle_find_windows({
                "title": "*Notepad*"
            })
            
            if result["success"]:
                print(f"Found {result['data']['count']} windows by title")
                for window in result['data']['windows']:
                    print(f"  - {window['title']} [PID: {window.get('process_id', 'N/A')}]")
            
            # Try finding by process ID
            result = await handler.handle_find_windows({
                "process_id": process_id
            })
            
            if result["success"]:
                print(f"Found {result['data']['count']} windows by PID")
                for window in result['data']['windows']:
                    print(f"  - {window['title']} [Class: {window['class_name']}]")
            
            if result["success"] and result['data']['count'] > 0:
                print("✓ Windows found! Breaking out of wait loop.")
                break
        
        # Try to close
        print(f"\n3. Closing application...")
        result = await handler.handle_close_application({
            "process_id": process_id
        })
        
        if result["success"]:
            print("✓ Application closed successfully")
        else:
            print(f"Failed to close: {result['error']}")
            
    except Exception as e:
        print(f"Debug test failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(debug_notepad_launch())
