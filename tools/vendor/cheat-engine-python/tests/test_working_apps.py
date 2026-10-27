#!/usr/bin/env python3
"""
Find and test working applications for PyWinAuto
"""

import time
import pywinauto
from pywinauto import Application, Desktop
import os

def find_existing_apps():
    """Find existing applications that we can connect to"""
    print("=== Finding Existing Applications ===")
    
    try:
        desktop = Desktop(backend="win32")
        windows = desktop.windows()
        
        # Look for applications that are already running that we could test with
        interesting_apps = {}
        
        for window in windows:
            try:
                title = window.window_text()
                class_name = window.class_name()
                pid = window.process_id()
                
                # Look for interesting application windows
                if title.strip() and any(keyword in title.lower() for keyword in 
                    ['explorer', 'chrome', 'firefox', 'code', 'browser', 'edge', 'notepad']):
                    
                    if class_name not in interesting_apps:
                        interesting_apps[class_name] = []
                    
                    interesting_apps[class_name].append({
                        'title': title,
                        'pid': pid,
                        'window': window
                    })
                    
            except Exception as e:
                continue
        
        print("Found interesting applications:")
        for class_name, windows_list in interesting_apps.items():
            print(f"\n{class_name}:")
            for window_info in windows_list[:3]:  # Show first 3 of each type
                print(f"  - '{window_info['title']}' (PID: {window_info['pid']})")
        
        return interesting_apps
        
    except Exception as e:
        print(f"Error finding apps: {e}")
        return {}

def test_existing_app(window_info):
    """Test interacting with an existing application"""
    print(f"\n=== Testing Existing App: {window_info['title']} ===")
    
    try:
        window = window_info['window']
        pid = window_info['pid']
        
        print(f"1. Connecting to PID {pid}...")
        app = Application(backend="win32").connect(process=pid)
        
        print("2. Getting application windows...")
        app_windows = app.windows()
        print(f"Found {len(app_windows)} windows in application")
        
        for i, win in enumerate(app_windows):
            try:
                print(f"  Window {i}: '{win.window_text()}' [{win.class_name()}]")
            except Exception as e:
                print(f"  Window {i}: Error - {e}")
        
        print("3. Getting window hierarchy...")
        try:
            window.print_control_identifiers()
            print("✓ Successfully got control identifiers!")
        except Exception as e:
            print(f"Failed to get identifiers: {e}")
        
        return True
        
    except Exception as e:
        print(f"Failed to test existing app: {e}")
        return False

def test_simple_connection():
    """Test connecting to a very basic application"""
    print("\n=== Testing Simple File Explorer Connection ===")
    
    try:
        # Open file explorer
        import subprocess
        subprocess.Popen(["explorer.exe"])
        time.sleep(2)
        
        # Find file explorer windows
        desktop = Desktop(backend="win32")
        explorer_windows = [w for w in desktop.windows() if w.class_name() == "CabinetWClass"]
        
        if explorer_windows:
            window = explorer_windows[0]
            pid = window.process_id()
            
            print(f"Found File Explorer window: '{window.window_text()}' (PID: {pid})")
            
            # Connect to it
            app = Application(backend="win32").connect(process=pid)
            print(f"Connected to File Explorer process")
            
            app_windows = app.windows()
            print(f"Application has {len(app_windows)} windows")
            
            if app_windows:
                main_window = app_windows[0]
                print(f"Main window: '{main_window.window_text()}'")
                
                # Try to interact
                try:
                    main_window.set_focus()
                    print("✓ Successfully set focus!")
                    return True
                except Exception as e:
                    print(f"Failed to set focus: {e}")
            
        else:
            print("No File Explorer windows found")
            
    except Exception as e:
        print(f"File Explorer test failed: {e}")
    
    return False

if __name__ == "__main__":
    # Find existing applications
    apps = find_existing_apps()
    
    # Test with an existing application if available
    if apps:
        for class_name, windows_list in apps.items():
            if windows_list:
                success = test_existing_app(windows_list[0])
                if success:
                    break
    
    # Test simple connection
    test_simple_connection()
