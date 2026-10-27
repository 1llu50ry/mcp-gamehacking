"""
Application Launcher Module
Handles execution and termination of whitelisted applications
"""

import os
import sys
import subprocess
import logging
import time
import json
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime

import psutil

# Import whitelist functionality
from config.whitelist import ProcessWhitelist

logger = logging.getLogger(__name__)

@dataclass
class LaunchedApplication:
    """Information about a launched application"""
    process_name: str
    pid: int
    exe_path: str
    launch_time: datetime
    command_line: List[str]
    working_directory: str
    status: str = "running"  # running, terminated, crashed
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'process_name': self.process_name,
            'pid': self.pid,
            'exe_path': self.exe_path,
            'launch_time': self.launch_time.isoformat(),
            'command_line': self.command_line,
            'working_directory': self.working_directory,
            'status': self.status
        }

class ApplicationLauncher:
    """Manages launching and termination of whitelisted applications"""
    
    def __init__(self, whitelist: ProcessWhitelist):
        self.whitelist = whitelist
        self.launched_applications: Dict[int, LaunchedApplication] = {}
        self._session_file = None
        
        # Common Windows application paths
        self.system_paths = [
            os.environ.get('WINDIR', 'C:\\Windows'),
            os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'System32'),
            os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'SysWOW64'),
            os.environ.get('PROGRAMFILES', 'C:\\Program Files'),
            os.environ.get('PROGRAMFILES(X86)', 'C:\\Program Files (x86)'),
        ]
        
        # Add common application directories
        self.common_app_paths = [
            os.path.join(os.environ.get('PROGRAMFILES', 'C:\\Program Files'), 'Windows NT', 'Accessories'),
            os.path.join(os.environ.get('PROGRAMFILES', 'C:\\Program Files'), 'Microsoft VS Code'),
            os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Microsoft VS Code'),
        ]
        
        logger.info("Application launcher initialized")
    
    def set_session_file(self, session_file_path: str):
        """Set the session file for persistence"""
        self._session_file = session_file_path
        self._load_session()
    
    def _load_session(self):
        """Load previously launched applications from session file"""
        if not self._session_file or not os.path.exists(self._session_file):
            return
        
        try:
            with open(self._session_file, 'r') as f:
                session_data = json.load(f)
            
            for app_data in session_data.get('launched_applications', []):
                try:
                    # Check if process is still running
                    pid = app_data['pid']
                    if psutil.pid_exists(pid):
                        app = LaunchedApplication(
                            process_name=app_data['process_name'],
                            pid=pid,
                            exe_path=app_data['exe_path'],
                            launch_time=datetime.fromisoformat(app_data['launch_time']),
                            command_line=app_data['command_line'],
                            working_directory=app_data['working_directory'],
                            status='running'
                        )
                        self.launched_applications[pid] = app
                        logger.info(f"Restored session for PID {pid}: {app.process_name}")
                    else:
                        logger.info(f"Process {pid} ({app_data['process_name']}) no longer running")
                except Exception as e:
                    logger.warning(f"Failed to restore session entry: {e}")
                    
        except Exception as e:
            logger.error(f"Failed to load session file: {e}")
    
    def _save_session(self):
        """Save current launched applications to session file"""
        if not self._session_file:
            return
        
        try:
            # Update status of all applications
            self._update_application_status()
            
            session_data = {
                'last_updated': datetime.now().isoformat(),
                'launched_applications': [app.to_dict() for app in self.launched_applications.values()]
            }
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(self._session_file), exist_ok=True)
            
            with open(self._session_file, 'w') as f:
                json.dump(session_data, f, indent=2)
                
        except Exception as e:
            logger.error(f"Failed to save session file: {e}")
    
    def find_executable(self, process_name: str) -> Optional[str]:
        """Find the full path to an executable"""
        
        # If it's already a full path and exists
        if os.path.isabs(process_name) and os.path.exists(process_name):
            return process_name
        
        # Try just the name in PATH
        try:
            result = subprocess.run(['where', process_name], 
                                  capture_output=True, text=True, shell=True)
            if result.returncode == 0:
                paths = result.stdout.strip().split('\n')
                if paths and paths[0].strip():
                    return paths[0].strip()
        except:
            pass
        
        # Search in common system paths
        for search_path in self.system_paths + self.common_app_paths:
            if os.path.exists(search_path):
                full_path = os.path.join(search_path, process_name)
                if os.path.exists(full_path):
                    return full_path
        
        # Search in PATH environment variable
        path_env = os.environ.get('PATH', '')
        for path_dir in path_env.split(os.pathsep):
            if os.path.exists(path_dir):
                full_path = os.path.join(path_dir, process_name)
                if os.path.exists(full_path):
                    return full_path
        
        return None
    
    def _find_running_process(self, process_name: str) -> Optional[int]:
        """Find a running process by name
        
        Args:
            process_name: Name of the process to find
            
        Returns:
            PID of the running process, or None if not found
        """
        try:
            # Remove .exe extension for comparison
            base_name = process_name.lower().replace('.exe', '')
            
            # Map common launcher names to actual app names
            app_mapping = {
                'calc': ['calculatorapp', 'calculator'],
                'notepad': ['notepad'],  # Notepad.exe vs notepad.exe
                'mspaint': ['paint', 'mspaint', 'paintdotnet'],
                'wordpad': ['wordpad'],
                'dbengine-x86_64': ['dbengine-x86_64', 'dbengine'],
            }
            
            # Get possible actual process names
            possible_names = [base_name]
            if base_name in app_mapping:
                possible_names.extend(app_mapping[base_name])
            
            for proc in psutil.process_iter(['pid', 'name', 'create_time']):
                try:
                    proc_name = proc.info['name'].lower().replace('.exe', '')
                    
                    # Check if this process matches any of our possible names
                    for possible_name in possible_names:
                        if (possible_name in proc_name or proc_name in possible_name):
                            pid = proc.info['pid']
                            
                            # Make sure it's not one we already launched
                            if pid not in self.launched_applications:
                                # Check if this is a recently created process (within last 10 seconds)
                                process_age = time.time() - proc.info['create_time']
                                if process_age <= 10:  # Recently created
                                    logger.info(f"Found recently created process: PID {pid} ({proc.info['name']}) for {process_name}")
                                    return pid
                                    
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
                    
        except Exception as e:
            logger.warning(f"Error finding running process {process_name}: {e}")
        
        return None
    
    def get_whitelisted_applications(self) -> List[Dict[str, Any]]:
        """Get list of all whitelisted applications"""
        if not self.whitelist.is_enabled():
            return []
        
        applications = []
        for entry in self.whitelist.entries:
            if entry.enabled:
                app_info = {
                    'process_name': entry.process_name,
                    'description': entry.description,
                    'category': entry.category,
                    'exact_match': entry.exact_match,
                    'executable_path': self.find_executable(entry.process_name) if entry.exact_match else None
                }
                applications.append(app_info)
        
        return applications
    
    def launch_application(self, process_name: str, arguments: Optional[List[str]] = None, 
                          working_directory: Optional[str] = None) -> Tuple[bool, str, Optional[int]]:
        """Launch a whitelisted application
        
        Args:
            process_name: Name of the process to launch
            arguments: Optional command line arguments
            working_directory: Optional working directory
            
        Returns:
            Tuple of (success, message, pid)
        """
        
        # Check if process is whitelisted
        # For whitelist checking, use just the filename (not full path)
        check_name = os.path.basename(process_name) if os.path.isabs(process_name) else process_name
        if self.whitelist.is_enabled() and not self.whitelist.is_allowed(check_name):
            return False, f"Process '{check_name}' is not whitelisted", None
        
        # Find executable
        exe_path = self.find_executable(process_name)
        if not exe_path:
            return False, f"Could not find executable for '{process_name}'", None
        
        try:
            # Prepare command line
            cmd_line = [exe_path]
            if arguments:
                cmd_line.extend(arguments)
            
            # Set working directory
            if not working_directory:
                # Use the directory containing the executable, or current directory as fallback
                if os.path.dirname(exe_path):
                    working_directory = os.path.dirname(exe_path)
                else:
                    working_directory = os.getcwd()
            
            logger.info(f"Launching application: {' '.join(cmd_line)}")
            logger.info(f"Working directory: {working_directory}")
            
            # Launch the process - use startupinfo to detach properly on Windows
            if sys.platform == 'win32':
                # Windows constants for subprocess
                SW_NORMAL = 1
                STARTF_USESHOWWINDOW = 1
                CREATE_NEW_PROCESS_GROUP = 0x00000200
                
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = SW_NORMAL
                
                try:
                    process = subprocess.Popen(
                        cmd_line,
                        cwd=working_directory,
                        startupinfo=startupinfo,
                        creationflags=CREATE_NEW_PROCESS_GROUP
                    )
                except OSError as e:
                    if e.winerror == 740:  # ERROR_ELEVATION_REQUIRED
                        # Try launching with elevated permissions using shell execute
                        logger.info(f"Application requires elevation, attempting elevated launch...")
                        import ctypes
                        try:
                            # Use ShellExecuteW with 'runas' verb for elevation
                            result = ctypes.windll.shell32.ShellExecuteW(
                                None, 
                                "runas",  # This triggers UAC prompt
                                exe_path,
                                " ".join(arguments) if arguments else None,
                                working_directory,
                                SW_NORMAL
                            )
                            
                            if result > 32:  # Success
                                # ShellExecute doesn't return a process object, so we need to find the process
                                logger.info("Elevated launch initiated, waiting for process to start...")
                                time.sleep(2)  # Give time for UAC and process startup
                                
                                # Try to find the process that was just launched
                                actual_pid = self._find_running_process(process_name)
                                if actual_pid:
                                    app = LaunchedApplication(
                                        process_name=process_name,
                                        pid=actual_pid,
                                        exe_path=exe_path,
                                        launch_time=datetime.now(),
                                        command_line=cmd_line,
                                        working_directory=working_directory,
                                        status='running'
                                    )
                                    
                                    self.launched_applications[actual_pid] = app
                                    self._save_session()
                                    
                                    logger.info(f"Successfully launched {process_name} with elevated privileges (PID: {actual_pid})")
                                    return True, f"Successfully launched {process_name} with elevated privileges (PID: {actual_pid})", actual_pid
                                else:
                                    # Process might still be starting or user cancelled UAC
                                    logger.warning("Elevated launch initiated but process not found yet (user may have cancelled UAC)")
                                    return False, "Elevated launch initiated but process not detected (UAC may have been cancelled)", None
                            else:
                                logger.error(f"ShellExecute failed with result: {result}")
                                return False, f"Failed to launch with elevation (error code: {result})", None
                                
                        except Exception as shell_error:
                            logger.error(f"Failed to launch with elevation: {shell_error}")
                            raise e  # Re-raise original error
                    else:
                        raise  # Re-raise if not elevation error
            else:
                process = subprocess.Popen(
                    cmd_line,
                    cwd=working_directory
                )
            
            # Wait a moment for the process to start
            time.sleep(0.5)
            
            # Check if process started successfully
            process_poll = process.poll()
            if process_poll is None:  
                # Process is still running - traditional application
                app = LaunchedApplication(
                    process_name=process_name,
                    pid=process.pid,
                    exe_path=exe_path,
                    launch_time=datetime.now(),
                    command_line=cmd_line,
                    working_directory=working_directory,
                    status='running'
                )
                
                self.launched_applications[process.pid] = app
                self._save_session()
                
                logger.info(f"Successfully launched {process_name} with PID {process.pid}")
                return True, f"Successfully launched {process_name} (PID: {process.pid})", process.pid
            elif process_poll == 0:
                # Process exited with code 0 (success) - likely a launcher that spawned the real app
                logger.info(f"Launcher process for {process_name} exited successfully (code 0)")
                
                # Wait a bit more for the actual application to start
                time.sleep(1.5)
                
                # Try to find the actual running process by name
                actual_pid = self._find_running_process(process_name)
                if actual_pid:
                    # Found the actual running process
                    app = LaunchedApplication(
                        process_name=process_name,
                        pid=actual_pid,
                        exe_path=exe_path,
                        launch_time=datetime.now(),
                        command_line=cmd_line,
                        working_directory=working_directory,
                        status='running'
                    )
                    
                    self.launched_applications[actual_pid] = app
                    self._save_session()
                    
                    logger.info(f"Successfully launched {process_name} with actual PID {actual_pid} (launcher PID {process.pid} exited)")
                    return True, f"Successfully launched {process_name} (PID: {actual_pid})", actual_pid
                else:
                    # Launcher succeeded but we can't find the running process
                    # This might be a UWP app or service - consider it successful anyway
                    logger.info(f"Launcher for {process_name} succeeded but actual process not found (may be UWP/service)")
                    
                    # Create a record with the launcher PID for tracking purposes
                    app = LaunchedApplication(
                        process_name=process_name,
                        pid=process.pid,
                        exe_path=exe_path,
                        launch_time=datetime.now(),
                        command_line=cmd_line,
                        working_directory=working_directory,
                        status='launched'  # Special status for launcher-spawned apps
                    )
                    
                    self.launched_applications[process.pid] = app
                    self._save_session()
                    
                    return True, f"Successfully launched {process_name} via launcher (launcher PID: {process.pid})", process.pid
            else:
                # Process terminated with non-zero exit code - actual failure
                stdout, stderr = process.communicate()
                error_msg = f"Process failed with exit code: {process_poll}"
                if stderr:
                    error_msg += f"\\nError: {stderr.decode('utf-8', errors='ignore')}"
                
                logger.error(f"Failed to launch {process_name}: {error_msg}")
                return False, error_msg, None
                
        except Exception as e:
            logger.error(f"Failed to launch {process_name}: {e}")
            return False, f"Failed to launch application: {str(e)}", None
    
    def terminate_application(self, pid: int, force: bool = False) -> Tuple[bool, str]:
        """Terminate a launched application
        
        Args:
            pid: Process ID to terminate
            force: Whether to force termination (kill vs terminate)
            
        Returns:
            Tuple of (success, message)
        """
        
        try:
            # Check if we launched this process
            if pid not in self.launched_applications:
                # Check if process exists anyway
                if not psutil.pid_exists(pid):
                    return False, f"Process {pid} does not exist"
                
                # Allow termination of any process if it exists
                logger.warning(f"Terminating process {pid} that was not launched by this session")
            
            # Get process object
            try:
                process = psutil.Process(pid)
                process_name = process.name()
            except psutil.NoSuchProcess:
                # Remove from our tracking if it's already gone
                if pid in self.launched_applications:
                    self.launched_applications[pid].status = 'terminated'
                    self._save_session()
                return True, f"Process {pid} was already terminated"
            
            logger.info(f"Terminating process {pid} ({process_name}), force={force}")
            
            if force:
                # Force kill the process
                process.kill()
                message = f"Force killed process {pid} ({process_name})"
            else:
                # Try graceful termination first
                process.terminate()
                
                # Wait for process to terminate gracefully
                try:
                    process.wait(timeout=5)  # Wait up to 5 seconds
                    message = f"Gracefully terminated process {pid} ({process_name})"
                except psutil.TimeoutExpired:
                    # Force kill if graceful termination failed
                    logger.warning(f"Graceful termination timeout, force killing {pid}")
                    process.kill()
                    message = f"Force killed process {pid} ({process_name}) after timeout"
            
            # Update our tracking
            if pid in self.launched_applications:
                self.launched_applications[pid].status = 'terminated'
                self._save_session()
            
            logger.info(message)
            return True, message
            
        except psutil.NoSuchProcess:
            if pid in self.launched_applications:
                self.launched_applications[pid].status = 'terminated'
                self._save_session()
            return True, f"Process {pid} was already terminated"
        except psutil.AccessDenied:
            return False, f"Access denied when trying to terminate process {pid}"
        except Exception as e:
            logger.error(f"Failed to terminate process {pid}: {e}")
            return False, f"Failed to terminate process: {str(e)}"
    
    def get_launched_applications(self) -> List[Dict[str, Any]]:
        """Get list of applications launched in this session"""
        self._update_application_status()
        return [app.to_dict() for app in self.launched_applications.values()]
    
    def get_application_by_pid(self, pid: int) -> Optional[Dict[str, Any]]:
        """Get information about a specific launched application"""
        if pid in self.launched_applications:
            self._update_application_status()
            return self.launched_applications[pid].to_dict()
        return None
    
    def _update_application_status(self):
        """Update the status of all tracked applications"""
        # Create a list of items to avoid dictionary modification during iteration
        items_to_update = list(self.launched_applications.items())
        
        for pid, app in items_to_update:
            # Check if this PID is still in our dictionary (might have been moved)
            if pid not in self.launched_applications:
                continue
                
            if app.status in ['running', 'launched']:
                if not psutil.pid_exists(pid):
                    # For apps where the original PID no longer exists, try to find the actual process
                    # This handles both launcher-spawned apps and apps that immediately spawn new processes
                    actual_pid = self._find_running_process(app.process_name)
                    if actual_pid and actual_pid != pid:
                        # Update to the actual running process
                        app.pid = actual_pid
                        app.status = 'running'
                        # Move the entry to the new PID
                        del self.launched_applications[pid]
                        self.launched_applications[actual_pid] = app
                        logger.info(f"Updated {app.process_name} from original PID {pid} to actual PID {actual_pid}")
                    else:
                        app.status = 'terminated'
                else:
                    try:
                        process = psutil.Process(pid)
                        if process.status() in [psutil.STATUS_ZOMBIE, psutil.STATUS_DEAD]:
                            app.status = 'terminated'
                        elif app.status == 'launched':
                            # Launcher process still exists, upgrade to running
                            app.status = 'running'
                    except psutil.NoSuchProcess:
                        app.status = 'terminated'
                    except Exception:
                        pass  # Keep current status if we can't determine
    
    def cleanup_terminated_applications(self) -> int:
        """Remove terminated applications from tracking
        
        Returns:
            Number of applications removed
        """
        self._update_application_status()
        
        terminated_pids = [pid for pid, app in self.launched_applications.items() 
                         if app.status == 'terminated']
        
        for pid in terminated_pids:
            del self.launched_applications[pid]
        
        if terminated_pids:
            self._save_session()
            logger.info(f"Cleaned up {len(terminated_pids)} terminated applications")
        
        return len(terminated_pids)
    
    def terminate_all_launched_applications(self, force: bool = False) -> Dict[str, Any]:
        """Terminate all applications launched in this session
        
        Args:
            force: Whether to force termination
            
        Returns:
            Dictionary with termination results
        """
        self._update_application_status()
        
        running_apps = [app for app in self.launched_applications.values() 
                       if app.status in ['running', 'launched']]
        
        if not running_apps:
            return {'terminated': 0, 'failed': 0, 'messages': ['No running applications to terminate']}
        
        results = {'terminated': 0, 'failed': 0, 'messages': []}
        
        for app in running_apps:
            success, message = self.terminate_application(app.pid, force)
            if success:
                results['terminated'] += 1
            else:
                results['failed'] += 1
            results['messages'].append(f"PID {app.pid} ({app.process_name}): {message}")
        
        logger.info(f"Bulk termination complete: {results['terminated']} terminated, {results['failed']} failed")
        return results
