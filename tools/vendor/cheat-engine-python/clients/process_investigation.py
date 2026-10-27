#!/usr/bin/env python3
"""
Process Investigation Script
Investigates what happens when we launch applications
"""

import logging
import time
import subprocess
import psutil
import sys
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def find_process_by_name(name):
    """Find all processes with a given name"""
    processes = []
    base_name = name.lower().replace('.exe', '')
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time']):
        try:
            proc_name = proc.info['name'].lower().replace('.exe', '')
            if base_name in proc_name or proc_name in base_name:
                processes.append({
                    'pid': proc.info['pid'],
                    'name': proc.info['name'],
                    'cmdline': proc.info['cmdline'],
                    'create_time': proc.info['create_time']
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    
    return processes

def test_calculator_launch():
    """Test launching calculator and see what happens"""
    logger.info("🧮 Testing Calculator Launch Behavior")
    logger.info("=" * 50)
    
    # Check existing calculator processes
    logger.info("📋 Existing calculator processes:")
    existing_procs = find_process_by_name('calc')
    for proc in existing_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    # Launch calculator
    logger.info("\\n🚀 Launching calculator...")
    calc_path = "C:\\Windows\\System32\\calc.exe"
    
    process = subprocess.Popen(
        [calc_path],
        cwd="C:\\Windows\\System32"
    )
    
    logger.info(f"📍 Launcher PID: {process.pid}")
    
    # Wait and check what happened
    time.sleep(1)
    
    poll_result = process.poll()
    logger.info(f"📊 Launcher process poll result: {poll_result}")
    
    # Find all calculator processes now
    logger.info("\\n📋 Calculator processes after launch:")
    new_procs = find_process_by_name('calc')
    for proc in new_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    # Find new processes
    new_pids = set(p['pid'] for p in new_procs) - set(p['pid'] for p in existing_procs)
    if new_pids:
        logger.info(f"\\n🎯 New calculator processes found: {list(new_pids)}")
    else:
        logger.info("\\n⚠️ No new calculator processes found")
    
    # Wait a bit more and check again
    logger.info("\\n⏳ Waiting 3 more seconds...")
    time.sleep(3)
    
    final_procs = find_process_by_name('calc')
    logger.info("\\n📋 Final calculator processes:")
    for proc in final_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    final_new_pids = set(p['pid'] for p in final_procs) - set(p['pid'] for p in existing_procs)
    if final_new_pids:
        logger.info(f"\\n✅ Final new calculator processes: {list(final_new_pids)}")
        
        # Try to terminate one of them
        for pid in final_new_pids:
            try:
                proc = psutil.Process(pid)
                logger.info(f"\\n🛑 Terminating calculator PID {pid}")
                proc.terminate()
                time.sleep(1)
                if not psutil.pid_exists(pid):
                    logger.info(f"✅ Successfully terminated PID {pid}")
                else:
                    logger.info(f"⚠️ PID {pid} still exists after terminate")
                break
            except Exception as e:
                logger.error(f"❌ Failed to terminate PID {pid}: {e}")
    else:
        logger.info("\\n❌ Still no new calculator processes found")

def test_notepad_launch():
    """Test launching notepad and see what happens"""
    logger.info("\\n\\n📝 Testing Notepad Launch Behavior")
    logger.info("=" * 50)
    
    # Check existing notepad processes
    logger.info("📋 Existing notepad processes:")
    existing_procs = find_process_by_name('notepad')
    for proc in existing_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    # Launch notepad
    logger.info("\\n🚀 Launching notepad...")
    notepad_path = "C:\\Windows\\System32\\notepad.exe"
    
    process = subprocess.Popen(
        [notepad_path],
        cwd="C:\\Windows\\System32"
    )
    
    logger.info(f"📍 Launcher PID: {process.pid}")
    
    # Wait and check what happened
    time.sleep(1)
    
    poll_result = process.poll()
    logger.info(f"📊 Launcher process poll result: {poll_result}")
    
    # Find all notepad processes now
    logger.info("\\n📋 Notepad processes after launch:")
    new_procs = find_process_by_name('notepad')
    for proc in new_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    # Find new processes
    new_pids = set(p['pid'] for p in new_procs) - set(p['pid'] for p in existing_procs)
    if new_pids:
        logger.info(f"\\n🎯 New notepad processes found: {list(new_pids)}")
    else:
        logger.info("\\n⚠️ No new notepad processes found")
    
    # Wait a bit more and check again
    logger.info("\\n⏳ Waiting 3 more seconds...")
    time.sleep(3)
    
    final_procs = find_process_by_name('notepad')
    logger.info("\\n📋 Final notepad processes:")
    for proc in final_procs:
        logger.info(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline']}")
    
    final_new_pids = set(p['pid'] for p in final_procs) - set(p['pid'] for p in existing_procs)
    if final_new_pids:
        logger.info(f"\\n✅ Final new notepad processes: {list(final_new_pids)}")
        
        # Try to terminate one of them
        for pid in final_new_pids:
            try:
                proc = psutil.Process(pid)
                logger.info(f"\\n🛑 Terminating notepad PID {pid}")
                proc.terminate()
                time.sleep(1)
                if not psutil.pid_exists(pid):
                    logger.info(f"✅ Successfully terminated PID {pid}")
                else:
                    logger.info(f"⚠️ PID {pid} still exists after terminate")
                break
            except Exception as e:
                logger.error(f"❌ Failed to terminate PID {pid}: {e}")
    else:
        logger.info("\\n❌ Still no new notepad processes found")

if __name__ == "__main__":
    test_calculator_launch()
    test_notepad_launch()
    logger.info("\\n🎉 Investigation complete!")
