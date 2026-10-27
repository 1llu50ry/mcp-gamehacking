#!/usr/bin/env python3
"""
Calculator-specific test for the improved launcher logic
Tests that Calculator now shows 'running' status instead of 'terminated'
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

class CalculatorTest:
    """Test Calculator launch and status detection"""
    
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
            
            logger.info("✅ Calculator test initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_calculator_launch_and_status(self):
        """Test launching Calculator and verifying it shows as running"""
        try:
            logger.info("🧮 Calculator Launch & Status Test")
            logger.info("=" * 50)
            
            # Launch Calculator
            logger.info("🚀 Step 1: Launching Calculator...")
            success, message, pid = self.launcher.launch_application('calc.exe')
            
            if success:
                logger.info(f"✅ Launch result: {message}")
                logger.info(f"📍 Initial PID: {pid}")
                
                # Wait for potential PID updates
                logger.info("⏳ Waiting for PID resolution...")
                await asyncio.sleep(3)
                
                # Check final status
                logger.info("📊 Checking launched applications...")
                launched_apps = self.launcher.get_launched_applications()
                
                calc_apps = [app for app in launched_apps if 'calc' in app['process_name']]
                
                if calc_apps:
                    for app in calc_apps:
                        logger.info(f"  • PID {app['pid']}: {app['process_name']} ({app['status']})")
                        
                        if app['status'] == 'running':
                            logger.info("🎉 Calculator is correctly showing as RUNNING!")
                            
                            # Try to terminate it using the current PID
                            logger.info(f"\\n🛑 Step 2: Terminating Calculator PID {app['pid']}...")
                            term_success, term_message = self.launcher.terminate_application(app['pid'])
                            
                            if term_success:
                                logger.info(f"✅ {term_message}")
                            else:
                                logger.warning(f"⚠️ {term_message}")
                            
                            await asyncio.sleep(2)
                            
                            # Cleanup
                            removed = self.launcher.cleanup_terminated_applications()
                            logger.info(f"🧹 Cleaned up {removed} terminated applications")
                            
                            return True
                        else:
                            logger.error(f"❌ Calculator shows status: {app['status']} (expected: running)")
                            return False
                else:
                    logger.error("❌ No calculator applications found in launched apps")
                    return False
                
            else:
                logger.error(f"❌ Launch failed: {message}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Calculator test failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🔬 Calculator Test Starting")
        logger.info("=" * 40)
        
        # Initialize test
        test = CalculatorTest()
        
        # Run test
        success = await test.test_calculator_launch_and_status()
        
        if success:
            logger.info("🎉 Calculator test completed successfully!")
            logger.info("✅ Calculator now properly shows 'running' status!")
        else:
            logger.error("❌ Calculator test failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
