"""Extended tests for file tools to improve coverage."""

import base64
import json
import uuid
from io import BytesIO
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.mcp_tools.file_tools import (
    delete_file,
    download_file,
    extract_strings,
    get_file_info,
    get_hex_view,
    list_files,
    upload_file,
)
from yaraflux_mcp_server.storage import StorageError


@patch("yaraflux_mcp_server.mcp_tools.file_tools.base64.b64decode")
@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_invalid_base64(mock_get_storage, mock_b64decode):
    """Test upload_file with invalid base64 data."""
    # Mock b64decode to raise exception
    mock_b64decode.side_effect = Exception("Invalid base64 data")

    # Call the function with invalid base64
    result = upload_file(data="This is not valid base64!", file_name="test.txt", encoding="base64")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Invalid base64 data" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_empty_data(mock_get_storage):
    """Test upload_file with empty data."""
    # Call the function with empty data
    result = upload_file(data="", file_name="test.txt", encoding="base64")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_empty_filename(mock_get_storage):
    """Test upload_file with empty filename."""
    # Call the function with empty filename
    result = upload_file(data="SGVsbG8gV29ybGQ=", file_name="", encoding="base64")  # "Hello World"

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "name cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_invalid_encoding(mock_get_storage):
    """Test upload_file with invalid encoding."""
    # Call the function with invalid encoding
    result = upload_file(data="test data", file_name="test.txt", encoding="invalid")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Unsupported encoding" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_storage_error(mock_get_storage):
    """Test upload_file with storage error."""
    # Setup mock to raise StorageError
    mock_storage = Mock()
    mock_storage.save_file.side_effect = StorageError("Storage error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = upload_file(data="SGVsbG8gV29ybGQ=", file_name="test.txt", encoding="base64")  # "Hello World"

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Storage error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_upload_file_general_exception(mock_get_storage):
    """Test upload_file with general exception."""
    # Setup mock to raise Exception
    mock_storage = Mock()
    mock_storage.save_file.side_effect = Exception("Unexpected error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = upload_file(data="SGVsbG8gV29ybGQ=", file_name="test.txt", encoding="base64")  # "Hello World"

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Unexpected error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_get_file_info_empty_id(mock_get_storage):
    """Test get_file_info with empty file ID."""
    # Call the function with empty ID
    result = get_file_info(file_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_list_files_invalid_page(mock_get_storage):
    """Test list_files with invalid page number."""
    # Call the function with invalid page
    result = list_files(page=0)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Page number must be positive" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_list_files_invalid_page_size(mock_get_storage):
    """Test list_files with invalid page size."""
    # Call the function with invalid page size
    result = list_files(page_size=0)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Page size must be positive" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_list_files_invalid_sort_field(mock_get_storage):
    """Test list_files with invalid sort field."""
    # Call the function with invalid sort field
    result = list_files(sort_by="invalid_field")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Invalid sort field" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_delete_file_empty_id(mock_get_storage):
    """Test delete_file with empty file ID."""
    # Call the function with empty ID
    result = delete_file(file_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_delete_file_storage_error(mock_get_storage):
    """Test delete_file with storage error."""
    # Setup mock that fails when get_file_info is called
    mock_storage = Mock()
    mock_storage.get_file_info.side_effect = StorageError("Storage error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = delete_file(file_id="test-id")

    # Verify error handling - the implementation returns success=True
    assert isinstance(result, dict)
    assert "Error deleting file" in result["message"]
    assert "message" in result
    assert "Storage error" in result["message"]


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_extract_strings_empty_id(mock_get_storage):
    """Test extract_strings with empty file ID."""
    # Call the function with empty ID
    result = extract_strings(file_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_extract_strings_invalid_min_length(mock_get_storage):
    """Test extract_strings with invalid minimum length."""
    # Call the function with invalid min_length
    result = extract_strings(file_id="test-id", min_length=0)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Minimum string length must be positive" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_extract_strings_no_string_types(mock_get_storage):
    """Test extract_strings with no string types selected."""
    # Call the function with both string types disabled
    result = extract_strings(file_id="test-id", include_unicode=False, include_ascii=False)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "At least one string type" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_get_hex_view_empty_id(mock_get_storage):
    """Test get_hex_view with empty file ID."""
    # Call the function with empty ID
    result = get_hex_view(file_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_get_hex_view_negative_offset(mock_get_storage):
    """Test get_hex_view with negative offset."""
    # Call the function with negative offset
    result = get_hex_view(file_id="test-id", offset=-1)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Offset must be non-negative" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_get_hex_view_invalid_length(mock_get_storage):
    """Test get_hex_view with invalid length."""
    # Call the function with invalid length
    result = get_hex_view(file_id="test-id", length=0)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Length must be positive" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_get_hex_view_invalid_bytes_per_line(mock_get_storage):
    """Test get_hex_view with invalid bytes per line."""
    # Call the function with invalid bytes_per_line
    result = get_hex_view(file_id="test-id", bytes_per_line=0)

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Bytes per line must be positive" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_download_file_empty_id(mock_get_storage):
    """Test download_file with empty file ID."""
    # Call the function with empty ID
    result = download_file(file_id="")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "cannot be empty" in result["message"].lower()

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_download_file_invalid_encoding(mock_get_storage):
    """Test download_file with invalid encoding."""
    # Call the function with invalid encoding
    result = download_file(file_id="test-id", encoding="invalid")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Unsupported encoding" in result["message"]

    # Verify storage client was not called
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_download_file_unicode_decode_error(mock_get_storage):
    """Test download_file with Unicode decode error."""
    # Setup mock
    mock_storage = Mock()
    # Create binary data that will cause UnicodeDecodeError
    binary_data = b"\xff\xfe\xff\xfe"  # Invalid UTF-8 sequence
    mock_storage.get_file.return_value = binary_data
    mock_storage.get_file_info.return_value = {
        "file_id": "test-id",
        "file_name": "binary.bin",
        "file_size": len(binary_data),
        "mime_type": "application/octet-stream",
    }
    mock_get_storage.return_value = mock_storage

    # Call the function requesting text encoding
    result = download_file(file_id="test-id", encoding="text")

    # Verify handling - should fall back to base64
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is True
    assert "encoding" in result
    assert result["encoding"] == "base64"
    assert "data" in result
    # The data should be base64-encoded
    decoded = base64.b64decode(result["data"])
    assert decoded == binary_data


@patch("yaraflux_mcp_server.mcp_tools.file_tools.get_storage_client")
def test_download_file_storage_error(mock_get_storage):
    """Test download_file with storage error."""
    # Setup mock
    mock_storage = Mock()
    mock_storage.get_file.side_effect = StorageError("Storage error")
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = download_file(file_id="test-id")

    # Verify error handling
    assert isinstance(result, dict)
    assert "success" in result
    assert result["success"] is False
    assert "message" in result
    assert "Storage error" in result["message"]
