#!/usr/bin/env python3
"""
Comprehensive Application Launcher Test Suite
Tests the core application launcher functionality that was recently implemented
"""

import sys
import os
import asyncio
import logging
import time

# Add server path for imports
project_root = os.path.dirname(os.path.dirname(__file__))
server_path = os.path.join(project_root, 'server')
sys.path.insert(0, server_path)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

class ApplicationLauncherTestSuite:
    """Comprehensive test suite for application launcher functionality"""
    
    def __init__(self):
        self.passed_tests = 0
        self.failed_tests = 0
        self.test_results = []
    
    def test_imports(self):
        """Test core module imports"""
        try:
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            from process.manager import ProcessManager
            
            self.log_success("✅ Core module imports")
            return True
        except ImportError as e:
            self.log_failure(f"❌ Import failed: {e}")
            return False
    
    def test_whitelist_functionality(self):
        """Test whitelist loading and validation"""
        try:
            from config.whitelist import ProcessWhitelist
            
            whitelist = ProcessWhitelist()
            whitelist_path = os.path.join(server_path, 'process_whitelist.json')
            whitelist.load_whitelist(whitelist_path)
            
            # Test basic whitelist functions
            assert whitelist.is_enabled(), "Whitelist should be enabled"
            assert whitelist.is_allowed('notepad.exe'), "Notepad should be allowed"
            assert whitelist.is_allowed('calc.exe'), "Calculator should be allowed"
            
            entries = whitelist.entries
            assert len(entries) > 0, "Should have whitelist entries"
            
            self.log_success(f"✅ Whitelist functionality ({len(entries)} entries)")
            return True
        except Exception as e:
            self.log_failure(f"❌ Whitelist test failed: {e}")
            return False
    
    def test_process_manager(self):
        """Test process manager functionality"""
        try:
            from process.manager import ProcessManager
            
            pm = ProcessManager()
            processes = pm.list_processes()
            
            assert len(processes) > 50, "Should find many processes"
            assert all('pid' in p and 'name' in p for p in processes), "Process entries should have pid and name"
            
            self.log_success(f"✅ Process manager ({len(processes)} processes)")
            return True
        except Exception as e:
            self.log_failure(f"❌ Process manager test failed: {e}")
            return False
    
    def test_application_launcher_init(self):
        """Test application launcher initialization"""
        try:
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            
            whitelist = ProcessWhitelist()
            whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            launcher = ApplicationLauncher(whitelist)
            
            # Test getting whitelisted applications
            apps = launcher.get_whitelisted_applications()
            assert len(apps) > 0, "Should have whitelisted applications"
            
            # Test finding executables
            notepad_path = launcher.find_executable('notepad.exe')
            assert notepad_path is not None, "Should find notepad.exe"
            assert os.path.exists(notepad_path), "Notepad path should exist"
            
            self.log_success(f"✅ Application launcher init ({len(apps)} whitelisted apps)")
            return True
        except Exception as e:
            self.log_failure(f"❌ Application launcher init failed: {e}")
            return False
    
    async def test_notepad_launch_and_terminate(self):
        """Test launching and terminating Notepad"""
        try:
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            
            whitelist = ProcessWhitelist()
            whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            launcher = ApplicationLauncher(whitelist)
            
            # Launch Notepad
            success, message, pid = launcher.launch_application('notepad.exe')
            assert success, f"Notepad launch should succeed: {message}"
            assert pid is not None, "Should get a PID"
            
            # Wait for launch
            await asyncio.sleep(2)
            
            # Check status
            launched_apps = launcher.get_launched_applications()
            notepad_apps = [app for app in launched_apps if 'notepad' in app['process_name'].lower()]
            assert len(notepad_apps) > 0, "Should find launched notepad"
            
            current_app = notepad_apps[0]
            assert current_app['status'] == 'running', f"Notepad should be running, got: {current_app['status']}"
            
            # Terminate
            term_success, term_message = launcher.terminate_application(current_app['pid'])
            assert term_success, f"Termination should succeed: {term_message}"
            
            # Wait for termination
            await asyncio.sleep(2)
            
            # Cleanup
            removed = launcher.cleanup_terminated_applications()
            
            self.log_success(f"✅ Notepad launch/terminate cycle (PID: {pid})")
            return True
        except Exception as e:
            self.log_failure(f"❌ Notepad launch/terminate test failed: {e}")
            return False
    
    async def test_calculator_launch_and_terminate(self):
        """Test launching and terminating Calculator (UWP app)"""
        try:
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            
            whitelist = ProcessWhitelist()
            whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            launcher = ApplicationLauncher(whitelist)
            
            # Launch Calculator
            success, message, pid = launcher.launch_application('calc.exe')
            assert success, f"Calculator launch should succeed: {message}"
            assert pid is not None, "Should get a PID"
            
            # Wait for launch and PID resolution
            await asyncio.sleep(3)
            
            # Check status
            launcher._update_application_status()
            launched_apps = launcher.get_launched_applications()
            calc_apps = [app for app in launched_apps if 'calc' in app['process_name'].lower()]
            assert len(calc_apps) > 0, "Should find launched calculator"
            
            current_app = calc_apps[0]
            assert current_app['status'] == 'running', f"Calculator should be running, got: {current_app['status']}"
            
            # Terminate
            term_success, term_message = launcher.terminate_application(current_app['pid'])
            assert term_success, f"Termination should succeed: {term_message}"
            
            # Wait for termination
            await asyncio.sleep(2)
            
            # Cleanup
            removed = launcher.cleanup_terminated_applications()
            
            self.log_success(f"✅ Calculator launch/terminate cycle (PID: {current_app['pid']})")
            return True
        except Exception as e:
            self.log_failure(f"❌ Calculator launch/terminate test failed: {e}")
            return False
    
    def test_session_persistence(self):
        """Test session file persistence"""
        try:
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            import tempfile
            
            whitelist = ProcessWhitelist()
            whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            launcher = ApplicationLauncher(whitelist)
            
            # Set up session file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                session_file = f.name
            
            launcher.set_session_file(session_file)
            
            # Test session operations
            try:
                launcher._save_session()
                assert os.path.exists(session_file), "Session file should be created"
                
                # Clean up
                os.unlink(session_file)
                
                self.log_success("✅ Session persistence")
                return True
            finally:
                if os.path.exists(session_file):
                    os.unlink(session_file)
        
        except Exception as e:
            self.log_failure(f"❌ Session persistence test failed: {e}")
            return False
    
    def log_success(self, message):
        """Log a successful test"""
        logger.info(message)
        self.passed_tests += 1
        self.test_results.append(("PASS", message))
    
    def log_failure(self, message):
        """Log a failed test"""
        logger.error(message)
        self.failed_tests += 1
        self.test_results.append(("FAIL", message))
    
    async def run_all_tests(self):
        """Run all tests"""
        logger.info("🧪 Application Launcher Test Suite")
        logger.info("=" * 60)
        
        # Core functionality tests
        self.test_imports()
        self.test_whitelist_functionality()
        self.test_process_manager()
        self.test_application_launcher_init()
        self.test_session_persistence()
        
        # Application launch tests
        await self.test_notepad_launch_and_terminate()
        await self.test_calculator_launch_and_terminate()
        
        # Print summary
        logger.info("")
        logger.info("=" * 60)
        logger.info("📊 TEST SUMMARY")
        logger.info("=" * 60)
        logger.info(f"✅ Passed: {self.passed_tests}")
        logger.info(f"❌ Failed: {self.failed_tests}")
        logger.info(f"📈 Success Rate: {self.passed_tests/(self.passed_tests + self.failed_tests)*100:.1f}%")
        
        if self.failed_tests == 0:
            logger.info("🎉 ALL TESTS PASSED!")
            return True
        else:
            logger.error(f"⚠️ {self.failed_tests} test(s) failed")
            return False

async def main():
    """Main test function"""
    test_suite = ApplicationLauncherTestSuite()
    success = await test_suite.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
