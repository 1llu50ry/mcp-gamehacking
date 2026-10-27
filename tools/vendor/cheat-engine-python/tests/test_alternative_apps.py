#!/usr/bin/env python3
"""
Test with calculator and different notepad approaches
"""

import time
import pywinauto
from pywinauto import Application, Desktop
import subprocess

def test_calculator():
    """Test with calculator"""
    print("=== Testing Calculator ===")
    
    try:
        print("1. Launching calculator...")
        app = Application(backend="uia").start("calc.exe")
        print(f"Process ID: {app.process}")
        
        time.sleep(3)
        
        print("2. Getting windows...")
        windows = app.windows()
        print(f"Found {len(windows)} windows")
        
        for window in windows:
            try:
                print(f"  - '{window.window_text()}' [{window.class_name()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        # Try manual search
        print("3. Manual calculator search...")
        try:
            calc_window = app.window(title_re=".*Calculator.*")
            print(f"Found calculator: '{calc_window.window_text()}'")
            
            # Try clicking buttons
            print("4. Trying to click buttons...")
            calc_window.print_control_identifiers()
            
        except Exception as e:
            print(f"Manual search failed: {e}")
        
        app.kill()
        
    except Exception as e:
        print(f"Calculator test failed: {e}")

def test_notepad_subprocess():
    """Test launching notepad with subprocess and then connecting"""
    print("\n=== Testing Notepad with Subprocess ===")
    
    try:
        print("1. Launching notepad with subprocess...")
        process = subprocess.Popen("notepad.exe")
        pid = process.pid
        print(f"Process ID: {pid}")
        
        time.sleep(3)
        
        print("2. Connecting to notepad process...")
        app = Application(backend="win32").connect(process=pid)
        
        windows = app.windows()
        print(f"Found {len(windows)} windows after connecting")
        
        for window in windows:
            try:
                print(f"  - '{window.window_text()}' [{window.class_name()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        print("3. Try finding by title from Desktop...")
        desktop = Desktop(backend="win32")
        notepad_windows = [w for w in desktop.windows() if "notepad" in w.window_text().lower()]
        
        print(f"Desktop found {len(notepad_windows)} notepad windows:")
        for window in notepad_windows:
            try:
                print(f"  - '{window.window_text()}' [PID: {window.process_id()}]")
                if window.process_id() == pid:
                    print(f"    ✓ This is our process!")
                    
                    # Try to interact with it
                    try:
                        window.type_keys("Hello from subprocess approach!")
                        print("    ✓ Successfully typed text!")
                    except Exception as e:
                        print(f"    Failed to type: {e}")
                        
            except Exception as e:
                print(f"  - Error: {e}")
        
        process.terminate()
        
    except Exception as e:
        print(f"Subprocess test failed: {e}")

if __name__ == "__main__":
    test_calculator()
    test_notepad_subprocess()
