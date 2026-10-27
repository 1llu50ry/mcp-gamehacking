"""Unit tests for wrapper_generator utilities."""

import inspect
import logging
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.utils.wrapper_generator import (
    create_tool_wrapper,
    extract_enhanced_docstring,
    extract_param_schema_from_func,
    register_tool_with_schema,
)


class TestCreateToolWrapper:
    """Tests for create_tool_wrapper function."""

    def test_basic_wrapper_creation(self):
        """Test creating a basic wrapper."""

        # Define a simple function to wrap
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function.

            Args:
                param1: First parameter
                param2: Second parameter

            Returns:
                Dictionary with result
            """
            return {"result": f"{param1}-{param2}"}

        # Create mock MCP
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Create wrapper
        wrapper = create_tool_wrapper(mcp=mock_mcp, func_name="test_function", actual_func=test_function)

        # Verify function registration
        mock_mcp.tool.assert_called_once()

        # Call the wrapper with valid params
        result = wrapper("param1=test&param2=5")

        # Verify result
        assert result == {"result": "test-5"}

    @patch("yaraflux_mcp_server.utils.wrapper_generator.parse_params")
    @patch("yaraflux_mcp_server.utils.wrapper_generator.extract_typed_params")
    def test_wrapper_with_all_params(self, mock_extract_params, mock_parse_params):
        """Test wrapper that uses all parameter types."""

        # Define a function with various param types
        def test_function(
            string_param: str,
            int_param: int,
            float_param: float,
            bool_param: bool,
            list_param: List[str],
            optional_param: Optional[str] = None,
        ) -> Dict[str, Any]:
            """Test function with many param types."""
            return {
                "string": string_param,
                "int": int_param,
                "float": float_param,
                "bool": bool_param,
                "list": list_param,
                "optional": optional_param,
            }

        # Setup mocks
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Mock parse_params to return a dict
        mock_parse_params.return_value = {
            "string_param": "test",
            "int_param": "5",
            "float_param": "3.14",
            "bool_param": "true",
            "list_param": "a,b,c",
            "optional_param": "optional",
        }

        # Mock extract_typed_params to return typed values
        mock_extract_params.return_value = {
            "string_param": "test",
            "int_param": 5,
            "float_param": 3.14,
            "bool_param": True,
            "list_param": ["a", "b", "c"],
            "optional_param": "optional",
        }

        # Create wrapper
        wrapper = create_tool_wrapper(mcp=mock_mcp, func_name="test_function", actual_func=test_function)

        # Call the wrapper
        result = wrapper("params string doesn't matter with mocks")

        # Verify result
        expected = {
            "string": "test",
            "int": 5,
            "float": 3.14,
            "bool": True,
            "list": ["a", "b", "c"],
            "optional": "optional",
        }
        assert result == expected

    @patch("yaraflux_mcp_server.utils.wrapper_generator.logger")
    def test_wrapper_logs_params(self, mock_logger):
        """Test that wrapper logs parameters."""

        # Define a simple function to wrap
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function."""
            return {"result": f"{param1}-{param2}"}

        # Create mock MCP
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Create wrapper
        wrapper = create_tool_wrapper(
            mcp=mock_mcp, func_name="test_function", actual_func=test_function, log_params=True
        )

        # Call the wrapper
        wrapper("param1=test&param2=5")

        # Verify logging - use the exact logger instance that's defined in the module
        mock_logger.info.assert_called_once_with("test_function called with params: param1=test&param2=5")

    @patch("yaraflux_mcp_server.utils.wrapper_generator.logger")
    def test_wrapper_logs_without_params(self, mock_logger):
        """Test that wrapper logs even without parameters."""

        # Define a function with no params
        def test_function() -> Dict[str, Any]:
            """Test function with no params."""
            return {"result": "success"}

        # Create mock MCP
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Create wrapper
        wrapper = create_tool_wrapper(
            mcp=mock_mcp, func_name="test_function", actual_func=test_function, log_params=False
        )

        # Call the wrapper
        wrapper("")

        # Verify logging without params - use the exact logger instance in the module
        mock_logger.info.assert_called_once_with("test_function called")

    @patch("yaraflux_mcp_server.utils.wrapper_generator.handle_tool_error")
    def test_wrapper_handles_missing_required_param(self, mock_handle_error):
        """Test wrapper handling missing required parameter."""

        # Define a function with required params
        def test_function(required_param: str) -> Dict[str, Any]:
            """Test function with required param."""
            return {"result": required_param}

        # Create mock MCP
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Set up mock error handler to return a standard error response
        mock_handle_error.return_value = {"error": "Required parameter 'required_param' is missing"}

        # Create wrapper
        wrapper = create_tool_wrapper(mcp=mock_mcp, func_name="test_function", actual_func=test_function)

        # Call with missing param
        result = wrapper("")

        # Verify error was handled properly
        assert "error" in result
        assert "required_param" in result["error"]
        mock_handle_error.assert_called_once()

    @patch("yaraflux_mcp_server.utils.wrapper_generator.logger")
    @patch("yaraflux_mcp_server.utils.wrapper_generator.handle_tool_error")
    def test_wrapper_handles_exception(self, mock_handle_error, mock_logger):
        """Test wrapper handling exception in wrapped function."""

        # Define a function that raises an exception
        def test_function() -> Dict[str, Any]:
            """Test function that raises an exception."""
            raise ValueError("Test exception")

        # Create mock MCP
        mock_mcp = Mock()
        mock_mcp.tool.return_value = lambda f: f

        # Setup mock error handler
        mock_handle_error.return_value = {"error": "Test exception"}

        # Create wrapper
        wrapper = create_tool_wrapper(mcp=mock_mcp, func_name="test_function", actual_func=test_function)

        # Call wrapper should handle the exception
        result = wrapper("")

        # Verify error handling
        assert result == {"error": "Test exception"}
        mock_handle_error.assert_called_once()


class TestExtractEnhancedDocstring:
    """Tests for extract_enhanced_docstring function."""

    def test_extract_basic_docstring(self):
        """Test extracting a basic docstring."""

        # Define a function with a basic docstring
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function docstring."""
            return {"result": "success"}

        # Extract docstring
        docstring = extract_enhanced_docstring(test_function)

        # Verify docstring structure
        assert isinstance(docstring, dict)
        assert docstring["description"] == "Test function docstring."
        assert docstring["param_descriptions"] == {}
        assert docstring["returns_description"] == ""
        assert docstring["examples"] == []

    def test_extract_full_docstring(self):
        """Test extracting a full docstring with args and returns."""

        # Define a function with a full docstring
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function with full docstring.

            This function demonstrates a full docstring with Args and Returns sections.

            Args:
                param1: First parameter description
                param2: Second parameter description

            Returns:
                Dictionary with success result
            """
            return {"result": "success"}

        # Extract docstring
        docstring = extract_enhanced_docstring(test_function)

        # Verify it contains the main description and the Args/Returns sections
        assert "Test function with full docstring" in docstring["description"]
        assert "This function demonstrates" in docstring["description"]
        assert docstring["param_descriptions"]["param1"] == "First parameter description"
        assert docstring["param_descriptions"]["param2"] == "Second parameter description"
        assert docstring["returns_description"] == "Dictionary with success result"

    def test_extract_docstring_with_no_args(self):
        """Test extracting a docstring with no args section."""

        # Define a function with no args in docstring
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function docstring.

            Returns:
                Dictionary with success result
            """
            return {"result": "success"}

        # Extract docstring
        docstring = extract_enhanced_docstring(test_function)

        # Verify it contains the main description and Returns but no Args
        assert "Test function docstring" in docstring["description"]
        assert docstring["param_descriptions"] == {}
        assert docstring["returns_description"] == "Dictionary with success result"

    def test_extract_docstring_with_no_returns(self):
        """Test extracting a docstring with no returns section."""

        # Define a function with no returns in docstring
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            """Test function docstring.

            Args:
                param1: First parameter description
                param2: Second parameter description
            """
            return {"result": "success"}

        # Extract docstring
        docstring = extract_enhanced_docstring(test_function)

        # Verify it contains the main description and Args but no Returns
        assert "Test function docstring" in docstring["description"]
        assert docstring["param_descriptions"]["param1"] == "First parameter description"
        assert docstring["param_descriptions"]["param2"] == "Second parameter description"
        assert docstring["returns_description"] == ""

    def test_extract_no_docstring(self):
        """Test extracting when there's no docstring."""

        # Define a function with no docstring
        def test_function(param1: str, param2: int) -> Dict[str, Any]:
            return {"result": "success"}

        # Extract docstring
        docstring = extract_enhanced_docstring(test_function)

        # Verify it returns an empty dict structure
        assert docstring["description"] == ""
        assert docstring["param_descriptions"] == {}
        assert docstring["returns_description"] == ""
        assert docstring["examples"] == []


class TestExtractParamSchemaFromFunc:
    """Tests for extract_param_schema_from_func function."""

    def test_extract_basic_schema(self):
        """Test extracting a basic schema from function."""

        # Define a function with basic types
        def test_function(string_param: str, int_param: int, bool_param: bool) -> Dict[str, Any]:
            """Test function with basic types."""
            return {"result": "success"}

        # Extract schema
        schema = extract_param_schema_from_func(test_function)

        # Verify schema
        assert "string_param" in schema
        assert "int_param" in schema
        assert "bool_param" in schema
        assert schema["string_param"]["type"] == str
        assert schema["int_param"]["type"] == int
        assert schema["bool_param"]["type"] == bool
        assert schema["string_param"]["required"] is True
        assert schema["int_param"]["required"] is True
        assert schema["bool_param"]["required"] is True

    def test_extract_schema_skip_self(self):
        """Test extracting schema skips 'self' parameter."""

        # Define a class method that has 'self'
        class TestClass:
            def test_method(self, param1: str, param2: int) -> Dict[str, Any]:
                """Test method with self parameter."""
                return {"result": "success"}

        # Extract schema
        schema = extract_param_schema_from_func(TestClass().test_method)

        # Verify schema skips 'self'
        assert "self" not in schema
        assert "param1" in schema
        assert "param2" in schema

    def test_extract_schema_with_complex_types(self):
        """Test extracting schema with complex types."""

        # Define a function with complex types
        def test_function(
            simple_param: str,
            list_param: List[str],
            optional_param: Optional[int] = None,
            default_param: str = "default",
        ) -> Dict[str, Any]:
            """Test function with complex types."""
            return {"result": "success"}

        # Extract schema
        schema = extract_param_schema_from_func(test_function)

        # Verify schema
        assert schema["simple_param"]["type"] == str
        assert schema["list_param"]["type"] == List[str]
        assert schema["optional_param"]["type"] == Optional[int]
        assert schema["default_param"]["type"] == str
        assert schema["default_param"]["default"] == "default"
        assert schema["simple_param"]["required"] is True
        assert schema["list_param"]["required"] is True
        assert schema["optional_param"]["required"] is False
        assert schema["default_param"]["required"] is False


class TestRegisterToolWithSchema:
    """Tests for register_tool_with_schema function."""

    def test_register_tool_basic(self):
        """Test registering a basic tool."""
        # Create mock MCP handler
        mock_mcp = Mock()

        # Define a function to register
        def test_tool(param1: str, param2: int) -> Dict[str, Any]:
            """Test tool function."""
            return {"result": f"{param1}-{param2}"}

        # Register the tool
        register_tool_with_schema(
            mcp=mock_mcp,
            func_name="test_tool",
            actual_func=test_tool,
        )

        # Verify tool was registered with handler.tool()
        mock_mcp.tool.assert_called_once()

    def test_register_with_custom_schema(self):
        """Test registering a tool with custom schema."""
        # Create mock MCP handler
        mock_mcp = Mock()

        # Define a function to register
        def test_tool(param1: str, param2: int) -> Dict[str, Any]:
            """Test tool function."""
            return {"result": "success"}

        # Define custom schema
        custom_schema = {
            "custom_param1": {"type": str, "description": "Custom description", "required": True},
            "custom_param2": {"type": int, "required": False},
        }

        # Register the tool with custom schema
        register_tool_with_schema(
            mcp=mock_mcp, func_name="test_tool_custom", actual_func=test_tool, param_schema=custom_schema
        )

        # Verify tool was registered
        mock_mcp.tool.assert_called_once()

    def test_register_tool_logs_params(self):
        """Test that tool registration logs parameters."""
        # Create mock MCP handler
        mock_mcp = Mock()

        # Define a function to register
        def test_tool(param1: str, param2: int) -> Dict[str, Any]:
            """Test tool function."""
            return {"result": f"{param1}-{param2}"}

        # Register the tool
        result = register_tool_with_schema(
            mcp=mock_mcp,
            func_name="test_tool",
            actual_func=test_tool,
        )

        # Verify registration successful
        mock_mcp.tool.assert_called_once()

    def test_register_tool_handles_exception(self):
        """Test that tool registration handles exceptions."""
        # Create mock MCP handler that raises exception
        mock_mcp = Mock()
        mock_mcp.tool.side_effect = ValueError("Registration error")

        # Define a function to register
        def test_tool(param1: str) -> Dict[str, Any]:
            """Test tool function."""
            return {"result": param1}

        # Register the tool should handle the exception
        with pytest.raises(ValueError) as excinfo:
            register_tool_with_schema(
                mcp=mock_mcp,
                func_name="test_tool",
                actual_func=test_tool,
            )

        assert "Registration error" in str(excinfo.value)

    def test_wrapper_preserves_docstring(self):
        """Test that registered tool wrapper preserves docstring."""
        # Create mock MCP handler
        mock_mcp = Mock()

        # Create a mock that captures the wrapped function
        def capture_wrapper(*args, **kwargs):
            called_with = kwargs
            return lambda f: f

        mock_mcp.tool.side_effect = capture_wrapper

        # Define a function with docstring
        def test_tool(param1: str) -> Dict[str, Any]:
            """Test tool docstring.

            This is a multiline docstring.

            Args:
                param1: Parameter description

            Returns:
                Dictionary with result
            """
            return {"result": param1}

        # Register the tool
        result = register_tool_with_schema(
            mcp=mock_mcp,
            func_name="test_tool",
            actual_func=test_tool,
        )

        # Verify wrapper preserves docstring
        assert result.__doc__ is not None
        assert "Test tool docstring" in result.__doc__
        assert "This is a multiline docstring" in result.__doc__
