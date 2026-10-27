"""Parameter parsing utilities for YaraFlux MCP Server.

This module provides utility functions for parsing parameters from
string format into Python data types, with support for validation
against parameter schemas.
"""

import json
import logging
import urllib.parse
from typing import Any, Dict, List, Optional, Type, Union, get_args, get_origin

# Configure logging
logger = logging.getLogger(__name__)


def parse_params(params_str: str) -> Dict[str, Any]:
    """Parse a URL-encoded string into a dictionary of parameters.

    Args:
        params_str: String containing URL-encoded parameters

    Returns:
        Dictionary of parsed parameters

    Raises:
        ValueError: If the string cannot be parsed
    """
    if not params_str:
        return {}

    # Handle both simple key=value format and URL-encoded format
    try:
        # Try URL-encoded format
        params_dict = {}
        pairs = params_str.split("&")
        for pair in pairs:
            if "=" in pair:
                key, value = pair.split("=", 1)
                params_dict[key] = urllib.parse.unquote(value)
            else:
                params_dict[pair] = ""
        return params_dict
    except Exception as e:
        logger.error(f"Error parsing params string: {str(e)}")
        raise ValueError(f"Failed to parse parameters: {str(e)}") from e


def convert_param_type(value: str, param_type: Type) -> Any:
    """Convert a string parameter to the specified Python type.

    Args:
        value: String value to convert
        param_type: Target Python type

    Returns:
        Converted value

    Raises:
        ValueError: If the value cannot be converted to the specified type
    """
    origin = get_origin(param_type)
    args = get_args(param_type)

    # Handle Optional types
    is_optional = origin is Union and type(None) in args
    if is_optional:
        # If it's Optional[X], extract X
        for arg in args:
            if arg is not type(None):
                param_type = arg
                break
        # If value is empty, "null", or "None" and type is optional, return None
        if not value or (isinstance(value, str) and value.lower() in ("null", "none")):
            return None

    try:
        # Handle basic types
        if param_type is str:
            return value
        if param_type is int:
            return int(value)
        if param_type is float:
            return float(value)
        if param_type is bool:
            # Handle both string and boolean inputs
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "yes", "1", "t", "y")
            if isinstance(value, int):
                return bool(value)
            return bool(value)  # Try to convert any other type
        # Handle list types
        if origin is list or origin is List:
            if not value:
                return []
            # For lists, split by comma if it's a string
            if isinstance(value, str):
                items = value.split(",")
                # If we have type args, convert each item
                if args and args[0] is not Any:
                    item_type = args[0]
                    return [convert_param_type(item.strip(), item_type) for item in items]
                return [item.strip() for item in items]
            return value
        # Handle dict types
        if origin is dict or origin is Dict:
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    # If not valid JSON, just return a dict with the string
                    return {"value": value}
            return value
        # For any other type, just return the value
        return value
    except Exception as e:
        logger.error(f"Error converting parameter to {param_type}: {str(e)}")
        raise ValueError(f"Failed to convert parameter to {param_type}: {str(e)}") from e


def extract_typed_params(
    params_dict: Dict[str, str], param_types: Dict[str, Type], param_defaults: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Extract and type-convert parameters from a dictionary based on type hints.

    Args:
        params_dict: Dictionary of string parameters
        param_types: Dictionary mapping parameter names to their types
        param_defaults: Optional dictionary of default values

    Returns:
        Dictionary of typed parameters

    Raises:
        ValueError: If a required parameter is missing or cannot be converted
    """
    result: Dict[str, Any] = {}

    defaults: Dict[str, Any] = {} if param_defaults is None else param_defaults

    for name, param_type in param_types.items():
        # Get parameter value (use default if provided)
        if name in params_dict:
            value = params_dict[name]
        elif name in defaults:
            value = defaults[name]
        else:
            # Skip parameters that aren't provided and don't have defaults
            continue

        # Skip None values
        if value is None:
            continue

        # Convert value to the right type
        result[name] = convert_param_type(value, param_type)

    return result


def parse_and_validate_params(params_str: str, param_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a URL-encoded string and validate against a parameter schema.

    Args:
        params_str: String containing URL-encoded parameters
        param_schema: Schema defining parameter types and requirements

    Returns:
        Dictionary of validated parameters

    Raises:
        ValueError: If validation fails or a required parameter is missing
    """
    # Parse parameters
    params_dict = parse_params(params_str)
    result = {}

    # Extract parameter types and defaults from schema
    param_types = {}
    param_defaults = {}
    required_params = []

    # Handle JSON Schema style format
    if "properties" in param_schema:
        properties = param_schema.get("properties", {})

        # Extract required params list if it exists
        if "required" in param_schema:
            required_params = param_schema.get("required", [])

        # Process each property
        for name, prop_schema in properties.items():
            # Extract type
            type_value = prop_schema.get("type")
            if type_value == "string":
                param_types[name] = str
            elif type_value == "integer":
                param_types[name] = int
            elif type_value == "number":
                param_types[name] = float
            elif type_value == "boolean":
                param_types[name] = bool
            elif type_value == "array":
                # Handle arrays, optionally with item type
                items = prop_schema.get("items", {})
                item_type = items.get("type", "string")
                if item_type == "string":
                    param_types[name] = List[str]
                elif item_type == "integer":
                    param_types[name] = List[int]
                elif item_type == "number":
                    param_types[name] = List[float]
                else:
                    param_types[name] = List[Any]
            elif type_value == "object":
                param_types[name] = Dict[str, Any]
            else:
                param_types[name] = str  # Default to string

            # Extract default value if present
            if "default" in prop_schema:
                param_defaults[name] = prop_schema["default"]
    else:
        # Handle simple schema format
        for name, schema in param_schema.items():
            param_type = schema.get("type", str)
            param_types[name] = param_type

            if "default" in schema:
                param_defaults[name] = schema["default"]

            if schema.get("required", False):
                required_params.append(name)

    # Convert parameters to their types
    typed_params = extract_typed_params(params_dict, param_types, param_defaults)

    # Validate required parameters
    for name in required_params:
        if name not in typed_params:
            raise ValueError(f"Required parameter '{name}' is missing")

    # Add all parameters to the result
    result.update(typed_params)

    # Add any defaults not already in the result
    for name, value in param_defaults.items():
        if name not in result:
            result[name] = value

    return result
