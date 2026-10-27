#!/usr/bin/env python3
"""
Test different PyWinAuto backends and approaches
"""

import time
import pywinauto
from pywinauto import Application, Desktop

def test_backends():
    """Test different backends with notepad"""
    
    print("=== Testing Different Backends ===")
    
    backends = ["uia", "win32"]
    
    for backend in backends:
        print(f"\n--- Testing {backend.upper()} backend ---")
        
        try:
            print(f"1. Launching notepad with {backend} backend...")
            if backend == "uia":
                app = Application(backend="uia").start("notepad.exe")
            else:
                app = Application(backend="win32").start("notepad.exe")
            
            print(f"Process ID: {app.process}")
            
            # Wait longer
            print("2. Waiting 3 seconds...")
            time.sleep(3)
            
            print("3. Getting windows from app...")
            windows = app.windows()
            print(f"Found {len(windows)} windows in app")
            
            for i, window in enumerate(windows):
                try:
                    print(f"  Window {i}: '{window.window_text()}' [{window.class_name()}]")
                except Exception as e:
                    print(f"  Window {i}: Error - {e}")
            
            print("4. Using Desktop to find by process...")
            desktop = Desktop(backend=backend)
            try:
                process_windows = desktop.windows(process=app.process)
                print(f"Desktop found {len(process_windows)} windows for this process")
                
                for window in process_windows:
                    try:
                        print(f"  - '{window.window_text()}' [{window.class_name()}]")
                    except Exception as e:
                        print(f"  - Error: {e}")
                        
            except Exception as e:
                print(f"Desktop search failed: {e}")
            
            print("5. Trying to find notepad window manually...")
            try:
                # Try different approaches
                if backend == "win32":
                    window = app.window(class_name="Notepad")
                else:
                    window = app.window(title_re=".*Notepad.*")
                
                print(f"Found window: '{window.window_text()}' [{window.class_name()}]")
                
                # Try typing something
                print("6. Trying to type text...")
                if backend == "win32":
                    edit = window.Edit
                    edit.type_keys("Hello from PyWinAuto!")
                else:
                    window.type_keys("Hello from PyWinAuto!")
                
                print("✓ Successfully typed text!")
                
            except Exception as e:
                print(f"Manual window search failed: {e}")
            
            print("7. Closing application...")
            try:
                app.kill()
                print("✓ Application closed")
            except Exception as e:
                print(f"Error closing: {e}")
                
        except Exception as e:
            print(f"{backend} backend test failed: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_backends()
