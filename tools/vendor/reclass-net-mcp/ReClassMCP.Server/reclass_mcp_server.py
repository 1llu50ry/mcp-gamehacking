#!/usr/bin/env python3
"""
ReClass.NET MCP Server

This MCP server connects to the ReClass.NET plugin via TCP and exposes
ReClass.NET functionality as MCP tools for Claude Code.
"""

import asyncio
import json
import socket
import sys
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

RECLASS_HOST = "127.0.0.1"
RECLASS_PORT = 27015

server = Server("reclass-mcp")


class ReClassClient:
    """Client for communicating with the ReClass.NET plugin."""

    def __init__(self, host: str = RECLASS_HOST, port: int = RECLASS_PORT):
        self.host = host
        self.port = port
        self.sock = None

    def connect(self) -> bool:
        """Connect to the ReClass.NET plugin."""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(10)
            self.sock.connect((self.host, self.port))
            return True
        except Exception:
            self.sock = None
            return False

    def disconnect(self):
        """Disconnect from the ReClass.NET plugin."""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def send_command(self, command: str, args: dict = None) -> dict:
        """Send a command to the ReClass.NET plugin and get the response."""
        if not self.sock:
            if not self.connect():
                return {"success": False, "error": "Failed to connect to ReClass.NET plugin"}

        request = {"command": command, "args": args or {}}

        try:
            self.sock.sendall((json.dumps(request) + "\n").encode("utf-8"))
            response = b""
            while True:
                chunk = self.sock.recv(4096)
                if not chunk:
                    break
                response += chunk
                if b"\n" in response:
                    break

            return json.loads(response.decode("utf-8").strip())
        except Exception as e:
            self.disconnect()
            return {"success": False, "error": str(e)}


# Global client instance
client = ReClassClient()


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List all available MCP tools."""
    return [
        Tool(
            name="IsConnected",
            description="Check if ReClass.NET plugin is available and connected",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="GetStatus",
            description="Get the current status of ReClass.NET, including attached process information",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="GetProcessInfo",
            description="Get detailed information about the currently attached process",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="ReadMemory",
            description="Read memory from the attached process",
            inputSchema={
                "type": "object",
                "properties": {
                    "address": {
                        "type": "string",
                        "description": "Memory address in hex (e.g., '0x7FF12345') or as module+offset (e.g., 'game.exe+0x1234')",
                    },
                    "size": {
                        "type": "integer",
                        "description": "Number of bytes to read (max 65536)",
                    },
                },
                "required": ["address", "size"],
            },
        ),
        Tool(
            name="WriteMemory",
            description="Write memory to the attached process",
            inputSchema={
                "type": "object",
                "properties": {
                    "address": {
                        "type": "string",
                        "description": "Memory address in hex (e.g., '0x7FF12345')",
                    },
                    "data": {
                        "type": "string",
                        "description": "Hex string of bytes to write (e.g., '90909090')",
                    },
                },
                "required": ["address", "data"],
            },
        ),
        Tool(
            name="GetModules",
            description="Get list of loaded modules in the attached process",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="GetSections",
            description="Get list of memory sections in the attached process",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="GetClasses",
            description="Get list of all classes/structures defined in the current ReClass.NET project",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="GetClass",
            description="Get detailed information about a specific class including all its nodes/fields",
            inputSchema={
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                },
                "required": ["identifier"],
            },
        ),
        Tool(
            name="GetNodes",
            description="Get all nodes/fields of a specific class",
            inputSchema={
                "type": "object",
                "properties": {
                    "class_id": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                },
                "required": ["class_id"],
            },
        ),
        Tool(
            name="ParseAddress",
            description="Parse an address formula and return the calculated address",
            inputSchema={
                "type": "object",
                "properties": {
                    "formula": {
                        "type": "string",
                        "description": "Address formula (e.g., '0x7FF12345', 'game.exe+0x1234')",
                    },
                },
                "required": ["formula"],
            },
        ),
        Tool(
            name="CreateClass",
            description="Create a new class/structure in the ReClass.NET project",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name for the new class",
                    },
                    "address": {
                        "type": "string",
                        "description": "Base address formula for the class (optional)",
                    },
                },
                "required": ["name"],
            },
        ),
        Tool(
            name="AddNode",
            description="Add a new node/field to a class",
            inputSchema={
                "type": "object",
                "properties": {
                    "class_id": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                    "type": {
                        "type": "string",
                        "description": "Node type (e.g., 'int32', 'float', 'pointer', 'hex64', 'utf8text')",
                    },
                    "name": {
                        "type": "string",
                        "description": "Name for the new node (optional)",
                    },
                },
                "required": ["class_id", "type"],
            },
        ),
        Tool(
            name="RenameNode",
            description="Rename a node/field in a class",
            inputSchema={
                "type": "object",
                "properties": {
                    "class_id": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                    "node_index": {
                        "type": "integer",
                        "description": "Index of the node in the class",
                    },
                    "name": {
                        "type": "string",
                        "description": "New name for the node",
                    },
                },
                "required": ["class_id", "node_index", "name"],
            },
        ),
        Tool(
            name="SetComment",
            description="Set a comment on a node/field",
            inputSchema={
                "type": "object",
                "properties": {
                    "class_id": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                    "node_index": {
                        "type": "integer",
                        "description": "Index of the node in the class",
                    },
                    "comment": {
                        "type": "string",
                        "description": "Comment text",
                    },
                },
                "required": ["class_id", "node_index", "comment"],
            },
        ),
        Tool(
            name="ChangeNodeType",
            description="Change the type of a node/field",
            inputSchema={
                "type": "object",
                "properties": {
                    "class_id": {
                        "type": "string",
                        "description": "Class UUID or name",
                    },
                    "node_index": {
                        "type": "integer",
                        "description": "Index of the node in the class",
                    },
                    "type": {
                        "type": "string",
                        "description": "New node type (e.g., 'int32', 'float', 'pointer')",
                    },
                },
                "required": ["class_id", "node_index", "type"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Execute an MCP tool."""

    if name == "IsConnected":
        result = client.send_command("ping")
        if result.get("success"):
            return [TextContent(type="text", text="Connected to ReClass.NET plugin")]
        return [TextContent(type="text", text=f"Not connected: {result.get('error', 'Unknown error')}")]

    elif name == "GetStatus":
        result = client.send_command("get_status")
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetProcessInfo":
        result = client.send_command("get_process_info")
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "ReadMemory":
        result = client.send_command("read_memory", {
            "address": arguments["address"],
            "size": str(arguments["size"]),
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "WriteMemory":
        result = client.send_command("write_memory", {
            "address": arguments["address"],
            "data": arguments["data"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetModules":
        result = client.send_command("get_modules")
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetSections":
        result = client.send_command("get_sections")
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetClasses":
        result = client.send_command("get_classes")
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetClass":
        result = client.send_command("get_class", {
            "id": arguments["identifier"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "GetNodes":
        result = client.send_command("get_nodes", {
            "class_id": arguments["class_id"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "ParseAddress":
        result = client.send_command("parse_address", {
            "formula": arguments["formula"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "CreateClass":
        args = {"name": arguments["name"]}
        if "address" in arguments:
            args["address"] = arguments["address"]
        result = client.send_command("create_class", args)
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "AddNode":
        args = {
            "class_id": arguments["class_id"],
            "type": arguments["type"],
        }
        if "name" in arguments:
            args["name"] = arguments["name"]
        result = client.send_command("add_node", args)
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "RenameNode":
        result = client.send_command("rename_node", {
            "class_id": arguments["class_id"],
            "node_index": arguments["node_index"],
            "name": arguments["name"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "SetComment":
        result = client.send_command("set_comment", {
            "class_id": arguments["class_id"],
            "node_index": arguments["node_index"],
            "comment": arguments["comment"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "ChangeNodeType":
        result = client.send_command("change_node_type", {
            "class_id": arguments["class_id"],
            "node_index": arguments["node_index"],
            "type": arguments["type"],
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
