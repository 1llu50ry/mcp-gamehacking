"""
Spin up mcp-gamehacking under the OpenAI Agent SDK via its stdio
transport. Install:  pip install openai-agents mcp
"""
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

async def main():
    async with MCPServerStdio(
        name="mcp-gamehacking",
        params={
            "command": "node",
            "args": ["/path/to/mcp-gamehacking/dist/index.js"],
            "env": {"MCP_FS_ALLOW": "/samples"},
        },
    ) as mcp:
        agent = Agent(
            name="RE Analyst",
            instructions="You are a reverse-engineering analyst. Use mcp-gamehacking tools to inspect binaries.",
            mcp_servers=[mcp],
        )
        result = await Runner.run(agent, "Analyze /samples/malware.exe. Start with pe_debug_dir, then look for YARA hits.")
        print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())
