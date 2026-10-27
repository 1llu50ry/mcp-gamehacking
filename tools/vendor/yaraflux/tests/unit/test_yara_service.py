"""Unit tests for the YARA service module."""

import hashlib
import os
import tempfile
from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, patch

import httpx
import pytest
import yara

from yaraflux_mcp_server.models import YaraMatch, YaraRuleMetadata, YaraScanResult
from yaraflux_mcp_server.storage import StorageError
from yaraflux_mcp_server.yara_service import YaraError, YaraService, yara_service


class MockYaraMatch:
    """Mock YARA match for testing."""

    def __init__(self, rule="test_rule", namespace="default", tags=None, meta=None):
        self.rule = rule
        self.namespace = namespace
        self.tags = tags or []
        self.meta = meta or {}
        self.strings = []


# Basic YaraService tests that don't need mocking
def test_init():
    """Test YaraService initialization."""
    # Get the singleton instance
    service = yara_service

    # Check that it's initialized properly
    assert service is not None
    # Don't assert empty cache or callbacks as other tests may have populated them
    assert hasattr(service, "_rules_cache")
    assert isinstance(service._rules_cache, dict)
    assert hasattr(service, "_rule_include_callbacks")
    assert isinstance(service._rule_include_callbacks, dict)


@patch("yaraflux_mcp_server.yara_service.YaraService._compile_rule")
def test_add_rule(mock_compile_rule):
    """Test adding a YARA rule."""
    # Setup
    rule_name = "test_rule.yar"
    rule_content = """
    rule TestRule {
        meta:
            description = "Test rule"
        strings:
            $test = "test string"
        condition:
            $test
    }
    """

    # Mock the compiled rule (we're mocking the internal _compile_rule method)
    mock_compile_rule.return_value = MagicMock()

    # Create a temporary storage mock and initialize a service instance
    storage_mock = MagicMock()
    service_instance = YaraService(storage_client=storage_mock)

    # Act: Add the rule
    metadata = service_instance.add_rule(rule_name, rule_content, "custom")

    # Assert: Verify that storage.save_rule was called and metadata is correct
    storage_mock.save_rule.assert_called_once_with(rule_name, rule_content, "custom")
    assert isinstance(metadata, YaraRuleMetadata)
    assert metadata.name == rule_name
    assert metadata.source == "custom"


@patch("yaraflux_mcp_server.yara_service.YaraService._compile_rule")
def test_update_rule(mock_compile_rule):
    """Test updating a YARA rule."""
    # Setup
    rule_name = "update_rule.yar"
    rule_content = "rule UpdateRule { condition: true }"

    # Create a storage mock that will return a rule when get_rule is called
    storage_mock = MagicMock()
    storage_mock.get_rule.return_value = "old content"

    # Mock the internal compile method
    mock_compile_rule.return_value = MagicMock()

    # Create a service instance with our mock
    service_instance = YaraService(storage_client=storage_mock)

    # Add a rule to cache to test cache clearing
    service_instance._rules_cache["custom:update_rule.yar"] = MagicMock()

    # Act: Update the rule
    metadata = service_instance.update_rule(rule_name, rule_content, "custom")

    # Assert
    storage_mock.get_rule.assert_called_once_with(rule_name, "custom")
    storage_mock.save_rule.assert_called_once_with(rule_name, rule_content, "custom")
    assert isinstance(metadata, YaraRuleMetadata)
    assert metadata.name == rule_name
    assert metadata.source == "custom"
    assert metadata.modified is not None
    # Check cache was cleared
    assert "custom:update_rule.yar" not in service_instance._rules_cache


@patch("yaraflux_mcp_server.yara_service.YaraService._compile_rule")
def test_update_rule_not_found(mock_compile_rule):
    """Test updating a rule that doesn't exist."""
    # Setup
    rule_name = "nonexistent_rule.yar"
    rule_content = "rule Test { condition: true }"

    # Create storage mock that raises StorageError when get_rule is called
    storage_mock = MagicMock()
    storage_mock.get_rule.side_effect = StorageError("Rule not found")

    # Create service instance with our mock
    service_instance = YaraService(storage_client=storage_mock)

    # Act & Assert: Updating a non-existent rule should raise YaraError
    with pytest.raises(YaraError) as exc_info:
        service_instance.update_rule(rule_name, rule_content, "custom")

    assert "Rule not found" in str(exc_info.value)


def test_delete_rule():
    """Test deleting a YARA rule."""
    # Setup
    rule_name = "delete_rule.yar"
    source = "custom"

    # Create storage mock
    storage_mock = MagicMock()
    storage_mock.delete_rule.return_value = True

    # Create service instance
    service_instance = YaraService(storage_client=storage_mock)

    # Add a rule to the cache
    service_instance._rules_cache[f"{source}:{rule_name}"] = MagicMock()

    # Act: Delete the rule
    result = service_instance.delete_rule(rule_name, source)

    # Assert
    assert result is True
    storage_mock.delete_rule.assert_called_once_with(rule_name, source)
    assert f"{source}:{rule_name}" not in service_instance._rules_cache


def test_get_rule():
    """Test getting a YARA rule's content."""
    # Setup
    rule_name = "get_rule.yar"
    rule_content = "rule GetRule { condition: true }"
    source = "custom"

    # Create storage mock
    storage_mock = MagicMock()
    storage_mock.get_rule.return_value = rule_content

    # Create service instance
    service_instance = YaraService(storage_client=storage_mock)

    # Act: Get the rule
    result = service_instance.get_rule(rule_name, source)

    # Assert
    assert result == rule_content
    storage_mock.get_rule.assert_called_once_with(rule_name, source)


def test_list_rules():
    """Test listing YARA rules."""
    # Setup
    # Create list of rule metadata
    rule_list = [
        {
            "name": "rule1.yar",
            "source": "custom",
            "created": datetime.now(UTC),
        },
        {
            "name": "rule2.yar",
            "source": "community",
            "created": datetime.now(UTC),
        },
    ]

    # Create storage mock
    storage_mock = MagicMock()
    storage_mock.list_rules.return_value = rule_list

    # Create service instance
    service_instance = YaraService(storage_client=storage_mock)
    service_instance._rules_cache = {
        "custom:rule1.yar": MagicMock(),
        "community:all": MagicMock(),
    }

    # Act: List rules
    all_rules = service_instance.list_rules()

    # Assert
    assert len(all_rules) == 2
    assert all_rules[0].name == "rule1.yar"
    assert all_rules[0].source == "custom"
    assert all_rules[0].is_compiled is True  # Should be True because it's in the cache
    assert all_rules[1].name == "rule2.yar"
    assert all_rules[1].source == "community"
    # Community rules are compiled if community:all is in the cache
    assert all_rules[1].is_compiled is True


@patch("yara.compile")
@patch("yaraflux_mcp_server.yara_service.YaraService._collect_rules")
def test_match_file(mock_collect_rules, mock_compile):
    """Test matching YARA rules against a file."""
    # Setup
    # Create a temp file
    with tempfile.NamedTemporaryFile(delete=False) as temp_file:
        temp_file.write(b"Test file content")
        file_path = temp_file.name

    try:
        # Create mock rules
        mock_rule = MagicMock()
        mock_rule.match.return_value = [MockYaraMatch(rule="test_rule", tags=["test"], meta={"description": "Test"})]
        mock_collect_rules.return_value = [mock_rule]

        # Create storage mock
        storage_mock = MagicMock()

        # Create service instance
        service_instance = YaraService(storage_client=storage_mock)

        # Act: Match the file
        result = service_instance.match_file(file_path)

        # Assert
        assert isinstance(result, YaraScanResult)
        assert result.file_name == os.path.basename(file_path)
        assert len(result.matches) == 1
        assert result.matches[0].rule == "test_rule"
        assert "test" in result.matches[0].tags

        # Check the rule was called correctly
        mock_rule.match.assert_called_once()
        # The file path should be passed in instead of filepath
        args, kwargs = mock_rule.match.call_args
        assert file_path in args or file_path == kwargs.get("filepath")
        assert "timeout" in kwargs
    finally:
        # Clean up temp file
        if os.path.exists(file_path):
            os.unlink(file_path)


@patch("yara.compile")
@patch("yaraflux_mcp_server.yara_service.YaraService._collect_rules")
def test_match_data(mock_collect_rules, mock_compile):
    """Test matching YARA rules against in-memory data."""
    # Setup
    # Create mock rules
    mock_rule = MagicMock()
    mock_rule.match.return_value = [MockYaraMatch(rule="test_rule", tags=["test"], meta={"description": "Test"})]
    mock_collect_rules.return_value = [mock_rule]

    # Create storage mock
    storage_mock = MagicMock()

    # Create service instance
    service_instance = YaraService(storage_client=storage_mock)

    # Test data
    data = b"This is test data for scanning"

    # Act: Match the data
    result = service_instance.match_data(data, "test_file.bin")

    # Assert
    assert isinstance(result, YaraScanResult)
    assert result.file_name == "test_file.bin"
    assert result.file_size == len(data)
    assert result.file_hash == hashlib.sha256(data).hexdigest()
    assert len(result.matches) == 1
    assert result.matches[0].rule == "test_rule"

    # Check the rule was called correctly
    mock_rule.match.assert_called_once()
    # Get the keyword arguments
    args, kwargs = mock_rule.match.call_args
    assert "data" in kwargs
    assert kwargs["data"] == data


@patch("httpx.Client")
@patch("yaraflux_mcp_server.yara_service.YaraService.match_data")
def test_fetch_and_scan_success(mock_match_data, mock_client):
    """Test successful URL fetch and scan."""
    # Setup mock response
    mock_response = Mock()
    mock_response.content = b"test content"
    mock_response.headers = {}
    mock_response.raise_for_status = Mock()
    mock_client.return_value.__enter__.return_value.get.return_value = mock_response

    # Create mock for match_data result
    mock_result = Mock()
    mock_result.scan_id = "test-scan-id"
    mock_result.file_name = "test.txt"
    mock_result.file_size = 12
    mock_result.file_hash = "test-hash"
    mock_result.matches = []
    mock_match_data.return_value = mock_result

    # Create service instance
    storage_mock = MagicMock()
    storage_mock.save_sample.return_value = ("/tmp/test_path", "test_hash")
    service_instance = YaraService(storage_client=storage_mock)

    # Test the method with named arguments
    result = service_instance.fetch_and_scan(
        url="http://example.com/file.txt", rule_names=["rule1"], sources=["custom"], timeout=30
    )

    # Verify the result
    assert result == mock_result
    mock_client.return_value.__enter__.return_value.get.assert_called_once()
    storage_mock.save_sample.assert_called_once()
    # Verify match_data was called with the correct arguments
    mock_match_data.assert_called_once_with(
        data=b"test content", file_name="file.txt", rule_names=["rule1"], sources=["custom"], timeout=30
    )


@patch("httpx.Client")
def test_fetch_and_scan_with_large_file(mock_client):
    """Test fetch_and_scan with file exceeding size limit."""
    # Setup mock response with large content
    mock_response = Mock()
    # Create content that exceeds the default max file size
    mock_response.content = b"x" * (10 * 1024 * 1024)  # 10MB
    mock_response.headers = {}
    mock_response.raise_for_status = Mock()
    mock_client.return_value.__enter__.return_value.get.return_value = mock_response

    # Create service instance with patched settings
    with patch("yaraflux_mcp_server.yara_service.settings") as mock_settings:
        # Set a smaller max file size for testing
        mock_settings.YARA_MAX_FILE_SIZE = 1024 * 1024  # 1MB

        service_instance = YaraService()

        # Test the method - should raise YaraError for large file
        with pytest.raises(YaraError) as exc_info:
            service_instance.fetch_and_scan(url="http://example.com/large-file.bin")

        # Verify the error message
        assert "file too large" in str(exc_info.value).lower()


@patch("httpx.Client")
def test_fetch_and_scan_http_error(mock_client):
    """Test fetch_and_scan with HTTP error."""
    # Setup mock to raise an HTTP error
    mock_client.return_value.__enter__.return_value.get.side_effect = httpx.HTTPStatusError(
        "404 Not Found", request=Mock(), response=Mock(status_code=404)
    )

    # Create service instance
    storage_mock = MagicMock()
    service_instance = YaraService(storage_client=storage_mock)

    # Test the method - should raise YaraError
    with pytest.raises(YaraError) as exc_info:
        service_instance.fetch_and_scan(url="http://example.com/not-found.txt")

    # Verify the error message
    assert "http 404" in str(exc_info.value).lower()
    # Verify storage.save_sample was not called
    storage_mock.save_sample.assert_not_called()
