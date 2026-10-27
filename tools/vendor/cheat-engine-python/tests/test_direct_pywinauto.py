#!/usr/bin/env python3
"""
Direct PyWinAuto test to understand the issue
"""

import time
import pywinauto
from pywinauto import Application, Desktop

def test_direct_pywinauto():
    """Test PyWinAuto directly without our wrapper"""
    
    print("=== Direct PyWinAuto Test ===")
    
    try:
        print("1. Launching notepad using pywinauto.Application.start()...")
        app = Application().start("notepad.exe")
        
        print(f"App object: {app}")
        print(f"Process ID: {app.process}")
        
        # Wait a moment
        time.sleep(2)
        
        print("2. Getting windows from app...")
        windows = app.windows()
        print(f"App.windows() returned: {len(windows)} windows")
        
        for i, window in enumerate(windows):
            try:
                print(f"  Window {i}: {window.window_text()} [{window.class_name()}]")
            except Exception as e:
                print(f"  Window {i}: Error getting info - {e}")
        
        print("3. Using Desktop to find windows...")
        desktop = Desktop(backend="uia")
        all_windows = desktop.windows()
        notepad_windows = [w for w in all_windows if "notepad" in w.window_text().lower()]
        
        print(f"Desktop found {len(notepad_windows)} notepad windows:")
        for window in notepad_windows:
            try:
                print(f"  - {window.window_text()} [PID: {window.process_id()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        print("4. Trying to connect to notepad by process...")
        try:
            app2 = Application().connect(process=app.process)
            print(f"Connected to process {app.process}")
            windows2 = app2.windows()
            print(f"Connected app has {len(windows2)} windows")
            
            for i, window in enumerate(windows2):
                try:
                    print(f"  Window {i}: {window.window_text()} [{window.class_name()}]")
                except Exception as e:
                    print(f"  Window {i}: Error - {e}")
                    
        except Exception as e:
            print(f"Failed to connect by process: {e}")
        
        print("5. Closing application...")
        try:
            app.kill()
            print("✓ Application closed")
        except Exception as e:
            print(f"Error closing: {e}")
            
    except Exception as e:
        print(f"Direct test failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_direct_pywinauto()
