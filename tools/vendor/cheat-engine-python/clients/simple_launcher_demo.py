#!/usr/bin/env python3
"""
Simple MCP Application Launcher Demo
Demonstrates the new application launcher functionality
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

class SimpleMCPDemo:
    """Simple demonstration of MCP application launcher functionality"""
    
    def __init__(self):
        # Add server path for imports
        project_root = os.path.dirname(os.path.dirname(__file__))
        server_path = os.path.join(project_root, 'server')
        sys.path.insert(0, server_path)
        
        try:
            # Import required modules
            from config.whitelist import ProcessWhitelist
            from process.launcher import ApplicationLauncher
            from process.manager import ProcessManager
            
            # Initialize components
            self.whitelist = ProcessWhitelist()
            self.whitelist.load_whitelist(os.path.join(server_path, 'process_whitelist.json'))
            
            self.launcher = ApplicationLauncher(self.whitelist)
            self.process_manager = ProcessManager()
            
            logger.info("✅ MCP Demo components initialized")
            
        except ImportError as e:
            logger.error(f"❌ Failed to import components: {e}")
            raise
    
    async def demonstrate_application_launcher(self):
        """Demonstrate the application launcher functionality"""
        try:
            logger.info("🤖 MCP Application Launcher Demonstration")
            logger.info("=" * 60)
            
            # Demo 1: Show whitelisted applications
            logger.info("📋 Demo 1: Whitelisted Applications")
            apps = self.launcher.get_whitelisted_applications()
            available_apps = [app for app in apps if app['executable_path']]
            
            logger.info(f"Found {len(available_apps)} available applications:")
            for app in available_apps[:5]:  # Show first 5
                logger.info(f"  • {app['process_name']} - {app['description']}")
            
            await asyncio.sleep(2)
            
            # Demo 2: Launch Notepad
            logger.info("\\n🚀 Demo 2: Launching Notepad")
            success, message, notepad_pid = self.launcher.launch_application('notepad.exe')
            
            if success:
                logger.info(f"✅ {message}")
                
                # Wait for app to start
                await asyncio.sleep(3)
                
                # Show application info
                app_info = self.launcher.get_application_by_pid(notepad_pid)
                if app_info:
                    logger.info(f"📊 Notepad status: {app_info['status']}")
                
            else:
                logger.error(f"❌ {message}")
                notepad_pid = None
            
            await asyncio.sleep(2)
            
            # Demo 3: Launch Calculator
            logger.info("\\n🧮 Demo 3: Launching Calculator")
            success, message, calc_pid = self.launcher.launch_application('calc.exe')
            
            if success:
                logger.info(f"✅ {message}")
            else:
                logger.error(f"❌ {message}")
                calc_pid = None
            
            await asyncio.sleep(2)
            
            # Demo 4: Show launched applications
            logger.info("\\n📊 Demo 4: Launched Applications")
            launched_apps = self.launcher.get_launched_applications()
            
            if launched_apps:
                logger.info(f"Currently tracking {len(launched_apps)} applications:")
                for app in launched_apps:
                    logger.info(f"  • PID {app['pid']}: {app['process_name']} ({app['status']})")
            else:
                logger.info("No applications currently being tracked")
            
            await asyncio.sleep(2)
            
            # Demo 5: Process management integration
            logger.info("\\n🔗 Demo 5: Process Management Integration")
            processes = self.process_manager.list_processes()
            
            # Find our launched processes
            our_processes = []
            for proc in processes:
                if notepad_pid and proc['pid'] == notepad_pid:
                    our_processes.append(f"Notepad (PID {proc['pid']})")
                elif calc_pid and proc['pid'] == calc_pid:
                    our_processes.append(f"Calculator (PID {proc['pid']})")
            
            if our_processes:
                logger.info(f"Found our processes in system: {', '.join(our_processes)}")
            else:
                logger.info("Our launched processes may have exited")
            
            await asyncio.sleep(2)
            
            # Demo 6: Cleanup
            logger.info("\\n🧹 Demo 6: Cleanup")
            
            # Try to terminate applications
            terminated_count = 0
            if notepad_pid:
                success, msg = self.launcher.terminate_application(notepad_pid)
                if success:
                    terminated_count += 1
                    logger.info(f"✅ Terminated Notepad: {msg}")
                else:
                    logger.warning(f"⚠️ Notepad termination: {msg}")
            
            if calc_pid:
                success, msg = self.launcher.terminate_application(calc_pid)
                if success:
                    terminated_count += 1
                    logger.info(f"✅ Terminated Calculator: {msg}")
                else:
                    logger.warning(f"⚠️ Calculator termination: {msg}")
            
            await asyncio.sleep(1)
            
            # Cleanup terminated applications
            removed = self.launcher.cleanup_terminated_applications()
            logger.info(f"🗑️ Cleaned up {removed} terminated applications")
            
            logger.info("\\n=" * 60)
            logger.info("🎉 MCP Application Launcher Demonstration COMPLETE!")
            logger.info(f"Summary: Launched apps, terminated {terminated_count}, cleaned up {removed}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Demo failed: {e}")
            return False

async def main():
    """Main function"""
    try:
        logger.info("🎭 Simple MCP Application Launcher Demo Starting")
        logger.info("=" * 50)
        
        # Initialize demo
        demo = SimpleMCPDemo()
        
        # Run demonstration
        success = await demo.demonstrate_application_launcher()
        
        if success:
            logger.info("🎉 Demo completed successfully!")
        else:
            logger.error("❌ Demo failed")
        
    except KeyboardInterrupt:
        logger.info("🛑 Demo interrupted by user")
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
