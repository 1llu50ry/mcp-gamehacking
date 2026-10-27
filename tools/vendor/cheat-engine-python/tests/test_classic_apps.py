#!/usr/bin/env python3
"""
Test with classic Windows applications that should work with PyWinAuto
"""

import time
import pywinauto
from pywinauto import Application, Desktop
import os

def test_desktop_discovery():
    """Just test desktop window discovery"""
    print("=== Testing Desktop Window Discovery ===")
    
    try:
        desktop = Desktop(backend="win32")
        windows = desktop.windows()
        print(f"Desktop found {len(windows)} total windows")
        
        # Show some interesting windows
        print("\nVisible windows with titles:")
        for window in windows[:20]:  # Show first 20
            try:
                title = window.window_text()
                if title.strip():  # Only show windows with titles
                    print(f"  - '{title}' [{window.class_name()}] PID: {window.process_id()}")
            except Exception as e:
                print(f"  - Error getting window info: {e}")
        
        print(f"\n... and {max(0, len(windows)-20)} more windows")
        
    except Exception as e:
        print(f"Desktop discovery failed: {e}")

def test_mspaint():
    """Test with MS Paint which should be more compatible"""
    print("\n=== Testing MS Paint ===")
    
    try:
        print("1. Launching MS Paint...")
        app = Application(backend="win32").start("mspaint.exe")
        print(f"Process ID: {app.process}")
        
        time.sleep(4)  # Give more time
        
        print("2. Getting windows...")
        windows = app.windows()
        print(f"Found {len(windows)} windows")
        
        for window in windows:
            try:
                print(f"  - '{window.window_text()}' [{window.class_name()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        # Try desktop search for paint
        print("3. Desktop search for Paint...")
        desktop = Desktop(backend="win32")
        paint_windows = [w for w in desktop.windows() if "paint" in w.window_text().lower()]
        
        print(f"Found {len(paint_windows)} paint windows on desktop:")
        for window in paint_windows:
            try:
                print(f"  - '{window.window_text()}' [PID: {window.process_id()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        app.kill()
        
    except Exception as e:
        print(f"MS Paint test failed: {e}")

def test_cmd():
    """Test with command prompt"""
    print("\n=== Testing Command Prompt ===")
    
    try:
        print("1. Launching cmd...")
        app = Application(backend="win32").start("cmd.exe")
        print(f"Process ID: {app.process}")
        
        time.sleep(2)
        
        print("2. Getting windows...")
        windows = app.windows()
        print(f"Found {len(windows)} windows")
        
        for window in windows:
            try:
                print(f"  - '{window.window_text()}' [{window.class_name()}]")
            except Exception as e:
                print(f"  - Error: {e}")
        
        # Try finding cmd windows on desktop
        print("3. Desktop search for cmd...")
        desktop = Desktop(backend="win32")
        cmd_windows = [w for w in desktop.windows() if "cmd" in w.window_text().lower() or w.class_name() == "ConsoleWindowClass"]
        
        print(f"Found {len(cmd_windows)} cmd windows on desktop:")
        for window in cmd_windows:
            try:
                print(f"  - '{window.window_text()}' [{window.class_name()}] PID: {window.process_id()}")
                
                if window.process_id() == app.process:
                    print("    ✓ This is our process! Trying to interact...")
                    try:
                        window.type_keys("echo Hello from PyWinAuto!{ENTER}")
                        print("    ✓ Successfully sent keys!")
                    except Exception as e:
                        print(f"    Failed to send keys: {e}")
                        
            except Exception as e:
                print(f"  - Error: {e}")
        
        app.kill()
        
    except Exception as e:
        print(f"Command prompt test failed: {e}")

if __name__ == "__main__":
    test_desktop_discovery()
    test_mspaint()
    test_cmd()
