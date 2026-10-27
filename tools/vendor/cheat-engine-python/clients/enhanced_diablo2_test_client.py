#!/usr/bin/env python3
"""
Enhanced Diablo II Cheat Table Test Client

This client tests the enhanced filesystem integration and XML parsing
specifically for the Diablo II.CT file to validate proper extraction
of module-relative addresses, offsets, and detailed metadata.
"""

import asyncio
import json
import logging
import sys
import os
from typing import Dict, Any, Optional
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class EnhancedDiablo2TestClient:
    """Client for testing enhanced Diablo II cheat table parsing"""
    
    def __init__(self):
        self.session = None
        self.server_path = os.path.join(os.path.dirname(__file__), '..', 'server', 'main.py')
        
    async def connect(self):
        """Connect to the MCP server"""
        try:
            logger.info("Connecting to MCP Cheat Engine Server...")
            
            # Create server parameters
            server_params = StdioServerParameters(
                command="python",
                args=[self.server_path],
                env=None
            )
            
            # Connect to server
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    self.session = session
                    
                    # Initialize session
                    await session.initialize()
                    
                    logger.info("Connected successfully!")
                    logger.info("Testing enhanced Diablo II cheat table parsing...")
                    
                    # Run enhanced tests
                    await self.run_enhanced_tests()
                    
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            raise

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Call a tool on the server"""
        try:
            logger.info(f"Calling tool: {tool_name}")
            
            result = await self.session.call_tool(tool_name, arguments)
            
            if result.content:
                for content in result.content:
                    if hasattr(content, 'text'):
                        return content.text
                    else:
                        return str(content)
            
            return "No content returned"
            
        except Exception as e:
            logger.error(f"Error calling tool {tool_name}: {e}")
            return f"Error: {str(e)}"

    async def run_enhanced_tests(self):
        """Run enhanced Diablo II cheat table tests"""
        print("=" * 70)
        print("ENHANCED DIABLO II CHEAT TABLE PARSING TEST")
        print("=" * 70)
        
        diablo2_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
        
        # Test 1: Table format (matching the expected output)
        print("\n1. DIABLO II CHEAT TABLE - TABLE FORMAT")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "table"
        })
        print(result)
        
        # Test 2: Quick load (should use table format by default)
        print("\n2. QUICK LOAD DIABLO II CHEAT TABLE")
        print("-" * 50)
        result = await self.call_tool("quick_load_diablo2_cheat_table", {})
        print(result)
        
        # Test 3: Detailed format for comparison
        print("\n3. DETAILED FORMAT")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "detailed"
        })
        print(result)
        
        # Test 4: CSV format for data analysis
        print("\n4. CSV FORMAT")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "csv"
        })
        print(result)
        
        print("\n" + "=" * 70)
        print("ENHANCED DIABLO II PARSING TEST COMPLETED")
        print("=" * 70)

    async def run(self):
        """Main execution method"""
        try:
            await self.connect()
        except Exception as e:
            logger.error(f"Client execution failed: {e}")
            sys.exit(1)

def main():
    """Main entry point"""
    print("Enhanced Diablo II Cheat Table Test Client")
    print("Testing advanced XML parsing with module addresses and offsets")
    print()
    
    client = EnhancedDiablo2TestClient()
    asyncio.run(client.run())

if __name__ == "__main__":
    main()
