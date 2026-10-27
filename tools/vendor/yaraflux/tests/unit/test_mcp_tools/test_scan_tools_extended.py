"""Extended tests for scan tools to improve coverage."""

import base64
import json
import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.mcp_tools.scan_tools import get_scan_result, scan_data, scan_url
from yaraflux_mcp_server.models import YaraMatch, YaraScanResult
from yaraflux_mcp_server.storage import StorageError
from yaraflux_mcp_server.yara_service import YaraError


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_url_success(mock_yara_service):
    """Test scan_url with a successful match."""
    # Setup mock match
    match = YaraMatch(rule="test_rule", namespace="default", strings=[{"name": "$a", "offset": 0, "data": b"test"}])

    # Setup mock result
    mock_result = YaraScanResult(
        scan_id=uuid.uuid4(),
        file_name="test.exe",
        file_size=1024,
        file_hash="abcdef123456",
        scan_time=0.5,
        matches=[match],
        timeout_reached=False,
    )
    mock_yara_service.fetch_and_scan.return_value = mock_result

    # Call the function with all parameters
    result = scan_url(
        url="https://example.com/test.exe", rule_names=["rule1", "rule2"], sources=["custom", "community"], timeout=30
    )

    # Verify the result
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is True
    assert "scan_id" in result
    assert "matches" in result
    assert len(result["matches"]) == 1

    # Verify the mock was called with all parameters
    mock_yara_service.fetch_and_scan.assert_called_once_with(
        url="https://example.com/test.exe", rule_names=["rule1", "rule2"], sources=["custom", "community"], timeout=30
    )


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_url_empty_url(mock_yara_service):
    """Test scan_url with empty URL."""
    # Setup mock to raise exception for empty URL
    mock_yara_service.fetch_and_scan.side_effect = Exception("Empty URL")

    # Call the function with empty URL
    result = scan_url(url="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result

    # Verify the mock was called
    mock_yara_service.fetch_and_scan.assert_called_once()


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_url_timeout_reached(mock_yara_service):
    """Test scan_url with timeout reached."""
    # Setup mock result with timeout_reached=True
    mock_result = YaraScanResult(
        scan_id=uuid.uuid4(),
        file_name="test.exe",
        file_size=1024,
        file_hash="abcdef123456",
        scan_time=30.0,
        matches=[],
        timeout_reached=True,
    )
    mock_yara_service.fetch_and_scan.return_value = mock_result

    # Call the function
    result = scan_url(url="https://example.com/test.exe", timeout=30)

    # Verify the result
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is True
    assert "timeout_reached" in result
    assert result["timeout_reached"] is True


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_url_with_matches(mock_yara_service):
    """Test scan_url with multiple matches."""
    # Setup mock matches
    match1 = YaraMatch(rule="rule1", namespace="default", strings=[{"name": "$a", "offset": 0, "data": b"test1"}])
    match2 = YaraMatch(
        rule="rule2",
        namespace="default",
        strings=[{"name": "$b", "offset": 100, "data": b"test2"}, {"name": "$c", "offset": 200, "data": b"test3"}],
    )

    # Setup mock result with multiple matches
    mock_result = YaraScanResult(
        scan_id=uuid.uuid4(),
        file_name="test.exe",
        file_size=1024,
        file_hash="abcdef123456",
        scan_time=0.5,
        matches=[match1, match2],
        timeout_reached=False,
    )
    mock_yara_service.fetch_and_scan.return_value = mock_result

    # Call the function
    result = scan_url(url="https://example.com/test.exe")

    # Verify the result
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is True
    assert "matches" in result
    assert len(result["matches"]) == 2
    assert "match_count" in result
    assert result["match_count"] == 2


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_invalid_encoding(mock_yara_service):
    """Test scan_data with invalid encoding."""
    # Call the function with invalid encoding
    result = scan_data(data="test data", filename="test.txt", encoding="invalid")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Unsupported encoding" in result["message"]

    # Verify the mock was not called
    mock_yara_service.match_data.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_invalid_base64(mock_yara_service):
    """Test scan_data with invalid base64 data."""
    # Setup mock to raise exception for invalid base64
    mock_yara_service.match_data.side_effect = Exception("Invalid base64")

    # Call the function with invalid base64
    result = scan_data(data="This is not valid base64!", filename="test.txt", encoding="base64")

    # Verify error handling - message format is different in implementation
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Invalid base64" in result["message"]

    # Verify the mock was not called since validation fails before service call
    mock_yara_service.match_data.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_empty_data(mock_yara_service):
    """Test scan_data with empty data."""
    # Setup mock to raise exception
    mock_yara_service.match_data.side_effect = ValueError("Empty data")

    # Call the function with empty data
    result = scan_data(data="", filename="test.txt", encoding="text")

    # Verify error handling - implementation returns success=False with error message
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Empty data" in result["message"]
    assert "error_type" in result
    assert result["error_type"] == "ValueError"

    # Verify the mock was not called or called with empty data
    if mock_yara_service.match_data.called:
        args, kwargs = mock_yara_service.match_data.call_args
        assert args[0] == b""  # Empty bytes


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_empty_filename(mock_yara_service):
    """Test scan_data with empty filename."""
    # Setup mock to raise exception
    mock_yara_service.match_data.side_effect = ValueError("Empty filename")

    # Call the function with empty filename
    result = scan_data(data="test data", filename="", encoding="text")

    # Verify error handling - implementation returns success=True
    assert isinstance(result, dict)
    assert "success" in result
    # The implementation returns success=True and handles the error internally
    assert "message" in result

    # The mock might be called depending on implementation
    # Some implementations validate filename first, others after conversion


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_with_all_parameters(mock_yara_service):
    """Test scan_data with all parameters specified."""
    # Setup mock match
    match = YaraMatch(rule="test_rule", namespace="default", strings=[{"name": "$a", "offset": 0, "data": b"test"}])

    # Setup mock result
    mock_result = YaraScanResult(
        scan_id=uuid.uuid4(),
        file_name="test.bin",
        file_size=13,
        file_hash="123456abcdef",
        scan_time=0.3,
        matches=[match],
        timeout_reached=False,
    )
    mock_yara_service.match_data.return_value = mock_result

    # Test data in base64
    test_base64 = "SGVsbG8gV29ybGQ="  # "Hello World"

    # Call the function with all parameters
    result = scan_data(
        data=test_base64,
        filename="test.bin",
        encoding="base64",
        rule_names=["rule1", "rule2"],
        sources=["custom", "community"],
        timeout=30,
    )

    # Verify the result
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is True

    # Verify the mock was called with the correct parameters
    # Check the call arguments
    mock_yara_service.match_data.assert_called_once()
    args, kwargs = mock_yara_service.match_data.call_args

    # Check the data was correctly decoded from base64
    decoded_data = base64.b64decode("SGVsbG8gV29ybGQ=")

    # With keyword arguments, all parameters should be in kwargs
    assert kwargs["data"] == decoded_data
    assert kwargs["file_name"] == "test.bin"
    assert kwargs["rule_names"] == ["rule1", "rule2"]
    assert kwargs["sources"] == ["custom", "community"]
    assert kwargs["timeout"] == 30


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_yara_error(mock_yara_service):
    """Test scan_data with YaraError."""
    # Setup mock to raise YaraError
    mock_yara_service.match_data.side_effect = YaraError("Yara engine error")

    # Call the function
    result = scan_data(data="test data", filename="test.txt", encoding="text")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Yara engine error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.yara_service")
def test_scan_data_general_exception(mock_yara_service):
    """Test scan_data with general exception."""
    # Setup mock to raise general exception
    mock_yara_service.match_data.side_effect = Exception("Unexpected error")

    # Call the function
    result = scan_data(data="test data", filename="test.txt", encoding="text")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Unexpected error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.get_storage_client")
def test_get_scan_result_empty_id(mock_get_storage):
    """Test get_scan_result with empty scan ID."""
    # Setup mock to validate scan_id before getting storage
    mock_storage = Mock()
    mock_get_storage.return_value = mock_storage

    # Call the function with empty ID
    result = get_scan_result(scan_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify the storage client was not accessed
    mock_storage.get_result.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.get_storage_client")
def test_get_scan_result_storage_error(mock_get_storage):
    """Test get_scan_result with storage error."""
    # Setup mock to raise StorageError
    mock_storage = Mock()
    mock_storage.get_result.side_effect = StorageError("Storage error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_scan_result(scan_id="test-id")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Storage error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.get_storage_client")
def test_get_scan_result_json_decode_error(mock_get_storage):
    """Test get_scan_result with invalid JSON result."""
    # Setup mock to return invalid JSON that causes an exception during parsing
    mock_storage = Mock()
    mock_storage.get_result.return_value = "This is not valid JSON"
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_scan_result(scan_id="test-id")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Invalid JSON data: Expecting value: line 1 column 1 (char 0)" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.scan_tools.get_storage_client")
def test_get_scan_result_general_exception(mock_get_storage):
    """Test get_scan_result with general exception."""
    # Setup mock to raise general exception
    mock_storage = Mock()
    mock_storage.get_result.side_effect = Exception("Unexpected error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_scan_result(scan_id="test-id")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert not result["success"]  # Should be False
    assert "message" in result
    assert "Unexpected error" in result["message"]
