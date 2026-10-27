#!/usr/bin/env python3
"""
Quick test for compatibility fix
"""

import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test_compatibility():
    server_params = StdioServerParameters(
        command="python",
        args=["server/main.py"],
        env=None
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            test_file = r"C:\Users\benam\Documents\My Cheat Tables\Diablo II.CT"
            
            print("Testing comprehensive analysis...")
            try:
                result = await session.call_tool(
                    "comprehensive_cheat_table_analysis",
                    {"file_path": test_file}
                )
                analysis = result.content[0].text
                print(analysis[:500] + "..." if len(analysis) > 500 else analysis)
            except Exception as e:
                print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_compatibility())
