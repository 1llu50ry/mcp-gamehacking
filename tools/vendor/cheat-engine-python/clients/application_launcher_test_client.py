#!/usr/bin/env python3
"""
Application Launcher Test Client
Tests the new application launcher functionality
"""

import logging
import time
import asyncio
import sys
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ApplicationLauncherTestClient:
    """Test client for application launcher functionality"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            # Import MCP components for direct testing
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            
            self.whitelist = ProcessWhitelist()
            self.whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            self.launcher = ApplicationLauncher(self.whitelist)
            logger.info("✅ Application launcher test client initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_get_whitelisted_applications(self):
        """Test getting whitelisted applications"""
        logger.info("🔍 Testing: Get whitelisted applications")
        
        try:
            applications = self.launcher.get_whitelisted_applications()
            
            if not applications:
                logger.warning("⚠️ No whitelisted applications found")
                return False
            
            logger.info(f"✅ Found {len(applications)} whitelisted applications:")
            
            # Group by category
            categories = {}
            for app in applications:
                category = app['category']
                if category not in categories:
                    categories[category] = []
                categories[category].append(app)
            
            for category, apps in sorted(categories.items()):
                logger.info(f"  📁 {category.upper()}:")
                for app in apps:
                    status = "✅ Found" if app['executable_path'] else "⚠️ Not found"
                    logger.info(f"    • {app['process_name']} - {app['description']} ({status})")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error getting whitelisted applications: {e}")
            return False
    
    async def test_launch_calculator(self):
        """Test launching Calculator"""
        logger.info("🚀 Testing: Launch Calculator")
        
        try:
            success, message, pid = self.launcher.launch_application('calc.exe')
            
            if success:
                logger.info(f"✅ {message}")
                
                # Wait a moment for the application to fully start
                await asyncio.sleep(2)
                
                # Verify the application is running
                launched_apps = self.launcher.get_launched_applications()
                running_apps = [app for app in launched_apps if app['status'] == 'running']
                
                if running_apps:
                    logger.info(f"✅ Verified: {len(running_apps)} application(s) running")
                    return pid
                else:
                    logger.warning("⚠️ Application launched but not showing as running")
                    return pid
            else:
                logger.error(f"❌ {message}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error launching Calculator: {e}")
            return None
    
    async def test_get_launched_applications(self):
        """Test getting launched applications"""
        logger.info("📋 Testing: Get launched applications")
        
        try:
            applications = self.launcher.get_launched_applications()
            
            if not applications:
                logger.info("ℹ️ No applications launched in this session")
                return True
            
            logger.info(f"✅ Found {len(applications)} launched applications:")
            
            for app in applications:
                logger.info(f"  • PID {app['pid']}: {app['process_name']} ({app['status']})")
                logger.info(f"    Command: {' '.join(app['command_line'])}")
                logger.info(f"    Launch Time: {app['launch_time']}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error getting launched applications: {e}")
            return False
    
    async def test_get_application_info(self, pid: int):
        """Test getting application info"""
        logger.info(f"📊 Testing: Get application info for PID {pid}")
        
        try:
            app_info = self.launcher.get_application_by_pid(pid)
            
            if not app_info:
                logger.warning(f"⚠️ No information found for PID {pid}")
                return False
            
            logger.info(f"✅ Application info for PID {pid}:")
            logger.info(f"  Process Name: {app_info['process_name']}")
            logger.info(f"  Executable: {app_info['exe_path']}")
            logger.info(f"  Status: {app_info['status']}")
            logger.info(f"  Launch Time: {app_info['launch_time']}")
            logger.info(f"  Working Dir: {app_info['working_directory']}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error getting application info: {e}")
            return False
    
    async def test_terminate_application(self, pid: int):
        """Test terminating an application"""
        logger.info(f"🛑 Testing: Terminate application PID {pid}")
        
        try:
            success, message = self.launcher.terminate_application(pid, force=False)
            
            if success:
                logger.info(f"✅ {message}")
                
                # Wait a moment for termination
                await asyncio.sleep(2)
                
                # Verify the application is terminated
                app_info = self.launcher.get_application_by_pid(pid)
                if app_info and app_info['status'] == 'terminated':
                    logger.info("✅ Verified: Application status is 'terminated'")
                
                return True
            else:
                logger.error(f"❌ {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error terminating application: {e}")
            return False
    
    async def test_cleanup_terminated(self):
        """Test cleanup of terminated applications"""
        logger.info("🧹 Testing: Cleanup terminated applications")
        
        try:
            removed_count = self.launcher.cleanup_terminated_applications()
            
            if removed_count > 0:
                logger.info(f"✅ Cleaned up {removed_count} terminated application(s)")
            else:
                logger.info("ℹ️ No terminated applications to clean up")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error cleaning up applications: {e}")
            return False
    
    async def run_complete_test(self):
        """Run complete test suite"""
        try:
            logger.info("🤖 Starting Application Launcher Test Suite")
            logger.info("=" * 60)
            
            # Test 1: Get whitelisted applications
            test1_success = await self.test_get_whitelisted_applications()
            await asyncio.sleep(1)
            
            # Test 2: Launch Calculator
            calc_pid = await self.test_launch_calculator()
            await asyncio.sleep(1)
            
            # Test 3: Get launched applications
            test3_success = await self.test_get_launched_applications()
            await asyncio.sleep(1)
            
            # Test 4: Get application info (if we launched something)
            test4_success = True
            if calc_pid:
                test4_success = await self.test_get_application_info(calc_pid)
                await asyncio.sleep(1)
            
            # Test 5: Terminate application (if we launched something)
            test5_success = True
            if calc_pid:
                test5_success = await self.test_terminate_application(calc_pid)
                await asyncio.sleep(1)
            
            # Test 6: Cleanup terminated applications
            test6_success = await self.test_cleanup_terminated()
            
            # Summary
            logger.info("=" * 60)
            tests_passed = sum([test1_success, bool(calc_pid), test3_success, 
                              test4_success, test5_success, test6_success])
            total_tests = 6
            
            if tests_passed == total_tests:
                logger.info("🎉 All tests PASSED!")
            else:
                logger.warning(f"⚠️ {tests_passed}/{total_tests} tests passed")
            
            return tests_passed == total_tests
            
        except Exception as e:
            logger.error(f"💥 Test suite failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🧪 Application Launcher Test Client Starting")
        logger.info("=" * 50)
        
        # Initialize client
        client = ApplicationLauncherTestClient()
        
        # Run complete test
        success = await client.run_complete_test()
        
        if success:
            logger.info("🎉 All tests completed successfully!")
        else:
            logger.error("❌ Some tests failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
