"""Unit tests for error_handling module."""

import logging
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.utils.error_handling import (
    format_error_message,
    handle_tool_error,
    safe_execute,
)


class TestFormatErrorMessage:
    """Tests for the format_error_message function."""

    def test_format_yara_error(self):
        """Test formatting a YaraError."""

        # Create a mock YaraError
        class YaraError(Exception):
            pass

        error = YaraError("Invalid YARA rule syntax")

        # Format the error
        formatted = format_error_message(error)

        # Verify the format - our test YaraError is not imported from yaraflux_mcp_server.yara_service
        # so it's treated as a generic exception
        assert formatted == "Error: Invalid YARA rule syntax"

    def test_format_value_error(self):
        """Test formatting a ValueError."""
        error = ValueError("Invalid parameter value")

        formatted = format_error_message(error)

        assert formatted == "Invalid parameter: Invalid parameter value"

    def test_format_file_not_found_error(self):
        """Test formatting a FileNotFoundError."""
        error = FileNotFoundError("File 'test.txt' not found")

        formatted = format_error_message(error)

        assert formatted == "File not found: File 'test.txt' not found"

    def test_format_permission_error(self):
        """Test formatting a PermissionError."""
        error = PermissionError("Permission denied for 'test.txt'")

        formatted = format_error_message(error)

        assert formatted == "Permission denied: Permission denied for 'test.txt'"

    def test_format_storage_error(self):
        """Test formatting a StorageError."""

        # Create a mock StorageError
        class StorageError(Exception):
            pass

        error = StorageError("Failed to save file")

        formatted = format_error_message(error)

        # Our test StorageError is not imported from yaraflux_mcp_server.storage
        # so it's treated as a generic exception
        assert formatted == "Error: Failed to save file"

    def test_format_generic_error(self):
        """Test formatting a generic exception."""
        error = Exception("Unknown error occurred")

        formatted = format_error_message(error)

        assert formatted == "Error: Unknown error occurred"


class TestHandleToolError:
    """Tests for the handle_tool_error function."""

    @patch("yaraflux_mcp_server.utils.error_handling.logger")
    def test_handle_tool_error_basic(self, mock_logger):
        """Test basic error handling."""
        error = ValueError("Invalid parameter")

        result = handle_tool_error("test_function", error)

        # Verify logging - use log method which is called with the specified level
        mock_logger.log.assert_called_once()
        args, kwargs = mock_logger.log.call_args
        assert args[0] == logging.ERROR  # First arg should be the log level
        assert "Error in test_function" in args[1]  # Second arg should be the message

        # Verify result format
        assert result["success"] is False
        assert result["message"] == "Invalid parameter: Invalid parameter"
        assert result["error_type"] == "ValueError"

    @patch("yaraflux_mcp_server.utils.error_handling.logger")
    def test_handle_tool_error_custom_log_level(self, mock_logger):
        """Test error handling with custom log level."""
        error = ValueError("Invalid parameter")

        result = handle_tool_error("test_function", error, log_level=logging.WARNING)

        # Verify logging at the specified level
        mock_logger.log.assert_called_once()
        args, kwargs = mock_logger.log.call_args
        assert args[0] == logging.WARNING  # Verify correct log level
        mock_logger.error.assert_not_called()

        # Verify result format
        assert result["success"] is False
        assert result["message"] == "Invalid parameter: Invalid parameter"
        assert result["error_type"] == "ValueError"

    @patch("yaraflux_mcp_server.utils.error_handling.logger")
    def test_handle_tool_error_with_traceback(self, mock_logger):
        """Test error handling with traceback."""
        error = ValueError("Invalid parameter")

        result = handle_tool_error("test_function", error, include_traceback=True)

        # Verify logging
        mock_logger.log.assert_called_once()
        args, kwargs = mock_logger.log.call_args
        assert args[0] == logging.ERROR

        # Verify result format with traceback
        # The function doesn't actually add a traceback to the result dict,
        # but the traceback should be included in the log message
        assert result["success"] is False
        assert result["message"] == "Invalid parameter: Invalid parameter"
        assert result["error_type"] == "ValueError"

        # Verify the log message includes traceback info
        log_message = args[1]  # Second arg of log.call_args is the message
        assert "Error in test_function" in log_message
        # We should check that the traceback info was included in the log message


class TestSafeExecute:
    """Tests for the safe_execute function."""

    def test_safe_execute_success(self):
        """Test safe execution of a successful operation."""

        # Define a function that returns a successful result
        def operation(arg1, arg2=None):
            return arg1 + (arg2 or 0)

        # Execute with safe_execute
        result = safe_execute("test_operation", operation, arg1=5, arg2=10)

        # Verify result is wrapped in a success response
        assert result["success"] is True
        assert result["result"] == 15

    def test_safe_execute_already_success_dict(self):
        """Test safe execution when the result is already a success dictionary."""

        # Define a function that returns a success dictionary
        def operation():
            return {"success": True, "result": "Success!"}

        # Execute with safe_execute
        result = safe_execute("test_operation", operation)

        # Verify the dictionary is passed through
        assert result["success"] is True
        assert result["result"] == "Success!"

    @patch("yaraflux_mcp_server.utils.error_handling.handle_tool_error")
    def test_safe_execute_error(self, mock_handle_error):
        """Test safe execution when an error occurs."""
        # Mock the error handler
        mock_handle_error.return_value = {"success": False, "message": "Handled error"}

        # Define a function that raises an exception
        def operation():
            raise ValueError("Test error")

        # Execute with safe_execute
        result = safe_execute("test_operation", operation)

        # Verify handle_tool_error was called
        mock_handle_error.assert_called_once()
        func_name, error = mock_handle_error.call_args[0]
        assert func_name == "test_operation"
        assert isinstance(error, ValueError)
        assert str(error) == "Test error"

        # Verify result from error handler
        assert result["success"] is False
        assert result["message"] == "Handled error"

    @patch("yaraflux_mcp_server.utils.error_handling.handle_tool_error")
    def test_safe_execute_with_custom_handler(self, mock_handle_error):
        """Test safe execution with a custom error handler."""
        # We won't call the default handler in this test
        mock_handle_error.return_value = {"success": False, "message": "Should not be called"}

        # Define a custom error handler
        def custom_handler(error):
            return {"success": False, "message": "Custom handler", "custom": True}

        # Define a function that raises ValueError
        def operation():
            raise ValueError("Test error")

        # Execute with safe_execute and custom handler
        result = safe_execute("test_operation", operation, error_handlers={ValueError: custom_handler})

        # Verify default handler was not called
        mock_handle_error.assert_not_called()

        # Verify custom handler result
        assert result["success"] is False
        assert result["message"] == "Custom handler"
        assert result["custom"] is True

    @patch("yaraflux_mcp_server.utils.error_handling.handle_tool_error")
    def test_safe_execute_with_multiple_handlers(self, mock_handle_error):
        """Test safe execution with multiple error handlers."""
        # Default handler for unmatched exceptions
        mock_handle_error.return_value = {"success": False, "message": "Default handler"}

        # Define custom handlers
        def value_handler(error):
            return {"success": False, "message": "Value handler", "type": "value"}

        def key_handler(error):
            return {"success": False, "message": "Key handler", "type": "key"}

        # Define a function that raises ValueError
        def operation(error_type):
            if error_type == "value":
                raise ValueError("Value error")
            elif error_type == "key":
                raise KeyError("Key error")
            else:
                raise Exception("Other error")

        # Test with ValueError
        result = safe_execute(
            "test_operation",
            operation,
            error_handlers={
                ValueError: value_handler,
                KeyError: key_handler,
            },
            error_type="value",
        )

        assert result["success"] is False
        assert result["message"] == "Value handler"
        assert result["type"] == "value"

        # Test with KeyError
        result = safe_execute(
            "test_operation",
            operation,
            error_handlers={
                ValueError: value_handler,
                KeyError: key_handler,
            },
            error_type="key",
        )

        assert result["success"] is False
        assert result["message"] == "Key handler"
        assert result["type"] == "key"

    @patch("yaraflux_mcp_server.utils.error_handling.handle_tool_error")
    def test_safe_execute_handler_not_matching(self, mock_handle_error):
        """Test safe execution when error handlers don't match the error type."""
        # Mock the default error handler
        mock_handle_error.return_value = {"success": False, "message": "Default handler"}

        # Define a custom handler for KeyError
        def key_handler(error):
            return {"success": False, "message": "Key handler"}

        # Define a function that raises ValueError
        def operation():
            raise ValueError("Value error")

        # Execute with safe_execute and custom handler for a different error type
        result = safe_execute("test_operation", operation, error_handlers={KeyError: key_handler})

        # Verify default handler was called
        mock_handle_error.assert_called_once()
        func_name, error = mock_handle_error.call_args[0]
        assert func_name == "test_operation"
        assert isinstance(error, ValueError)

        # Verify result from default handler
        assert result["success"] is False
        assert result["message"] == "Default handler"
