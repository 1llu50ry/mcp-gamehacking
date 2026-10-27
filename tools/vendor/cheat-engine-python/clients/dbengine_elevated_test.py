#!/usr/bin/env python3
"""
DBEngine Elevated Application Test
Tests launching and terminating C:\\dbengine\\dbengine-x86_64.exe with UAC elevation
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

class DBEngineElevatedTest:
    """Test DBEngine application launch and termination with elevation"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            # Import required modules
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            
            # Initialize components
            self.whitelist = ProcessWhitelist()
            self.whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            self.launcher = ApplicationLauncher(self.whitelist)
            
            logger.info("✅ DBEngine elevated test initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_dbengine_elevated_launch_and_terminate(self):
        """Test launching and terminating DBEngine with elevation"""
        try:
            logger.info("🛠️ DBEngine Elevated Launch & Terminate Test")
            logger.info("=" * 60)
            
            # Check if dbengine is whitelisted
            logger.info("📋 Step 1: Checking whitelist...")
            whitelisted_apps = self.launcher.get_whitelisted_applications()
            dbengine_found = False
            
            for app in whitelisted_apps:
                if 'dbengine' in app['process_name'].lower():
                    logger.info(f"✅ Found in whitelist: {app['process_name']} - {app['description']}")
                    dbengine_found = True
                    break
            
            if not dbengine_found:
                logger.error("❌ DBEngine not found in whitelist")
                return False
            
            # Check if executable exists
            dbengine_path = "C:\\dbengine\\dbengine-x86_64.exe"
            if not os.path.exists(dbengine_path):
                logger.error(f"❌ DBEngine executable not found at: {dbengine_path}")
                return False
            
            logger.info(f"✅ DBEngine executable found at: {dbengine_path}")
            
            # Launch DBEngine
            logger.info("\\n🚀 Step 2: Launching DBEngine with elevation...")
            logger.info("⚠️  NOTE: User will need to approve UAC elevation prompt!")
            logger.info("⏳ Please click 'Yes' on the UAC prompt to continue...")
            
            success, message, pid = self.launcher.launch_application(dbengine_path)
            
            if success and pid:
                logger.info(f"✅ Launch result: {message}")
                logger.info(f"📍 PID: {pid}")
                
                # Wait for application to fully start
                logger.info("⏳ Waiting for application to fully initialize...")
                await asyncio.sleep(5)
                
                # Check application status
                logger.info("\\n📊 Step 3: Checking application status...")
                self.launcher._update_application_status()
                
                launched_apps = self.launcher.get_launched_applications()
                dbengine_apps = [app for app in launched_apps if 'dbengine' in app['process_name'].lower()]
                
                if dbengine_apps:
                    current_app = dbengine_apps[0]  # Get the first dbengine app
                    logger.info(f"📊 Status: PID {current_app['pid']} - {current_app['process_name']} ({current_app['status']})")
                    
                    if current_app['status'] == 'running':
                        logger.info("✅ DBEngine is running successfully with elevated privileges!")
                        
                        # Let it run for a moment
                        logger.info("⏳ Letting DBEngine run for a few seconds...")
                        await asyncio.sleep(3)
                        
                        # Terminate the application
                        logger.info(f"\\n🛑 Step 4: Terminating DBEngine PID {current_app['pid']}...")
                        term_success, term_message = self.launcher.terminate_application(current_app['pid'])
                        
                        if term_success:
                            logger.info(f"✅ Termination result: {term_message}")
                            
                            # Wait for termination to complete
                            await asyncio.sleep(3)
                            
                            # Verify termination
                            logger.info("\\n🔍 Step 5: Verifying termination...")
                            self.launcher._update_application_status()
                            
                            final_apps = self.launcher.get_launched_applications()
                            dbengine_final = [app for app in final_apps if 'dbengine' in app['process_name'].lower()]
                            
                            if dbengine_final:
                                final_app = dbengine_final[0]
                                logger.info(f"📊 Final status: PID {final_app['pid']} - {final_app['process_name']} ({final_app['status']})")
                                
                                if final_app['status'] == 'terminated':
                                    logger.info("✅ DBEngine successfully terminated!")
                                else:
                                    logger.warning(f"⚠️ DBEngine status: {final_app['status']} (expected: terminated)")
                            
                            # Cleanup
                            removed = self.launcher.cleanup_terminated_applications()
                            logger.info(f"🧹 Cleaned up {removed} terminated applications")
                            
                            return True
                        else:
                            logger.error(f"❌ Termination failed: {term_message}")
                            # Try force termination
                            logger.info("🔄 Attempting force termination...")
                            force_success, force_message = self.launcher.terminate_application(current_app['pid'], force=True)
                            if force_success:
                                logger.info(f"✅ Force termination: {force_message}")
                                return True
                            else:
                                logger.error(f"❌ Force termination failed: {force_message}")
                                return False
                    else:
                        logger.error(f"❌ DBEngine status: {current_app['status']} (expected: running)")
                        return False
                else:
                    logger.error("❌ No DBEngine applications found in launched apps")
                    return False
                
            elif success and not pid:
                # Elevation was initiated but process not detected yet
                logger.info("⏳ Elevation prompt was shown, checking for process...")
                
                # Give more time for user to respond to UAC and process to start
                for i in range(10):  # Check for 10 seconds
                    await asyncio.sleep(1)
                    logger.info(f"⏳ Checking for DBEngine process... ({i+1}/10)")
                    
                    # Try to find the process
                    actual_pid = self.launcher._find_running_process("dbengine-x86_64.exe")
                    if actual_pid:
                        logger.info(f"✅ Found DBEngine process with PID: {actual_pid}")
                        
                        # Add it to our tracking
                        from process.launcher import LaunchedApplication
                        from datetime import datetime
                        
                        app = LaunchedApplication(
                            process_name="C:\\dbengine\\dbengine-x86_64.exe",
                            pid=actual_pid,
                            exe_path=dbengine_path,
                            launch_time=datetime.now(),
                            command_line=[dbengine_path],
                            working_directory="C:\\dbengine",
                            status='running'
                        )
                        
                        self.launcher.launched_applications[actual_pid] = app
                        self.launcher._save_session()
                        
                        # Now proceed with termination test
                        logger.info(f"\\n🛑 Step 3: Terminating DBEngine PID {actual_pid}...")
                        term_success, term_message = self.launcher.terminate_application(actual_pid)
                        
                        if term_success:
                            logger.info(f"✅ {term_message}")
                            await asyncio.sleep(2)
                            removed = self.launcher.cleanup_terminated_applications()
                            logger.info(f"🧹 Cleaned up {removed} terminated applications")
                            return True
                        else:
                            logger.error(f"❌ Termination failed: {term_message}")
                            return False
                
                logger.warning("⚠️ Process not found - user may have cancelled UAC prompt")
                return False
                
            else:
                logger.error(f"❌ Launch failed: {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ DBEngine elevated test failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return False

async def main():
    """Main function"""
    try:
        logger.info("🔬 DBEngine Elevated Application Test Starting")
        logger.info("=" * 50)
        logger.info("⚠️  IMPORTANT: This test requires UAC elevation approval")
        logger.info("⚠️  Please click 'Yes' when the UAC prompt appears")
        logger.info("=" * 50)
        
        # Initialize test
        test = DBEngineElevatedTest()
        
        # Run test
        success = await test.test_dbengine_elevated_launch_and_terminate()
        
        if success:
            logger.info("\\n🎉 DBEngine elevated test completed successfully!")
            logger.info("✅ Successfully launched and terminated dbengine-x86_64.exe with elevation")
        else:
            logger.error("\\n❌ DBEngine elevated test failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
