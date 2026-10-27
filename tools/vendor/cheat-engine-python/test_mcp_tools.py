#!/usr/bin/env python3
"""
MCP client to test Cheat Engine version detection tools
"""

import asyncio
import json
from typing import Dict, Any

async def test_mcp_version_tools():
    """Test the MCP tools for Cheat Engine version detection"""
    print("🧪 Testing MCP Cheat Engine Version Tools")
    print("=" * 50)
    
    try:
        # We'll simulate the tool calls since we don't have a full MCP client setup
        # Instead, let's import and test the functions directly
        import sys
        from pathlib import Path
        
        # Add server directory to path
        server_dir = Path(__file__).parent / "server"
        sys.path.insert(0, str(server_dir))
        
        # Import the main module to access the tool functions
        import main
        
        print("🔧 Testing get_cheat_engine_basic_version tool...")
        basic_result = main.get_cheat_engine_basic_version()
        print(f"Basic Version Result: {basic_result}")
        
        print("\n🔍 Testing get_cheat_engine_version tool...")
        detailed_result = main.get_cheat_engine_version()
        print("Detailed Version Result:")
        print(detailed_result)
        
    except Exception as e:
        print(f"❌ Error during testing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_mcp_version_tools())
