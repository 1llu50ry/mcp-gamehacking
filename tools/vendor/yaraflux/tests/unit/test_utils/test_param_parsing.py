"""Unit tests for param_parsing utilities."""

from typing import Dict, List, Optional, Union

import pytest

from yaraflux_mcp_server.utils.param_parsing import (
    convert_param_type,
    extract_typed_params,
    parse_and_validate_params,
    parse_params,
)


class TestParseParams:
    """Tests for parse_params function."""

    def test_empty_string(self):
        """Test with empty string returns empty dict."""
        assert parse_params("") == {}

    def test_none_string(self):
        """Test with None string returns empty dict."""
        assert parse_params(None) == {}

    def test_simple_key_value(self):
        """Test with simple key-value pairs."""
        params = parse_params("key1=value1&key2=value2")
        expected = {"key1": "value1", "key2": "value2"}
        assert params == expected

    def test_url_encoded_values(self):
        """Test with URL-encoded values."""
        params = parse_params("key1=value%20with%20spaces&key2=special%26chars")
        expected = {"key1": "value with spaces", "key2": "special&chars"}
        assert params == expected

    def test_missing_value(self):
        """Test with missing value defaults to empty string."""
        params = parse_params("key1=value1&key2=")
        expected = {"key1": "value1", "key2": ""}
        assert params == expected

    def test_invalid_params(self):
        """Test with invalid format raises ValueError."""
        try:
            parse_params("invalid-format")
        except ValueError:
            pytest.fail("parse_params raised ValueError unexpectedly!")


class TestConvertParamType:
    """Tests for convert_param_type function."""

    def test_convert_string(self):
        """Test converting to string."""
        assert convert_param_type("value", str) == "value"

    def test_convert_int(self):
        """Test converting to int."""
        assert convert_param_type("123", int) == 123

    def test_convert_float(self):
        """Test converting to float."""
        assert convert_param_type("123.45", float) == 123.45

    def test_convert_bool_true_values(self):
        """Test converting various true values to bool."""
        true_values = ["true", "True", "TRUE", "1", "yes", "Yes", "Y", "y"]
        for value in true_values:
            assert convert_param_type(value, bool) is True

    def test_convert_bool_false_values(self):
        """Test converting various false values to bool."""
        false_values = ["false", "False", "FALSE", "0", "no", "No", "N", "n", ""]
        for value in false_values:
            assert convert_param_type(value, bool) is False

    def test_convert_list_empty(self):
        """Test converting empty string to empty list."""
        assert convert_param_type("", List[str]) == []

    def test_convert_list_strings(self):
        """Test converting comma-separated values to list of strings."""
        assert convert_param_type("a,b,c", List[str]) == ["a", "b", "c"]

    def test_convert_list_ints(self):
        """Test converting comma-separated values to list of integers."""
        assert convert_param_type("1,2,3", List[int]) == [1, 2, 3]

    def test_convert_dict_json(self):
        """Test converting JSON string to dict."""
        json_str = '{"key1": "value1", "key2": 2}'
        result = convert_param_type(json_str, Dict[str, Union[str, int]])
        assert result == {"key1": "value1", "key2": 2}

    def test_convert_dict_invalid_json(self):
        """Test converting invalid JSON string to dict returns dict with value."""
        result = convert_param_type("invalid-json", Dict[str, str])
        assert result == {"value": "invalid-json"}

    def test_convert_optional_none(self):
        """Test converting empty string to None for Optional types."""
        assert convert_param_type("", Optional[str]) is None

    def test_convert_optional_value(self):
        """Test converting regular value for Optional types."""
        assert convert_param_type("value", Optional[str]) == "value"

    def test_convert_invalid_int(self):
        """Test converting invalid integer raises ValueError."""
        with pytest.raises(ValueError):
            convert_param_type("not-a-number", int)

    def test_convert_invalid_float(self):
        """Test converting invalid float raises ValueError."""
        with pytest.raises(ValueError):
            convert_param_type("not-a-float", float)

    def test_convert_unsupported_type(self):
        """Test converting to unsupported type returns original value."""

        class CustomType:
            pass

        assert convert_param_type("value", CustomType) == "value"


class TestExtractTypedParams:
    """Tests for extract_typed_params function."""

    def test_basic_extraction(self):
        """Test basic parameter extraction with correct types."""
        params = {"name": "test", "count": "5", "active": "true"}
        param_types = {"name": str, "count": int, "active": bool}

        result = extract_typed_params(params, param_types)
        expected = {"name": "test", "count": 5, "active": True}
        assert result == expected

    def test_with_defaults(self):
        """Test parameter extraction with defaults for missing values."""
        params = {"name": "test"}
        param_types = {"name": str, "count": int, "active": bool}
        defaults = {"count": 0, "active": False}

        result = extract_typed_params(params, param_types, defaults)
        expected = {"name": "test", "count": 0, "active": False}
        assert result == expected

    def test_missing_params(self):
        """Test parameter extraction with missing values and no defaults."""
        params = {"name": "test"}
        param_types = {"name": str, "count": int, "active": bool}

        result = extract_typed_params(params, param_types)
        expected = {"name": "test"}
        assert result == expected

    def test_none_values(self):
        """Test parameter extraction with None values."""
        params = {"name": "None", "count": "null"}
        param_types = {"name": Optional[str], "count": Optional[int]}

        result = extract_typed_params(params, param_types)
        expected = {"name": None, "count": None}
        assert result == expected

    def test_complex_types(self):
        """Test parameter extraction with complex types."""
        params = {"tags": "red,green,blue", "scores": "10,20,30", "metadata": '{"key1": "value1", "key2": 2}'}
        param_types = {"tags": List[str], "scores": List[int], "metadata": Dict[str, Union[str, int]]}

        result = extract_typed_params(params, param_types)
        expected = {"tags": ["red", "green", "blue"], "scores": [10, 20, 30], "metadata": {"key1": "value1", "key2": 2}}
        assert result == expected


class TestParseAndValidateParams:
    """Tests for parse_and_validate_params function."""

    def test_basic_validation(self):
        """Test basic parameter validation against schema."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer", "minimum": 0},
                "active": {"type": "boolean"},
            },
            "required": ["name"],
        }

        params = "name=test&count=5&active=true"
        result = parse_and_validate_params(params, schema)

        expected = {"name": "test", "count": 5, "active": True}
        assert result == expected

    def test_with_defaults(self):
        """Test parameter validation with defaults."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer", "default": 0},
                "active": {"type": "boolean", "default": False},
            },
            "required": ["name"],
        }

        params = "name=test"
        result = parse_and_validate_params(params, schema)

        expected = {"name": "test", "count": 0, "active": False}
        assert result == expected

    def test_missing_required(self):
        """Test validation fails with missing required parameters."""
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}, "count": {"type": "integer"}},
            "required": ["name", "count"],
        }

        params = "name=test"

        with pytest.raises(ValueError) as excinfo:
            parse_and_validate_params(params, schema)

        assert "count" in str(excinfo.value)

    def test_complex_schema(self):
        """Test validation with more complex schema."""
        schema = {
            "type": "object",
            "properties": {
                "tags": {"type": "array", "items": {"type": "string"}},
                "metadata": {"type": "object", "properties": {"key1": {"type": "string"}, "key2": {"type": "integer"}}},
            },
        }

        params = 'tags=a,b,c&metadata={"key1": "value1", "key2": 2}'
        result = parse_and_validate_params(params, schema)

        expected = {"tags": ["a", "b", "c"], "metadata": {"key1": "value1", "key2": 2}}
        assert result == expected

    def test_empty_params(self):
        """Test validation with empty parameters."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string", "default": "default_name"},
                "count": {"type": "integer", "default": 0},
            },
        }

        result = parse_and_validate_params("", schema)
        expected = {"name": "default_name", "count": 0}
        assert result == expected
