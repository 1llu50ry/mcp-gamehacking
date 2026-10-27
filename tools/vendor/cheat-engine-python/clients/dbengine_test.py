#!/usr/bin/env python3
"""
DBEngine Application Test
Tests launching and terminating C:\dbengine\dbengine-x86_64.exe
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

class DBEngineTest:
    """Test DBEngine application launch and termination"""
    
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
            
            logger.info("✅ DBEngine test initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_dbengine_launch_and_terminate(self):
        """Test launching and terminating DBEngine"""
        try:
            logger.info("🛠️ DBEngine Launch & Terminate Test")
            logger.info("=" * 50)
            
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
            
            # Launch DBEngine
            logger.info("\\n🚀 Step 2: Launching DBEngine...")
            logger.info("Path: C:\\dbengine\\dbengine-x86_64.exe")
            
            success, message, pid = self.launcher.launch_application('C:\\dbengine\\dbengine-x86_64.exe')
            
            if success:
                logger.info(f"✅ Launch result: {message}")
                logger.info(f"📍 PID: {pid}")
                
                # Wait for application to fully start
                logger.info("⏳ Waiting for application to start...")
                await asyncio.sleep(3)
                
                # Check application status
                logger.info("\\n📊 Step 3: Checking application status...")
                self.launcher._update_application_status()
                
                launched_apps = self.launcher.get_launched_applications()
                dbengine_apps = [app for app in launched_apps if 'dbengine' in app['process_name'].lower()]
                
                if dbengine_apps:
                    current_app = dbengine_apps[0]  # Get the first (should be only) dbengine app
                    logger.info(f"📊 Status: PID {current_app['pid']} - {current_app['process_name']} ({current_app['status']})")
                    
                    if current_app['status'] == 'running':
                        logger.info("✅ DBEngine is running successfully!")
                        
                        # Wait a bit more to let it fully initialize
                        logger.info("⏳ Letting DBEngine initialize...")
                        await asyncio.sleep(2)
                        
                        # Terminate the application
                        logger.info(f"\\n🛑 Step 4: Terminating DBEngine PID {current_app['pid']}...")
                        term_success, term_message = self.launcher.terminate_application(current_app['pid'])
                        
                        if term_success:
                            logger.info(f"✅ Termination result: {term_message}")
                            
                            # Wait for termination to complete
                            await asyncio.sleep(2)
                            
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
                            return False
                    else:
                        logger.error(f"❌ DBEngine status: {current_app['status']} (expected: running)")
                        return False
                else:
                    logger.error("❌ No DBEngine applications found in launched apps")
                    return False
                
            else:
                logger.error(f"❌ Launch failed: {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ DBEngine test failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🔬 DBEngine Application Test Starting")
        logger.info("=" * 40)
        
        # Initialize test
        test = DBEngineTest()
        
        # Run test
        success = await test.test_dbengine_launch_and_terminate()
        
        if success:
            logger.info("\\n🎉 DBEngine test completed successfully!")
            logger.info("✅ Successfully launched and terminated dbengine-x86_64.exe")
        else:
            logger.error("\\n❌ DBEngine test failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
