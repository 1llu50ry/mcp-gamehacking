"""Fixed tests for rule tools to improve coverage."""

import json
from unittest.mock import MagicMock, Mock, patch

import pytest
from fastapi import HTTPException

from yaraflux_mcp_server.mcp_tools.rule_tools import (
    add_yara_rule,
    delete_yara_rule,
    get_yara_rule,
    import_threatflux_rules,
    list_yara_rules,
    update_yara_rule,
    validate_yara_rule,
)
from yaraflux_mcp_server.yara_service import YaraError


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_list_yara_rules_success(mock_yara_service):
    """Test list_yara_rules successfully returns rules."""
    # Setup mocks
    rule1 = Mock()
    rule1.model_dump.return_value = {"name": "rule1.yar", "source": "custom"}
    rule2 = Mock()
    rule2.model_dump.return_value = {"name": "rule2.yar", "source": "community"}
    mock_yara_service.list_rules.return_value = [rule1, rule2]

    # Call the function (without filters)
    result = list_yara_rules()

    # Verify results
    assert len(result) == 2
    assert {"name": "rule1.yar", "source": "custom"} in result
    assert {"name": "rule2.yar", "source": "community"} in result

    # Verify mocks were called correctly
    mock_yara_service.list_rules.assert_called_once_with(None)


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_list_yara_rules_filtered(mock_yara_service):
    """Test list_yara_rules with source filtering."""
    # Setup mocks
    rule1 = Mock()
    rule1.model_dump.return_value = {"name": "rule1.yar", "source": "custom"}
    rule2 = Mock()
    rule2.model_dump.return_value = {"name": "rule2.yar", "source": "custom"}
    mock_yara_service.list_rules.return_value = [rule1, rule2]

    # Call the function with source filter
    result = list_yara_rules("custom")

    # Verify results
    assert len(result) == 2

    # Verify mocks were called correctly
    mock_yara_service.list_rules.assert_called_once_with("custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_list_yara_rules_all_source(mock_yara_service):
    """Test list_yara_rules with 'all' source."""
    # Setup mocks
    rule1 = Mock()
    rule1.model_dump.return_value = {"name": "rule1.yar", "source": "custom"}
    rule2 = Mock()
    rule2.model_dump.return_value = {"name": "rule2.yar", "source": "community"}
    mock_yara_service.list_rules.return_value = [rule1, rule2]

    # Call the function with 'all' source
    result = list_yara_rules("all")

    # Verify results
    assert len(result) == 2

    # Verify mocks were called correctly
    mock_yara_service.list_rules.assert_called_once_with(None)


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_list_yara_rules_error(mock_yara_service):
    """Test list_yara_rules with an error."""
    # Setup mock to raise an exception
    mock_yara_service.list_rules.side_effect = Exception("Test error")

    # Call the function
    result = list_yara_rules()

    # Verify results
    assert result == []


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_get_yara_rule_success(mock_yara_service):
    """Test get_yara_rule successfully retrieves a rule."""
    # Setup mocks
    mock_yara_service.get_rule.return_value = "rule test { condition: true }"
    rule = Mock()
    rule.name = "test.yar"
    rule.model_dump.return_value = {"name": "test.yar", "source": "custom"}
    mock_yara_service.list_rules.return_value = [rule]

    # Call the function
    result = get_yara_rule(rule_name="test.yar", source="custom")

    # Verify results
    assert result["success"] is True
    assert result["result"]["name"] == "test.yar"
    assert result["result"]["source"] == "custom"
    assert result["result"]["content"] == "rule test { condition: true }"
    assert result["result"]["metadata"] == {"name": "test.yar", "source": "custom"}

    # Verify mocks were called correctly
    mock_yara_service.get_rule.assert_called_once_with("test.yar", "custom")
    mock_yara_service.list_rules.assert_called_once_with("custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_get_yara_rule_invalid_source(mock_yara_service):
    """Test get_yara_rule with invalid source."""
    # Call the function with invalid source
    result = get_yara_rule(rule_name="test.yar", source="invalid")

    # Verify results
    assert result["success"] is False
    assert "Invalid source" in result["message"]

    # Verify mock was not called
    mock_yara_service.get_rule.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_get_yara_rule_no_metadata(mock_yara_service):
    """Test get_yara_rule with no matching metadata."""
    # Setup mocks
    mock_yara_service.get_rule.return_value = "rule test { condition: true }"
    rule = Mock()
    rule.name = "other_rule.yar"
    rule.model_dump.return_value = {"name": "other_rule.yar", "source": "custom"}
    mock_yara_service.list_rules.return_value = [rule]  # Different rule name

    # Call the function
    result = get_yara_rule(rule_name="test.yar", source="custom")

    # Verify results
    assert result["success"] is True
    assert result["result"]["name"] == "test.yar"
    assert result["result"]["metadata"] == {}  # No metadata found

    # Verify mocks were called correctly
    mock_yara_service.get_rule.assert_called_once_with("test.yar", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_get_yara_rule_error(mock_yara_service):
    """Test get_yara_rule with error."""
    # Setup mock to raise an exception
    mock_yara_service.get_rule.side_effect = YaraError("Rule not found")

    # Call the function
    result = get_yara_rule(rule_name="test.yar", source="custom")

    # Verify results
    assert result["success"] is False
    assert "Rule not found" in result["message"]
    assert result["name"] == "test.yar"
    assert result["source"] == "custom"


@patch("builtins.__import__")
def test_validate_yara_rule_valid(mock_import):
    """Test validate_yara_rule with valid rule."""
    # Setup mock for the yara import
    mock_yara_module = Mock()
    mock_import.return_value = mock_yara_module

    # Call the function
    result = validate_yara_rule(content="rule test { condition: true }")

    # Verify results
    assert "valid" in result
    assert result["valid"] is True
    assert result["message"] == "Rule is valid"


@patch("builtins.__import__")
def test_validate_yara_rule_invalid(mock_import):
    """Test validate_yara_rule with invalid rule."""
    # Setup mocks for the yara import to raise an exception
    mock_yara_module = Mock()
    mock_yara_module.compile.side_effect = Exception('line 1: undefined identifier "invalid"')
    mock_import.return_value = mock_yara_module

    # Call the function
    result = validate_yara_rule(content="rule test { condition: invalid }")

    # Verify results
    assert "valid" in result
    assert result["valid"] is False
    assert "undefined identifier" in result["message"]
    assert result["error_type"] == "YaraError"


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_add_yara_rule_success(mock_yara_service):
    """Test add_yara_rule successfully adds a rule."""
    # Setup mock
    metadata = Mock()
    metadata.model_dump.return_value = {"name": "test.yar", "source": "custom"}
    mock_yara_service.add_rule.return_value = metadata

    # Call the function
    result = add_yara_rule(name="test.yar", content="rule test { condition: true }", source="custom")

    # Verify results
    assert result["success"] is True
    assert "added successfully" in result["message"]
    assert result["metadata"] == {"name": "test.yar", "source": "custom"}

    # Verify mock was called correctly
    mock_yara_service.add_rule.assert_called_once_with("test.yar", "rule test { condition: true }", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_add_yara_rule_adds_extension(mock_yara_service):
    """Test add_yara_rule adds .yar extension if missing."""
    # Setup mock
    metadata = Mock()
    metadata.model_dump.return_value = {"name": "test.yar", "source": "custom"}
    mock_yara_service.add_rule.return_value = metadata

    # Call the function without .yar extension
    result = add_yara_rule(name="test", content="rule test { condition: true }", source="custom")  # No .yar extension

    # Verify results
    assert result["success"] is True

    # Verify mock was called with .yar extension
    mock_yara_service.add_rule.assert_called_once_with("test.yar", "rule test { condition: true }", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_add_yara_rule_invalid_source(mock_yara_service):
    """Test add_yara_rule with invalid source."""
    # Call the function with invalid source
    result = add_yara_rule(name="test.yar", content="rule test { condition: true }", source="invalid")

    # Verify results
    assert result["success"] is False
    assert "Invalid source" in result["message"]

    # Verify mock was not called
    mock_yara_service.add_rule.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_add_yara_rule_empty_content(mock_yara_service):
    """Test add_yara_rule with empty content."""
    # Call the function with empty content
    result = add_yara_rule(name="test.yar", content="   ", source="custom")  # Empty after strip

    # Verify results
    assert result["success"] is False
    assert "content cannot be empty" in result["message"]

    # Verify mock was not called
    mock_yara_service.add_rule.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_add_yara_rule_error(mock_yara_service):
    """Test add_yara_rule with error."""
    # Setup mock to raise an exception
    mock_yara_service.add_rule.side_effect = YaraError("Compilation error")

    # Call the function
    result = add_yara_rule(name="test.yar", content="rule test { condition: true }", source="custom")

    # Verify results
    assert result["success"] is False
    assert "Compilation error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_update_yara_rule_success(mock_yara_service):
    """Test update_yara_rule successfully updates a rule."""
    # Setup mocks
    metadata = Mock()
    metadata.model_dump.return_value = {"name": "test.yar", "source": "custom"}
    mock_yara_service.update_rule.return_value = metadata

    # Call the function
    result = update_yara_rule(name="test.yar", content="rule test { condition: true }", source="custom")

    # Verify results
    assert result["success"] is True
    assert "updated successfully" in result["message"]
    assert result["metadata"] == {"name": "test.yar", "source": "custom"}

    # Verify mocks were called correctly
    mock_yara_service.get_rule.assert_called_once_with("test.yar", "custom")
    mock_yara_service.update_rule.assert_called_once_with("test.yar", "rule test { condition: true }", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_update_yara_rule_not_found(mock_yara_service):
    """Test update_yara_rule with rule not found."""
    # Setup mock to raise an exception
    mock_yara_service.get_rule.side_effect = YaraError("Rule not found")

    # Call the function
    result = update_yara_rule(name="test.yar", content="rule test { condition: true }", source="custom")

    # Verify results
    assert result["success"] is False
    assert "Rule not found" in result["message"]

    # Verify only get_rule was called, not update_rule
    mock_yara_service.get_rule.assert_called_once_with("test.yar", "custom")
    mock_yara_service.update_rule.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_delete_yara_rule_success(mock_yara_service):
    """Test delete_yara_rule successfully deletes a rule."""
    # Setup mock
    mock_yara_service.delete_rule.return_value = True

    # Call the function
    result = delete_yara_rule(name="test.yar", source="custom")

    # Verify results
    assert result["success"] is True
    assert "deleted successfully" in result["message"]

    # Verify mock was called correctly
    mock_yara_service.delete_rule.assert_called_once_with("test.yar", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_delete_yara_rule_not_found(mock_yara_service):
    """Test delete_yara_rule with rule not found."""
    # Setup mock
    mock_yara_service.delete_rule.return_value = False

    # Call the function
    result = delete_yara_rule(name="test.yar", source="custom")

    # Verify results
    assert result["success"] is False
    assert "not found" in result["message"]

    # Verify mock was called correctly
    mock_yara_service.delete_rule.assert_called_once_with("test.yar", "custom")


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_delete_yara_rule_error(mock_yara_service):
    """Test delete_yara_rule with error."""
    # Setup mock to raise an exception
    mock_yara_service.delete_rule.side_effect = YaraError("Permission denied")

    # Call the function
    result = delete_yara_rule(name="test.yar", source="custom")

    # Verify results
    assert result["success"] is False
    assert "Permission denied" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.httpx")
@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_import_threatflux_rules_success(mock_yara_service, mock_httpx):
    """Test import_threatflux_rules successfully imports rules."""
    # Setup mock test response
    mock_test_response = MagicMock()
    mock_test_response.status_code = 200

    # Setup mock index response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"rules": ["rule1.yar", "rule2.yar"]}

    # Setup mock response for rule files
    mock_rule_response = MagicMock()
    mock_rule_response.status_code = 200
    mock_rule_response.text = "rule test { condition: true }"

    # Configure httpx mock to return different responses for different calls
    mock_httpx.get.side_effect = [mock_test_response, mock_response, mock_rule_response, mock_rule_response]

    # Call the function
    result = import_threatflux_rules()

    # Verify results
    assert result["success"] is True
    # Verify yara_service was called
    assert mock_yara_service.add_rule.call_count >= 1
    mock_yara_service.load_rules.assert_called_once()


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.httpx")
@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_import_threatflux_rules_with_custom_url(mock_yara_service, mock_httpx):
    """Test import_threatflux_rules with custom URL."""
    # Setup mock test response
    mock_test_response = MagicMock()
    mock_test_response.status_code = 200

    # Setup mock response for index.json
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"rules": ["rule1.yar"]}

    # Setup mock response for rule file
    mock_rule_response = MagicMock()
    mock_rule_response.status_code = 200
    mock_rule_response.text = "rule test { condition: true }"

    # Configure httpx mock to return different responses
    mock_httpx.get.side_effect = [mock_test_response, mock_response, mock_rule_response]

    # Call the function with custom URL
    result = import_threatflux_rules(url="https://github.com/custom/repo")

    # Verify results
    assert result["success"] is True

    # Verify connection test was made first
    mock_httpx.get.assert_any_call("https://raw.githubusercontent.com/custom/repo", timeout=10)


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.httpx")
@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_import_threatflux_rules_no_index(mock_yara_service, mock_httpx):
    """Test import_threatflux_rules with no index.json."""
    # Setup initial test response (success)
    mock_test_response = MagicMock()
    mock_test_response.status_code = 200

    # Setup mock response for index.json (not found)
    mock_response = MagicMock()
    mock_response.status_code = 404

    # Setup mock response for rule file
    mock_rule_response = MagicMock()
    mock_rule_response.status_code = 200
    mock_rule_response.text = "rule test { condition: true }"

    # Configure httpx mock to return different responses
    # First 200 for test, then 404 for index, then a few 200s for rule files
    mock_httpx.get.side_effect = [mock_test_response, mock_response, mock_rule_response, mock_rule_response]

    # Call the function
    result = import_threatflux_rules()

    # Still should successfully import some rules
    assert result["success"] is True


@patch("yaraflux_mcp_server.mcp_tools.rule_tools.httpx")
@patch("yaraflux_mcp_server.mcp_tools.rule_tools.yara_service")
def test_import_threatflux_rules_error(mock_yara_service, mock_httpx):
    """Test import_threatflux_rules with error."""
    # Setup httpx to raise an exception for the first get call
    mock_httpx.get.side_effect = Exception("Connection error")

    # Call the function
    result = import_threatflux_rules()

    # Verify results - with our new connection test implementation
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Connection error" in result["message"]
    assert "error" in result
