#!/usr/bin/env python3
"""
Cheat Table Filesystem Client for MCP Cheat Engine Server

This client demonstrates the new filesystem integration capabilities for
directly reading and managing cheat table (.CT) files from the filesystem.

Features:
- Browse cheat table directories
- List available .CT files
- Load and parse cheat table files
- Extract address information in multiple formats
- Quick access to specific cheat tables

Author: Enhanced MCP Cheat Engine Server
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

class CheatTableFilesystemClient:
    """Client for testing MCP Cheat Engine Server filesystem cheat table operations"""
    
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
                    logger.info("Testing cheat table filesystem operations...")
                    
                    # Run filesystem operations tests
                    await self.run_filesystem_tests()
                    
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            raise

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Call a tool on the server"""
        try:
            logger.info(f"Calling tool: {tool_name} with args: {arguments}")
            
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

    async def run_filesystem_tests(self):
        """Run comprehensive filesystem cheat table tests"""
        print("=" * 70)
        print("CHEAT TABLE FILESYSTEM INTEGRATION TESTING")
        print("=" * 70)
        
        # Test 1: Browse cheat tables directory
        print("\n1. BROWSING CHEAT TABLES DIRECTORY")
        print("-" * 50)
        result = await self.call_tool("browse_cheat_tables_directory", {})
        print(result)
        
        # Test 2: List cheat table files
        print("\n2. LISTING CHEAT TABLE FILES")
        print("-" * 50)
        result = await self.call_tool("list_cheat_tables", {})
        print(result)
        
        # Test 3: Load specific cheat table (Diablo II.CT)
        print("\n3. LOADING DIABLO II CHEAT TABLE")
        print("-" * 50)
        diablo2_path = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
        result = await self.call_tool("load_cheat_table", {"file_path": diablo2_path})
        print(result)
        
        # Test 4: Extract addresses in detailed format
        print("\n4. EXTRACTING ADDRESSES (DETAILED FORMAT)")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "detailed"
        })
        print(result)
        
        # Test 5: Extract addresses in CSV format
        print("\n5. EXTRACTING ADDRESSES (CSV FORMAT)")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "csv"
        })
        print(result)
        
        # Test 6: Extract addresses in simple format
        print("\n6. EXTRACTING ADDRESSES (SIMPLE FORMAT)")
        print("-" * 50)
        result = await self.call_tool("extract_cheat_table_addresses", {
            "file_path": diablo2_path,
            "address_format": "simple"
        })
        print(result)
        
        # Test 7: Quick load Diablo II (convenience function)
        print("\n7. QUICK LOAD DIABLO II CHEAT TABLE")
        print("-" * 50)
        result = await self.call_tool("quick_load_diablo2_cheat_table", {})
        print(result)
        
        # Test 8: Browse with custom directory (if available)
        print("\n8. TESTING CUSTOM DIRECTORY BROWSING")
        print("-" * 50)
        result = await self.call_tool("browse_cheat_tables_directory", {
            "directory_path": r"C:\Users\benam\Documents\My Cheat Tables"
        })
        print(result)
        
        print("\n" + "=" * 70)
        print("FILESYSTEM CHEAT TABLE TESTING COMPLETED")
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
    print("MCP Cheat Engine Server - Filesystem Cheat Table Client")
    print("Testing direct filesystem integration for cheat table operations")
    print()
    
    client = CheatTableFilesystemClient()
    asyncio.run(client.run())

if __name__ == "__main__":
    main()
