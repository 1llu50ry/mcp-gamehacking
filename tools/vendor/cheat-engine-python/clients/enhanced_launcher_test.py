#!/usr/bin/env python3
"""
Enhanced Application Launcher Test with Notepad
Tests the improved launcher logic specifically
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

class EnhancedLauncherTest:
    """Enhanced test for the improved launcher logic"""
    
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
            
            logger.info("✅ Enhanced launcher test initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_notepad_launch_and_track(self):
        """Test launching Notepad and tracking the actual process"""
        try:
            logger.info("🤖 Enhanced Notepad Launcher Test")
            logger.info("=" * 50)
            
            # Launch Notepad
            logger.info("📝 Step 1: Launching Notepad...")
            success, message, pid = self.launcher.launch_application('notepad.exe')
            
            if success:
                logger.info(f"✅ Launch result: {message}")
                logger.info(f"📍 Initial PID: {pid}")
                
                # Check initial status
                app_info = self.launcher.get_application_by_pid(pid)
                if app_info:
                    logger.info(f"📊 Initial status: {app_info['status']}")
                
                # Wait and check status updates
                for i in range(6):  # Check every second for 6 seconds
                    await asyncio.sleep(1)
                    logger.info(f"⏳ Checking status after {i+1} seconds...")
                    
                    # Force status update
                    self.launcher._update_application_status()
                    
                    # Get all launched applications
                    launched_apps = self.launcher.get_launched_applications()
                    
                    for app in launched_apps:
                        if app['process_name'] == 'notepad.exe':
                            logger.info(f"  📊 PID {app['pid']}: {app['process_name']} ({app['status']})")
                
                # Final status check
                logger.info("\\n📋 Final launched applications:")
                final_apps = self.launcher.get_launched_applications()
                
                running_notepad = None
                for app in final_apps:
                    if app['process_name'] == 'notepad.exe':
                        logger.info(f"  • PID {app['pid']}: {app['process_name']} ({app['status']})")
                        if app['status'] == 'running':
                            running_notepad = app
                
                # If we have a running notepad, try to terminate it
                if running_notepad:
                    logger.info(f"\\n🛑 Step 2: Terminating Notepad PID {running_notepad['pid']}...")
                    term_success, term_message = self.launcher.terminate_application(running_notepad['pid'])
                    
                    if term_success:
                        logger.info(f"✅ {term_message}")
                    else:
                        logger.warning(f"⚠️ {term_message}")
                    
                    await asyncio.sleep(2)
                    
                    # Cleanup
                    removed = self.launcher.cleanup_terminated_applications()
                    logger.info(f"🧹 Cleaned up {removed} terminated applications")
                else:
                    logger.warning("⚠️ No running notepad found to terminate")
                
                return True
                
            else:
                logger.error(f"❌ Launch failed: {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Enhanced test failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🔬 Enhanced Application Launcher Test Starting")
        logger.info("=" * 40)
        
        # Initialize test
        test = EnhancedLauncherTest()
        
        # Run enhanced test
        success = await test.test_notepad_launch_and_track()
        
        if success:
            logger.info("🎉 Enhanced test completed successfully!")
        else:
            logger.error("❌ Enhanced test failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
