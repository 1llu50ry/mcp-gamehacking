#!/usr/bin/env python3
"""
Simple test script to verify Cheat Engine version detection functionality
"""

import asyncio
import json
from pathlib import Path
import sys

# Add the server directory to Python path
server_dir = Path(__file__).parent / "server"
sys.path.insert(0, str(server_dir))

async def test_ce_version_detection():
    """Test the Cheat Engine version detection functionality directly"""
    print("🧪 Testing Cheat Engine Version Detection")
    print("=" * 50)
    
    try:
        # Import the CheatEngineBridge
        from cheatengine.ce_bridge import CheatEngineBridge
        
        # Initialize the bridge
        print("🔧 Initializing Cheat Engine Bridge...")
        bridge = CheatEngineBridge()
        
        # Test basic version detection
        print("\n📋 Testing basic version detection...")
        if bridge.ce_installation.available and bridge.ce_installation.executable:
            basic_version = bridge._get_ce_version(Path(bridge.ce_installation.executable))
            print(f"Basic Version: {basic_version}")
        else:
            print(f"Installation Version: {bridge.ce_installation.version}")
            print("No executable path available for detailed version check")
        
        # Test comprehensive version info
        print("\n🔍 Testing comprehensive version info...")
        version_info = bridge.get_cheat_engine_version_info()
        
        if version_info:
            print("📊 Comprehensive Version Information:")
            print(json.dumps(version_info, indent=2, default=str))
        else:
            print("❌ No version information available")
            
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Make sure all required modules are available")
    except Exception as e:
        print(f"❌ Error during testing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_ce_version_detection())
