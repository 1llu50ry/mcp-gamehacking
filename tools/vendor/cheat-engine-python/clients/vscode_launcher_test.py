#!/usr/bin/env python3
"""
VS Code Application Launcher Test
Tests launching VS Code which should work more reliably
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

class VSCodeLauncherTest:
    """Test VS Code launching specifically"""
    
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
            
            logger.info("✅ VS Code launcher test initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def test_vscode_launch(self):
        """Test launching VS Code"""
        try:
            logger.info("🤖 VS Code Application Launcher Test")
            logger.info("=" * 50)
            
            # Find VS Code executable
            logger.info("🔍 Step 1: Finding VS Code executable...")
            vscode_path = self.launcher.find_executable('code.exe')
            
            if vscode_path:
                logger.info(f"✅ Found VS Code at: {vscode_path}")
            else:
                logger.error("❌ VS Code not found")
                return False
            
            await asyncio.sleep(1)
            
            # Launch VS Code
            logger.info("🚀 Step 2: Launching VS Code...")
            success, message, vscode_pid = self.launcher.launch_application('code.exe')
            
            if success:
                logger.info(f"✅ {message}")
                
                # Wait for VS Code to start
                await asyncio.sleep(5)
                
                # Check if it's running
                app_info = self.launcher.get_application_by_pid(vscode_pid)
                if app_info:
                    logger.info(f"📊 VS Code status: {app_info['status']}")
                    
                    if app_info['status'] == 'running':
                        logger.info("✅ VS Code is confirmed running!")
                        
                        # Wait a bit more to see VS Code window
                        logger.info("⏳ Waiting 10 seconds for you to see VS Code...")
                        await asyncio.sleep(10)
                        
                        # Now terminate it
                        logger.info("🛑 Step 3: Terminating VS Code...")
                        term_success, term_message = self.launcher.terminate_application(vscode_pid, force=False)
                        
                        if term_success:
                            logger.info(f"✅ {term_message}")
                        else:
                            logger.warning(f"⚠️ {term_message}")
                        
                        await asyncio.sleep(2)
                        
                        # Cleanup
                        logger.info("🧹 Step 4: Cleanup...")
                        removed = self.launcher.cleanup_terminated_applications()
                        logger.info(f"🗑️ Cleaned up {removed} terminated applications")
                        
                        return True
                    else:
                        logger.warning(f"⚠️ VS Code not running (status: {app_info['status']})")
                        return False
                else:
                    logger.warning("⚠️ Could not get VS Code application info")
                    return False
                    
            else:
                logger.error(f"❌ {message}")
                return False
            
        except Exception as e:
            logger.error(f"❌ VS Code test failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🎯 VS Code Application Launcher Test Starting")
        logger.info("=" * 40)
        
        # Initialize test
        test = VSCodeLauncherTest()
        
        # Run VS Code test
        success = await test.test_vscode_launch()
        
        if success:
            logger.info("🎉 VS Code test completed successfully!")
        else:
            logger.error("❌ VS Code test failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
