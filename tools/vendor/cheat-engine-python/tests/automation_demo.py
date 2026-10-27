class ValidationResult:
    def __init__(self, success, message="", data=None):
        self.success = success
        self.message = message
        self.data = data if data is not None else {}

class WindowManager:
    def find_main_window(self, pid):
        return 12345  # Mock window handle
    
    def get_window_rect(self, hwnd):
        return (100, 100, 800, 600)  # Mock window rectangle
    
    def bring_to_foreground(self, hwnd):
        return True  # Mock bringing window to foreground

class SecurityValidator:
    def validate_application(self, app_name):
        safe_apps = ["notepad.exe", "calc.exe", "mspaint.exe", "calculator.exe"]
        if app_name in safe_apps:
            return ValidationResult(True, f"{app_name} is whitelisted")
        else:
            return ValidationResult(False, f"{app_name} is not whitelisted")

class ProcessInfo:
    def __init__(self, name, pid):
        self.name = name
        self.pid = pid
    
    def __str__(self):
        return f"{self.name} (PID: {self.pid})"

class AutomationOrchestrator:
    def __init__(self):
        self.processes = []
        self.active_sessions = {}
        self.security_validator = SecurityValidator()
        self.window_manager = WindowManager()
    
    def create_session(self, session_id):
        self.active_sessions[session_id] = {
            "created": True,
            "status": "active"
        }
        return True
    
    def get_processes(self):
        return [
            ProcessInfo("notepad.exe", 1234),
            ProcessInfo("calculator.exe", 5678)
        ]
    
    def find_text_in_memory(self, process_id, search_text):
        # Mock memory search returning ValidationResult
        found_data = [{"address": "0x12345678", "value": search_text}]
        return ValidationResult(
            success=True,
            message=f"Found {len(found_data)} matches for '{search_text}'",
            data={"matches": found_data, "search_text": search_text}
        )
    
    def send_keystrokes_to_process(self, process_id, keystrokes, delay=0.02):
        # Mock sending keystrokes to a process
        return ValidationResult(
            success=True, 
            message=f"Keystrokes sent to process {process_id}",
            data={"text_length": len(keystrokes), "delay": delay}
        )
    
    def bring_to_foreground(self, process_id):
        # Mock bringing window to foreground
        return ValidationResult(success=True, message=f"Process {process_id} brought to foreground")
