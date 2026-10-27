"""Wrapper generator utilities for YaraFlux MCP Server.

This module provides utilities for generating MCP tool wrapper functions
to reduce code duplication and implement consistent parameter parsing
and error handling. It also preserves enhanced docstrings for better LLM integration.
"""

import inspect
import logging
import re
from typing import Any, Callable, Dict, Optional, get_type_hints

from mcp.server.fastmcp import FastMCP

from yaraflux_mcp_server.utils.error_handling import handle_tool_error
from yaraflux_mcp_server.utils.param_parsing import extract_typed_params, parse_params

# Configure logging
logger = logging.getLogger(__name__)


def create_tool_wrapper(
    mcp: FastMCP,
    func_name: str,
    actual_func: Callable,
    log_params: bool = True,
) -> Callable:
    """Create an MCP tool wrapper function for an implementation function.

    Args:
        mcp: FastMCP instance to register the tool with
        func_name: Name to register the tool as
        actual_func: The implementation function to wrap
        log_params: Whether to log parameter values (default: True)

    Returns:
        Registered wrapper function
    """
    # Get function signature and type hints
    sig = inspect.signature(actual_func)
    type_hints = get_type_hints(actual_func)

    # Extract parameter metadata
    param_types = {}
    param_defaults = {}

    for param_name, param in sig.parameters.items():
        # Skip 'self' parameter
        if param_name == "self":
            continue

        # Get parameter type
        param_type = type_hints.get(param_name, str)
        param_types[param_name] = param_type

        # Get default value if any
        if param.default is not inspect.Parameter.empty:
            param_defaults[param_name] = param.default

    # Create the wrapper function
    @mcp.tool(name=func_name)
    def wrapper(params: str = "") -> Dict[str, Any]:
        """MCP tool wrapper function.

        Args:
            params: URL-encoded parameter string

        Returns:
            Tool result or error response
        """
        try:
            # Log the call
            if log_params:
                logger.info(f"{func_name} called with params: {params}")
            else:
                logger.info(f"{func_name} called")

            # Parse parameters
            params_dict = parse_params(params)

            # Extract typed parameters
            extracted_params = extract_typed_params(params_dict, param_types, param_defaults)

            # Validate required parameters
            for param_name, param in sig.parameters.items():
                if param_name != "self" and param.default is inspect.Parameter.empty:
                    if param_name not in extracted_params:
                        raise ValueError(f"Required parameter '{param_name}' is missing")

            # Call the actual implementation
            result = actual_func(**extracted_params)

            # Return the result
            return result if result is not None else {}
        except Exception as e:
            # Handle error
            return handle_tool_error(func_name, e)

    # Return the wrapper function
    return wrapper


def extract_enhanced_docstring(func: Callable) -> Dict[str, Any]:
    """Extract enhanced docstring information from function.

    Parses the function's docstring to extract:
    - General description
    - Parameter descriptions
    - Returns description
    - Natural language examples for LLM interaction

    Args:
        func: Function to extract docstring from

    Returns:
        Dictionary containing parsed docstring information
    """
    docstring = inspect.getdoc(func) or ""

    # Initialize result dictionary
    result = {"description": "", "param_descriptions": {}, "returns_description": "", "examples": []}

    # Extract main description (everything before Args:)
    main_desc_match = re.search(r"^(.*?)(?:\n\s*Args:|$)", docstring, re.DOTALL)
    if main_desc_match:
        result["description"] = main_desc_match.group(1).strip()

    # Extract parameter descriptions
    param_section_match = re.search(r"Args:(.*?)(?:\n\s*Returns:|$)", docstring, re.DOTALL)
    if param_section_match:
        param_text = param_section_match.group(1)
        param_matches = re.finditer(r"\s*(\w+):\s*(.*?)(?=\n\s*\w+:|$)", param_text, re.DOTALL)
        for match in param_matches:
            param_name = match.group(1)
            param_desc = match.group(2).strip()
            result["param_descriptions"][param_name] = param_desc

    # Extract returns description
    returns_match = re.search(r"Returns:(.*?)(?:\n\s*For Claude Desktop users:|$)", docstring, re.DOTALL)
    if returns_match:
        result["returns_description"] = returns_match.group(1).strip()

    # Extract natural language examples for LLM interaction
    examples_match = re.search(r"For Claude Desktop users[^:]*:(.*?)(?:\n\s*$|$)", docstring, re.DOTALL)
    if examples_match:
        examples_text = examples_match.group(1).strip()
        # Split by quotes or newlines with quotation markers
        examples = re.findall(r'"([^"]+)"|"([^"]+)"', examples_text)
        result["examples"] = [ex[0] or ex[1] for ex in examples if ex[0] or ex[1]]

    return result


def extract_param_schema_from_func(func: Callable) -> Dict[str, Dict[str, Any]]:
    """Extract parameter schema from function signature and docstring.

    Args:
        func: Function to extract schema from

    Returns:
        Parameter schema dictionary
    """
    # Get function signature and type hints
    sig = inspect.signature(func)
    type_hints = get_type_hints(func)

    # Extract enhanced docstring
    docstring_info = extract_enhanced_docstring(func)

    # Create schema
    schema = {}

    # Process each parameter
    for param_name, param in sig.parameters.items():
        if param_name == "self":
            continue

        # Create parameter schema
        param_schema = {
            "required": param.default is inspect.Parameter.empty,
            "type": type_hints.get(param_name, str),
        }

        # Add default value if present
        if param.default is not inspect.Parameter.empty:
            param_schema["default"] = param.default

        # Add description from enhanced docstring
        if param_name in docstring_info["param_descriptions"]:
            param_schema["description"] = docstring_info["param_descriptions"][param_name]

        # Add to schema
        schema[param_name] = param_schema

    return schema


def register_tool_with_schema(
    mcp: FastMCP,
    func_name: str,
    actual_func: Callable,
    param_schema: Optional[Dict[str, Dict[str, Any]]] = None,
    log_params: bool = True,
) -> Callable:
    """Register a tool with MCP using a parameter schema.

    Args:
        mcp: FastMCP instance to register the tool with
        func_name: Name to register the tool as
        actual_func: The implementation function to call
        param_schema: Optional parameter schema (extracted from function if not provided)
        log_params: Whether to log parameter values

    Returns:
        Registered wrapper function
    """
    # Extract schema from function if not provided
    if param_schema is None:
        param_schema = extract_param_schema_from_func(actual_func)

    # Extract enhanced docstring
    docstring_info = extract_enhanced_docstring(actual_func)

    # Create a custom docstring for the wrapper that preserves the original function's docstring
    # including examples for Claude Desktop users
    wrapper_docstring = docstring_info["description"]

    # Add the Claude Desktop examples if available
    if docstring_info["examples"]:
        wrapper_docstring += "\n\nFor Claude Desktop users, this can be invoked with natural language like:"
        for example in docstring_info["examples"]:
            wrapper_docstring += f'\n"{example}"'

    # Add standard wrapper parameters
    wrapper_docstring += (
        "\n\nArgs:\n    params: URL-encoded parameter string\n\nReturns:\n    Tool result or error response"
    )

    # Create wrapper function with the enhanced docstring
    def wrapper_func(params: str = "") -> Dict[str, Any]:
        try:
            # Log the call
            if log_params:
                logger.info(f"{func_name} called with params: {params}")
            else:
                logger.info(f"{func_name} called")

            # Parse and validate parameters using schema
            from yaraflux_mcp_server.utils.param_parsing import (  # pylint: disable=import-outside-toplevel
                parse_and_validate_params,
            )

            parsed_params = parse_and_validate_params(params, param_schema)

            # Call the actual implementation
            result = actual_func(**parsed_params)

            # Return the result
            return result if result is not None else {}
        except Exception as e:
            # Handle error
            return handle_tool_error(func_name, e)

    # Set the docstring on the wrapper function
    wrapper_func.__doc__ = wrapper_docstring

    # Register with MCP
    registered_func = mcp.tool(name=func_name)(wrapper_func)

    # Return the wrapper function
    return registered_func
