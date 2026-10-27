"""
Process Monitors Module
Handles process state monitoring and change detection
"""

import threading
import time
import psutil
import logging
from typing import Dict, List, Callable, Optional
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

@dataclass
class ProcessState:
    """Process state snapshot"""
    pid: int
    name: str
    status: str
    memory_usage: int
    cpu_percent: float
    num_threads: int
    timestamp: datetime

class ProcessMonitor:
    """Monitors process state changes"""
    
    def __init__(self):
        self.monitored_processes: Dict[int, ProcessState] = {}
        self.callbacks: List[Callable] = []
        self.monitoring = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.update_interval = 5.0  # seconds
    
    def add_process(self, pid: int):
        """Add a process to monitoring"""
        try:
            proc = psutil.Process(pid)
            state = ProcessState(
                pid=pid,
                name=proc.name(),
                status=proc.status(),
                memory_usage=proc.memory_info().rss,
                cpu_percent=proc.cpu_percent(),
                num_threads=proc.num_threads(),
                timestamp=datetime.now()
            )
            self.monitored_processes[pid] = state
            logger.info(f"Added process {pid} to monitoring")
            
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            logger.error(f"Cannot monitor process {pid}: {e}")
            raise
    
    def remove_process(self, pid: int):
        """Remove a process from monitoring"""
        if pid in self.monitored_processes:
            del self.monitored_processes[pid]
            logger.info(f"Removed process {pid} from monitoring")
    
    def add_callback(self, callback: Callable[[int, str, Dict], None]):
        """Add a callback for process state changes
        
        Callback signature: callback(pid, event_type, data)
        Event types: 'terminated', 'memory_change', 'status_change'
        """
        self.callbacks.append(callback)
    
    def start_monitoring(self):
        """Start the monitoring thread"""
        if self.monitoring:
            return
        
        self.monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("Process monitoring started")
    
    def stop_monitoring(self):
        """Stop the monitoring thread"""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=2.0)
        logger.info("Process monitoring stopped")
    
    def _monitor_loop(self):
        """Main monitoring loop"""
        while self.monitoring:
            try:
                self._check_processes()
                time.sleep(self.update_interval)
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(1.0)
    
    def _check_processes(self):
        """Check all monitored processes for changes"""
        for pid in list(self.monitored_processes.keys()):
            try:
                self._check_single_process(pid)
            except Exception as e:
                logger.error(f"Error checking process {pid}: {e}")
    
    def _check_single_process(self, pid: int):
        """Check a single process for changes"""
        old_state = self.monitored_processes[pid]
        
        try:
            proc = psutil.Process(pid)
            
            # Get current state
            current_state = ProcessState(
                pid=pid,
                name=proc.name(),
                status=proc.status(),
                memory_usage=proc.memory_info().rss,
                cpu_percent=proc.cpu_percent(),
                num_threads=proc.num_threads(),
                timestamp=datetime.now()
            )
            
            # Check for changes
            self._detect_changes(old_state, current_state)
            
            # Update stored state
            self.monitored_processes[pid] = current_state
            
        except psutil.NoSuchProcess:
            # Process terminated
            self._notify_callbacks(pid, 'terminated', {'last_state': old_state})
            self.remove_process(pid)
            
        except (psutil.AccessDenied, psutil.ZombieProcess) as e:
            logger.warning(f"Cannot access process {pid}: {e}")
    
    def _detect_changes(self, old_state: ProcessState, new_state: ProcessState):
        """Detect and report changes between states"""
        
        # Status change
        if old_state.status != new_state.status:
            self._notify_callbacks(
                new_state.pid, 
                'status_change', 
                {
                    'old_status': old_state.status,
                    'new_status': new_state.status
                }
            )
        
        # Significant memory change (>10MB or >10%)
        memory_diff = abs(new_state.memory_usage - old_state.memory_usage)
        memory_percent_change = memory_diff / old_state.memory_usage if old_state.memory_usage > 0 else 0
        
        if memory_diff > 10 * 1024 * 1024 or memory_percent_change > 0.1:
            self._notify_callbacks(
                new_state.pid,
                'memory_change',
                {
                    'old_memory': old_state.memory_usage,
                    'new_memory': new_state.memory_usage,
                    'change': memory_diff,
                    'percent_change': memory_percent_change
                }
            )
        
        # Thread count change
        if old_state.num_threads != new_state.num_threads:
            self._notify_callbacks(
                new_state.pid,
                'thread_change',
                {
                    'old_threads': old_state.num_threads,
                    'new_threads': new_state.num_threads
                }
            )
    
    def _notify_callbacks(self, pid: int, event_type: str, data: Dict):
        """Notify all callbacks of an event"""
        for callback in self.callbacks:
            try:
                callback(pid, event_type, data)
            except Exception as e:
                logger.error(f"Error in process monitor callback: {e}")
    
    def get_process_state(self, pid: int) -> Optional[ProcessState]:
        """Get current state of a monitored process"""
        return self.monitored_processes.get(pid)
    
    def get_all_states(self) -> Dict[int, ProcessState]:
        """Get all current process states"""
        return self.monitored_processes.copy()
    
    def set_update_interval(self, seconds: float):
        """Set the monitoring update interval"""
        if seconds > 0:
            self.update_interval = seconds
    
    def __del__(self):
        """Cleanup on destruction"""
        self.stop_monitoring()
