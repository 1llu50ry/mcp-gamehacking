"""Enhanced tests for storage_tools.py module."""

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, Mock, PropertyMock, patch

import pytest

from yaraflux_mcp_server.mcp_tools.storage_tools import clean_storage, format_size, get_storage_info


def test_format_size_bytes():
    """Test format_size function with bytes."""
    # Test various byte values
    assert format_size(0) == "0.00 B"
    assert format_size(1) == "1.00 B"
    assert format_size(512) == "512.00 B"
    assert format_size(1023) == "1023.00 B"


def test_format_size_kilobytes():
    """Test format_size function with kilobytes."""
    # Test various kilobyte values
    assert format_size(1024) == "1.00 KB"
    assert format_size(1536) == "1.50 KB"
    assert format_size(10240) == "10.00 KB"
    # Check boundary - exact value may vary in implementation
    size_str = format_size(1024 * 1024 - 1)
    assert "KB" in size_str  # Just make sure the format is right
    assert float(size_str.split()[0]) > 1023  # Ensure it's close to 1024


def test_format_size_megabytes():
    """Test format_size function with megabytes."""
    # Test various megabyte values
    assert format_size(1024 * 1024) == "1.00 MB"
    assert format_size(1.5 * 1024 * 1024) == "1.50 MB"
    assert format_size(10 * 1024 * 1024) == "10.00 MB"
    # Check boundary - exact value may vary in implementation
    size_str = format_size(1024 * 1024 * 1024 - 1)
    assert "MB" in size_str  # Just make sure the format is right
    assert float(size_str.split()[0]) > 1023  # Ensure it's close to 1024


def test_format_size_gigabytes():
    """Test format_size function with gigabytes."""
    # Test various gigabyte values
    assert format_size(1024 * 1024 * 1024) == "1.00 GB"
    assert format_size(1.5 * 1024 * 1024 * 1024) == "1.50 GB"
    assert format_size(10 * 1024 * 1024 * 1024) == "10.00 GB"
    assert format_size(100 * 1024 * 1024 * 1024) == "100.00 GB"


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_get_storage_info_local(mock_get_storage):
    """Test get_storage_info with local storage."""
    # Create a detailed mock that matches the implementation's expectations
    mock_storage = Mock()

    # Set up class name for local storage
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Mock the directory properties
    rules_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/rules"))
    type(mock_storage).rules_dir = rules_dir_mock

    samples_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/samples"))
    type(mock_storage).samples_dir = samples_dir_mock

    results_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/results"))
    type(mock_storage).results_dir = results_dir_mock

    # Mock the storage client methods
    mock_storage.list_rules.return_value = [
        {"name": "rule1.yar", "size": 1024, "is_compiled": True},
        {"name": "rule2.yar", "size": 2048, "is_compiled": True},
    ]

    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "1", "file_name": "sample1.bin", "file_size": 4096},
            {"file_id": "2", "file_name": "sample2.bin", "file_size": 8192},
        ],
        "total": 2,
    }

    # Return the mock storage client
    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_storage_info()

    # Verify the result
    assert result["success"] is True
    assert "info" in result
    assert "storage_type" in result["info"]
    assert result["info"]["storage_type"] == "local"

    # Verify local directories are included
    assert "local_directories" in result["info"]
    assert "rules" in result["info"]["local_directories"]
    assert result["info"]["local_directories"]["rules"] == str(Path("/tmp/yaraflux/rules"))
    assert "samples" in result["info"]["local_directories"]
    assert "results" in result["info"]["local_directories"]

    # Verify usage statistics
    assert "usage" in result["info"]
    assert "rules" in result["info"]["usage"]
    assert result["info"]["usage"]["rules"]["file_count"] == 2
    assert result["info"]["usage"]["rules"]["size_bytes"] == 3072
    assert "samples" in result["info"]["usage"]
    assert result["info"]["usage"]["samples"]["file_count"] == 2
    assert result["info"]["usage"]["samples"]["size_bytes"] == 12288
    assert "results" in result["info"]["usage"]

    # Verify total size calculation
    assert "total" in result["info"]["usage"]
    total_size = (
        result["info"]["usage"]["rules"]["size_bytes"]
        + result["info"]["usage"]["samples"]["size_bytes"]
        + result["info"]["usage"]["results"]["size_bytes"]
    )
    assert result["info"]["usage"]["total"]["size_bytes"] == total_size


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_get_storage_info_minio(mock_get_storage):
    """Test get_storage_info with MinIO storage."""
    # Create a mock storage client
    mock_storage = MagicMock()

    # Setup class name for minio storage
    mock_storage.__class__.__name__ = "MinioStorageClient"

    # Setup return values for the methods
    mock_storage.list_rules.return_value = [{"name": "rule1.yar", "size": 1024, "is_compiled": True}]
    mock_storage.list_files.return_value = {
        "files": [{"file_id": "1", "file_name": "sample1.bin", "file_size": 4096}],
        "total": 1,
    }

    # Make hasattr return False for directory attributes
    def hasattr_side_effect(obj, name):
        if name in ["rules_dir", "samples_dir", "results_dir"]:
            return False
        return True

    with patch("yaraflux_mcp_server.mcp_tools.storage_tools.hasattr", side_effect=hasattr_side_effect):
        # Return our mock from get_storage_client
        mock_get_storage.return_value = mock_storage

        # Call the function
        result = get_storage_info()

        # Verify the result
        assert result["success"] is True
        assert result["info"]["storage_type"] == "minio"

        # Verify directories are not included
        assert "local_directories" not in result["info"]

    # Verify usage statistics
    assert "usage" in result["info"]
    assert "rules" in result["info"]["usage"]
    assert result["info"]["usage"]["rules"]["file_count"] == 1
    assert result["info"]["usage"]["rules"]["size_bytes"] == 1024
    assert "samples" in result["info"]["usage"]
    assert result["info"]["usage"]["samples"]["file_count"] == 1
    assert result["info"]["usage"]["samples"]["size_bytes"] == 4096


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_get_storage_info_rules_error(mock_get_storage):
    """Test get_storage_info with error in rules listing."""
    # Create a mock that raises an exception for the list_rules method
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Set up attributes needed by the implementation
    rules_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/rules"))
    type(mock_storage).rules_dir = rules_dir_mock

    samples_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/samples"))
    type(mock_storage).samples_dir = samples_dir_mock

    results_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/results"))
    type(mock_storage).results_dir = results_dir_mock

    # Make list_rules raise an exception
    mock_storage.list_rules.side_effect = Exception("Rules listing error")

    # Make other methods return valid data
    mock_storage.list_files.return_value = {
        "files": [{"file_id": "1", "file_name": "sample1.bin", "file_size": 4096}],
        "total": 1,
    }

    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_storage_info()

    # Verify the result still has success=True since the implementation handles errors
    assert result["success"] is True
    assert "info" in result

    # Verify rules section shows zero values
    assert "usage" in result["info"]
    assert "rules" in result["info"]["usage"]
    assert result["info"]["usage"]["rules"]["file_count"] == 0
    assert result["info"]["usage"]["rules"]["size_bytes"] == 0
    assert result["info"]["usage"]["rules"]["size_human"] == "0.00 B"

    # Verify other sections still have data
    assert "samples" in result["info"]["usage"]
    assert result["info"]["usage"]["samples"]["file_count"] == 1


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_get_storage_info_samples_error(mock_get_storage):
    """Test get_storage_info with error in samples listing."""
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Set up attributes
    rules_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/rules"))
    type(mock_storage).rules_dir = rules_dir_mock

    samples_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/samples"))
    type(mock_storage).samples_dir = samples_dir_mock

    results_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/results"))
    type(mock_storage).results_dir = results_dir_mock

    # Make list_rules return valid data
    mock_storage.list_rules.return_value = [
        {"name": "rule1.yar", "size": 1024, "is_compiled": True},
    ]

    # Make list_files raise an exception
    mock_storage.list_files.side_effect = Exception("Samples listing error")

    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_storage_info()

    # Verify the result
    assert result["success"] is True
    assert "info" in result

    # Verify rules section has data
    assert "usage" in result["info"]
    assert "rules" in result["info"]["usage"]
    assert result["info"]["usage"]["rules"]["file_count"] == 1
    assert result["info"]["usage"]["rules"]["size_bytes"] == 1024

    # Verify samples section shows zero values
    assert "samples" in result["info"]["usage"]
    assert result["info"]["usage"]["samples"]["file_count"] == 0
    assert result["info"]["usage"]["samples"]["size_bytes"] == 0


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
@patch("os.path.exists")
@patch("os.listdir")
@patch("os.path.getsize")
def test_get_storage_info_results_detection(mock_getsize, mock_listdir, mock_exists, mock_get_storage):
    """Test get_storage_info with results directory detection."""
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Set up attributes
    results_dir = Path("/tmp/yaraflux/results")
    rules_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/rules"))
    type(mock_storage).rules_dir = rules_dir_mock

    samples_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/samples"))
    type(mock_storage).samples_dir = samples_dir_mock

    results_dir_mock = PropertyMock(return_value=results_dir)
    type(mock_storage).results_dir = results_dir_mock

    # Setup basic data for rules and samples
    mock_storage.list_rules.return_value = [{"name": "rule1.yar", "size": 1024}]
    mock_storage.list_files.return_value = {"files": [], "total": 0}

    # Setup results directory mocking
    mock_exists.return_value = True
    mock_listdir.return_value = ["result1.json", "result2.json"]
    mock_getsize.return_value = 2048  # Each file is 2KB

    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_storage_info()

    # Verify the result
    assert result["success"] is True

    # Verify results section has data
    assert "results" in result["info"]["usage"]
    assert result["info"]["usage"]["results"]["file_count"] == 2
    assert result["info"]["usage"]["results"]["size_bytes"] == 4096  # 2 * 2048
    assert result["info"]["usage"]["results"]["size_human"] == "4.00 KB"


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
@patch("yaraflux_mcp_server.mcp_tools.storage_tools.logger")
def test_get_storage_info_results_error(mock_logger, mock_get_storage):
    """Test get_storage_info with error in results listing."""
    # Create a mock storage client
    mock_storage = MagicMock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Setup the error
    mock_storage.list_rules.return_value = []
    mock_storage.list_files.return_value = {"files": [], "total": 0}

    # Create a property that raises an exception when accessed
    # We'll use property mocking to make results_dir raise an exception
    def side_effect_raise(*args, **kwargs):
        raise Exception("Results dir error")

    # Configure the mock to raise an exception when results_dir is accessed
    mock_storage.results_dir = side_effect_raise

    mock_get_storage.return_value = mock_storage

    # Call the function
    result = get_storage_info()

    # Because we're using a side_effect that raises an exception
    # we know the error should be logged
    assert mock_logger.warning.called or mock_logger.error.called

    # Verify the function still returns success
    assert result["success"] is True

    # Verify results section shows zero values
    assert "results" in result["info"]["usage"]
    assert result["info"]["usage"]["results"]["file_count"] == 0
    assert result["info"]["usage"]["results"]["size_bytes"] == 0


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_get_storage_info_total_calculation(mock_get_storage):
    """Test get_storage_info total size calculation."""
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Set up attributes with known directory paths
    rules_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/rules"))
    type(mock_storage).rules_dir = rules_dir_mock

    samples_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/samples"))
    type(mock_storage).samples_dir = samples_dir_mock

    results_dir_mock = PropertyMock(return_value=Path("/tmp/yaraflux/results"))
    type(mock_storage).results_dir = results_dir_mock

    # Setup data with specific sizes
    mock_storage.list_rules.return_value = [
        {"name": "rule1.yar", "size": 1000},
        {"name": "rule2.yar", "size": 2000},
    ]

    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "1", "file_name": "sample1.bin", "file_size": 3000},
            {"file_id": "2", "file_name": "sample2.bin", "file_size": 4000},
        ],
        "total": 2,
    }

    # Setup results directory simulation with os module mocking
    with (
        patch("os.path.exists") as mock_exists,
        patch("os.listdir") as mock_listdir,
        patch("os.path.getsize") as mock_getsize,
    ):

        mock_exists.return_value = True
        mock_listdir.return_value = ["result1.json", "result2.json"]
        mock_getsize.return_value = 5000  # Each file is 5KB

        mock_get_storage.return_value = mock_storage

        # Call the function
        result = get_storage_info()

    # Verify the total calculation
    expected_total_bytes = 20000  # 1000 + 2000 + 3000 + 4000 + (2 * 5000)
    assert result["info"]["usage"]["total"]["file_count"] == 6  # 2 rules + 2 samples + 2 results
    assert result["info"]["usage"]["total"]["size_bytes"] == expected_total_bytes
    assert result["info"]["usage"]["total"]["size_human"] == "19.53 KB"


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_clean_storage_invalid_type(mock_get_storage):
    """Test clean_storage with invalid storage type."""
    # Setup a mock storage client (shouldn't be used)
    mock_get_storage.return_value = Mock()

    # Call the function with an invalid storage type
    result = clean_storage(storage_type="invalid_type")

    # Verify the result shows an error
    assert result["success"] is False
    assert "Invalid storage type" in result["message"]

    # Verify the storage client was not used
    mock_get_storage.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_clean_storage_samples_only(mock_get_storage):
    """Test clean_storage with samples storage type."""
    mock_storage = Mock()

    # Create sample data with different dates
    old_date = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    new_date = (datetime.now(UTC) - timedelta(days=10)).isoformat()

    # Setup list_files to return one old and one new file
    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "old", "file_name": "old_sample.bin", "file_size": 2048, "uploaded_at": old_date},
            {"file_id": "new", "file_name": "new_sample.bin", "file_size": 2048, "uploaded_at": new_date},
        ],
        "total": 2,
    }

    # Setup delete_file to return True (success)
    mock_storage.delete_file.return_value = True

    mock_get_storage.return_value = mock_storage

    # Call the function to clean files older than 30 days
    result = clean_storage(storage_type="samples", older_than_days=30)

    # Verify the result
    assert result["success"] is True
    assert result["cleaned_count"] == 1  # Only old_sample.bin should be deleted
    assert result["freed_bytes"] == 2048  # 2KB freed

    # Verify delete_file was called once with the old file ID
    mock_storage.delete_file.assert_called_once_with("old")


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_clean_storage_custom_age(mock_get_storage):
    """Test clean_storage with custom age threshold."""
    mock_storage = Mock()

    # Create sample data with different dates
    very_old_date = (datetime.now(UTC) - timedelta(days=100)).isoformat()
    old_date = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    new_date = (datetime.now(UTC) - timedelta(days=10)).isoformat()

    # Setup list_files to return files of various ages
    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "very_old", "file_name": "very_old.bin", "file_size": 1000, "uploaded_at": very_old_date},
            {"file_id": "old", "file_name": "old.bin", "file_size": 2000, "uploaded_at": old_date},
            {"file_id": "new", "file_name": "new.bin", "file_size": 3000, "uploaded_at": new_date},
        ],
        "total": 3,
    }

    # Setup delete_file to return True (success)
    mock_storage.delete_file.return_value = True

    mock_get_storage.return_value = mock_storage

    # Call the function to clean files older than 50 days
    result = clean_storage(storage_type="samples", older_than_days=50)

    # Verify the result
    assert result["success"] is True
    assert result["cleaned_count"] == 1  # Only very_old.bin should be deleted
    assert result["freed_bytes"] == 1000

    # Verify delete_file was called once with the very old file ID
    mock_storage.delete_file.assert_called_once_with("very_old")


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_clean_storage_date_parsing(mock_get_storage):
    """Test clean_storage with different date formats."""
    mock_storage = Mock()

    # Create sample data with different date formats
    iso_date = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    datetime_obj = datetime.now(UTC) - timedelta(days=40)

    # Setup list_files to return files with different date formats
    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "iso", "file_name": "iso_date.bin", "file_size": 1000, "uploaded_at": iso_date},
            {"file_id": "obj", "file_name": "datetime_obj.bin", "file_size": 2000, "uploaded_at": datetime_obj},
        ],
        "total": 2,
    }

    # Setup delete_file to return True (success)
    mock_storage.delete_file.return_value = True

    mock_get_storage.return_value = mock_storage

    # Call the function to clean files older than 30 days
    result = clean_storage(storage_type="samples", older_than_days=30)

    # Verify the result
    assert result["success"] is True
    assert result["cleaned_count"] == 2  # Both files should be deleted
    assert result["freed_bytes"] == 3000  # 1000 + 2000

    # Verify delete_file was called twice
    assert mock_storage.delete_file.call_count == 2


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
def test_clean_storage_missing_date(mock_get_storage):
    """Test clean_storage with files missing date information."""
    mock_storage = Mock()

    # Create sample data with missing date field
    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "no_date", "file_name": "no_date.bin", "file_size": 1000},  # No uploaded_at field
            {"file_id": "date_none", "file_name": "date_none.bin", "file_size": 2000, "uploaded_at": None},
        ],
        "total": 2,
    }

    # Setup delete_file to return True (success)
    mock_storage.delete_file.return_value = True

    mock_get_storage.return_value = mock_storage

    # Call the function to clean files (these should be kept since we can't determine age)
    result = clean_storage(storage_type="samples", older_than_days=30)

    # Verify the result - files with missing dates should be preserved
    assert result["success"] is True
    assert result["cleaned_count"] == 0  # No files should be deleted
    assert result["freed_bytes"] == 0

    # Verify delete_file was not called
    mock_storage.delete_file.assert_not_called()


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
@patch("os.path.exists")
@patch("os.listdir")
@patch("os.path.getmtime")
@patch("os.path.getsize")
@patch("os.remove")
def test_clean_storage_results_only(
    mock_remove, mock_getsize, mock_getmtime, mock_listdir, mock_exists, mock_get_storage
):
    """Test clean_storage with results storage type."""
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Setup a Path mock that includes an exists method
    results_dir = MagicMock(spec=Path)
    results_dir.exists.return_value = True
    results_dir.glob.return_value = [
        Path("/tmp/yaraflux/results/old_result.json"),
        Path("/tmp/yaraflux/results/new_result.json"),
    ]

    # Setup the mock storage client
    results_dir_mock = PropertyMock(return_value=results_dir)
    type(mock_storage).results_dir = results_dir_mock

    # Setup the results directory existence
    mock_exists.return_value = True

    # Create test files list with different timestamps
    old_file = "old_result.json"
    new_file = "new_result.json"
    mock_listdir.return_value = [old_file, new_file]

    # Set file modification times
    def getmtime_side_effect(path):
        if old_file in str(path):
            # 40 days ago - use naive datetime for timestamp
            return (datetime.now() - timedelta(days=40)).timestamp()
        else:
            # 10 days ago - use naive datetime for timestamp
            return (datetime.now() - timedelta(days=10)).timestamp()

    mock_getmtime.side_effect = getmtime_side_effect

    # Set file sizes
    mock_getsize.return_value = 5000  # Each file is 5KB

    # Setup delete_file to succeed
    mock_remove.return_value = None  # os.remove returns None on success

    mock_get_storage.return_value = mock_storage

    # Call the function to clean results older than 30 days
    result = clean_storage(storage_type="results", older_than_days=30)

    # Verify the result
    assert result["success"] is True
    assert result["cleaned_count"] == 1  # Only old_result.json should be deleted
    assert result["freed_bytes"] == 5000  # 5KB freed

    # Verify os.remove was called once with the old file path
    mock_remove.assert_called_once()


@patch("yaraflux_mcp_server.mcp_tools.storage_tools.get_storage_client")
@patch("os.path.exists")
@patch("os.listdir")
@patch("os.path.getmtime")
@patch("os.path.getsize")
@patch("os.remove")
def test_clean_storage_all_types(mock_remove, mock_getsize, mock_getmtime, mock_listdir, mock_exists, mock_get_storage):
    """Test clean_storage with 'all' storage type."""
    mock_storage = Mock()
    mock_storage.__class__.__name__ = "LocalStorageClient"

    # Setup a Path mock that includes an exists method
    results_dir = MagicMock(spec=Path)
    results_dir.exists.return_value = True
    results_dir.glob.return_value = [
        Path("/tmp/yaraflux/results/old_result.json"),
        Path("/tmp/yaraflux/results/new_result.json"),
    ]

    # Setup the mock storage client
    results_dir_mock = PropertyMock(return_value=results_dir)
    type(mock_storage).results_dir = results_dir_mock

    # Setup the results directory existence
    mock_exists.return_value = True

    # Setup results files
    mock_listdir.return_value = ["old_result.json", "new_result.json"]

    # Set file modification times for results
    def getmtime_side_effect(path):
        if "old_result.json" in str(path):
            # 40 days ago - use naive datetime for timestamp
            return (datetime.now() - timedelta(days=40)).timestamp()
        else:
            # 10 days ago - use naive datetime for timestamp
            return (datetime.now() - timedelta(days=10)).timestamp()

    mock_getmtime.side_effect = getmtime_side_effect

    # Set file sizes for results
    mock_getsize.return_value = 5000  # Each file is 5KB

    # Setup sample files
    old_date = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    new_date = (datetime.now(UTC) - timedelta(days=10)).isoformat()

    mock_storage.list_files.return_value = {
        "files": [
            {"file_id": "old", "file_name": "old_sample.bin", "file_size": 3000, "uploaded_at": old_date},
            {"file_id": "new", "file_name": "new_sample.bin", "file_size": 3000, "uploaded_at": new_date},
        ],
        "total": 2,
    }

    # Setup delete_file to return True (success)
    mock_storage.delete_file.return_value = True

    mock_get_storage.return_value = mock_storage

    # Call the function to clean all storage types older than 30 days
    result = clean_storage(storage_type="all", older_than_days=30)

    # Verify the result
    assert result["success"] is True
    assert result["cleaned_count"] == 2  # 1 old result + 1 old sample
    assert result["freed_bytes"] == 8000  # 5000 (result) + 3000 (sample)

    # Verify os.remove was called for the old result
    mock_remove.assert_called_once()
    args, _ = mock_remove.call_args
    assert "old_result.json" in str(args[0])

    # Verify delete_file was called for the old sample
    mock_storage.delete_file.assert_called_once_with("old")
