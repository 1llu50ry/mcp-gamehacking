"""Error handling utilities for YaraFlux MCP Server.

This module provides standardized error handling functions for use across
the YaraFlux MCP Server, ensuring consistent error responses and logging.
"""

import logging
import traceback
from typing import Any, Callable, Dict, Optional, Protocol, Type, TypeVar

from yaraflux_mcp_server.yara_service import YaraError

# Configure logging
logger = logging.getLogger(__name__)

# Type definitions
T = TypeVar("T")
E = TypeVar("E", bound=Exception)


class ErrorHandler(Protocol):
    """Protocol for error handler functions."""

    def __call__(self, error: Exception) -> Dict[str, Any]: ...


def format_error_message(error: Exception) -> str:
    """Format an exception into a user-friendly error message.

    Args:
        error: The exception to format

    Returns:
        Formatted error message
    """
    # Different error types may need different formatting
    if isinstance(error, YaraError):
        return f"YARA error: {str(error)}"
    if isinstance(error, ValueError):
        return f"Invalid parameter: {str(error)}"
    if isinstance(error, FileNotFoundError):
        return f"File not found: {str(error)}"
    if isinstance(error, PermissionError):
        return f"Permission denied: {str(error)}"

    # Generic error message for other exceptions
    return f"Error: {str(error)}"


def handle_tool_error(
    func_name: str, error: Exception, log_level: int = logging.ERROR, include_traceback: bool = False
) -> Dict[str, Any]:
    """Handle an error during tool execution, providing standardized logging and response.

    Args:
        func_name: Name of the function where the error occurred
        error: The exception that was raised
        log_level: Logging level to use (default: ERROR)
        include_traceback: Whether to include traceback in the log

    Returns:
        Error response suitable for returning from a tool
    """
    # Format the error message
    error_message = format_error_message(error)

    # Log the error
    if include_traceback:
        log_message = f"Error in {func_name}: {error_message}\n{traceback.format_exc()}"
    else:
        log_message = f"Error in {func_name}: {error_message}"

    logger.log(log_level, log_message)

    # Return standardized error response
    return {
        "success": False,
        "message": error_message,
        "error_type": error.__class__.__name__,
    }


def safe_execute(
    func_name: str,
    operation: Callable[..., T],
    error_handlers: Optional[Dict[Type[Exception], Callable[[Exception], Dict[str, Any]]]] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Safely execute an operation with standardized error handling.

    Args:
        func_name: Name of the function being executed
        operation: Function to execute
        error_handlers: Optional mapping of exception types to handler functions
        **kwargs: Arguments to pass to the operation

    Returns:
        Result of the operation or error response
    """
    try:
        # Execute the operation
        result = operation(**kwargs)

        # If the result is already a dict with a success key, return it
        if isinstance(result, dict) and "success" in result:
            return result

        # Otherwise, wrap it in a success response
        return {"success": True, "result": result}
    except Exception as e:
        # Check if we have a specific handler for this exception type
        if error_handlers:
            for exc_type, handler in error_handlers.items():
                if isinstance(e, exc_type):
                    return handler(e)

        # Fall back to default error handling
        return handle_tool_error(func_name, e)
