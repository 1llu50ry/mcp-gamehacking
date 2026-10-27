"""Base module for Claude MCP tools registration and management.

This module provides the core functionality for registering and managing MCP tools,
including the decorator system and FastAPI integration helpers.
"""

import inspect
import logging
from typing import Any, Callable, Dict, List, get_origin, get_type_hints

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ToolRegistry:
    """Registry for MCP tools.

    This class maintains a registry of all MCP tools and provides
    utilities for registering and retrieving tools.
    """

    _tools: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def register(cls, func: Callable) -> Callable:
        """Register a tool function.

        Args:
            func: Function to register as a tool

        Returns:
            The original function unchanged
        """
        # Extract function metadata
        name = func.__name__
        doc = func.__doc__ or "No description available"
        description = doc.split("\n\n")[0].strip() if doc else "No description available"

        # Get type hints and signature
        hints = get_type_hints(func)
        sig = inspect.signature(func)

        # Create schema properties
        properties = {}
        required = []

        # Process each parameter
        for param_name, param in sig.parameters.items():
            if param_name == "self":
                continue

            # Set as required if no default value
            if param.default is inspect.Parameter.empty:
                required.append(param_name)

            # Get parameter type
            param_type = hints.get(param_name, Any)
            schema_type = "string"  # Default type

            # Map Python types to JSON Schema types
            if param_type is str:
                schema_type = "string"
            elif param_type is int:
                schema_type = "integer"
            elif param_type is float:
                schema_type = "number"
            elif param_type is bool:
                schema_type = "boolean"
            elif get_origin(param_type) is list or get_origin(param_type) is List:
                schema_type = "array"
            elif get_origin(param_type) is dict or get_origin(param_type) is Dict:
                schema_type = "object"
            elif param_type is Any:
                schema_type = "string"

            # Create parameter property
            properties[param_name] = {"type": schema_type}

            # Extract parameter description from docstring
            if doc:
                param_doc = None
                for line in doc.split("\n"):
                    if line.strip().startswith(f"{param_name}:"):
                        param_doc = line.split(":", 1)[1].strip()
                        break

                if param_doc:
                    properties[param_name]["description"] = param_doc

        # Create input schema
        input_schema = {"type": "object", "properties": properties, "required": required}

        # Store tool metadata
        cls._tools[name] = {"name": name, "description": description, "function": func, "input_schema": input_schema}

        logger.debug(f"Registered MCP tool: {name}")
        return func

    @classmethod
    def get_tool(cls, name: str) -> Dict[str, Any]:
        """Get a registered tool by name.

        Args:
            name: Name of the tool to retrieve

        Returns:
            Tool metadata including the function and schema

        Raises:
            KeyError: If tool is not found
        """
        if name not in cls._tools:
            raise KeyError(f"Tool not found: {name}")
        return cls._tools[name]

    @classmethod
    def get_all_tools(cls) -> List[Dict[str, Any]]:
        """Get all registered tools.

        Returns:
            List of tool metadata objects
        """
        return [
            {"name": data["name"], "description": data["description"], "inputSchema": data["input_schema"]}
            for data in cls._tools.values()
        ]

    @classmethod
    def execute_tool(cls, name: str, params: Dict[str, Any]) -> Any:
        """Execute a registered tool.

        Args:
            name: Name of the tool to execute
            params: Parameters to pass to the tool

        Returns:
            Tool execution result

        Raises:
            KeyError: If tool is not found
            Exception: If tool execution fails
        """
        tool = cls.get_tool(name)
        function = tool["function"]

        try:
            result = function(**params)
            return result
        except Exception as e:
            logger.error(f"Error executing tool {name}: {str(e)}")
            raise


def register_tool() -> Callable:
    """Decorator for registering MCP tools.

    This decorator registers the function as an MCP tool and adds
    necessary metadata for tool discovery and execution.

    Returns:
        Decorator function
    """

    def decorator(func: Callable) -> Callable:
        # Register with ToolRegistry
        ToolRegistry.register(func)
        # Mark as MCP tool for FastAPI discovery
        func.__mcp_tool__ = True
        return func

    return decorator
