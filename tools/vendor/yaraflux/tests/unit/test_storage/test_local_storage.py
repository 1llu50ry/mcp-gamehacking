"""Unit tests for the local storage client."""

import hashlib
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.storage.base import StorageError
from yaraflux_mcp_server.storage.local import LocalStorageClient


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield Path(tmp_dir)


@pytest.fixture
def mock_settings(temp_dir):
    """Mock settings for testing."""
    with patch("yaraflux_mcp_server.storage.local.settings") as mock_settings:
        mock_settings.STORAGE_DIR = temp_dir / "storage"
        mock_settings.YARA_RULES_DIR = temp_dir / "rules"
        mock_settings.YARA_SAMPLES_DIR = temp_dir / "samples"
        mock_settings.YARA_RESULTS_DIR = temp_dir / "results"
        yield mock_settings


@pytest.fixture
def storage_client(mock_settings):
    """Create a storage client for testing."""
    client = LocalStorageClient()
    return client


class TestLocalStorageClient:
    """Tests for LocalStorageClient."""

    def test_init_creates_directories(self, storage_client, mock_settings):
        """Test that initialization creates the required directories."""
        # All directories should be created during initialization
        assert mock_settings.STORAGE_DIR.exists()
        assert mock_settings.YARA_RULES_DIR.exists()
        assert mock_settings.YARA_SAMPLES_DIR.exists()
        assert mock_settings.YARA_RESULTS_DIR.exists()
        assert (mock_settings.STORAGE_DIR / "files").exists()
        assert (mock_settings.STORAGE_DIR / "files_meta").exists()
        assert (mock_settings.YARA_RULES_DIR / "community").exists()
        assert (mock_settings.YARA_RULES_DIR / "custom").exists()

    def test_save_rule(self, storage_client, mock_settings):
        """Test saving a YARA rule."""
        rule_name = "test_rule"
        rule_content = "rule TestRule { condition: true }"

        # Test saving without .yar extension
        path = storage_client.save_rule(rule_name, rule_content)
        rule_path = mock_settings.YARA_RULES_DIR / "custom" / "test_rule.yar"

        assert path == str(rule_path)
        assert rule_path.exists()

        with open(rule_path, "r") as f:
            saved_content = f.read()
        assert saved_content == rule_content

        # Test saving with .yar extension
        rule_name_with_ext = "test_rule2.yar"
        path = storage_client.save_rule(rule_name_with_ext, rule_content)
        rule_path = mock_settings.YARA_RULES_DIR / "custom" / "test_rule2.yar"

        assert path == str(rule_path)
        assert rule_path.exists()

    def test_get_rule(self, storage_client):
        """Test getting a YARA rule."""
        rule_name = "test_get_rule"
        rule_content = "rule TestGetRule { condition: true }"

        # Save the rule first
        storage_client.save_rule(rule_name, rule_content)

        # Get the rule
        retrieved_content = storage_client.get_rule(rule_name)
        assert retrieved_content == rule_content

        # Test getting a rule with extension
        retrieved_content = storage_client.get_rule(f"{rule_name}.yar")
        assert retrieved_content == rule_content

        # Test getting a nonexistent rule
        with pytest.raises(StorageError, match="Rule not found"):
            storage_client.get_rule("nonexistent_rule")

    def test_delete_rule(self, storage_client):
        """Test deleting a YARA rule."""
        rule_name = "test_delete_rule"
        rule_content = "rule TestDeleteRule { condition: true }"

        # Save the rule first
        storage_client.save_rule(rule_name, rule_content)

        # Delete the rule
        result = storage_client.delete_rule(rule_name)
        assert result is True

        # Verify it's gone
        with pytest.raises(StorageError, match="Rule not found"):
            storage_client.get_rule(rule_name)

        # Test deleting a nonexistent rule
        result = storage_client.delete_rule("nonexistent_rule")
        assert result is False

    def test_list_rules(self, storage_client):
        """Test listing YARA rules."""
        # Save some rules
        storage_client.save_rule("test_list_1", "rule Test1 { condition: true }", "custom")
        storage_client.save_rule("test_list_2", "rule Test2 { condition: true }", "custom")
        storage_client.save_rule("test_list_3", "rule Test3 { condition: true }", "community")

        # List all rules
        rules = storage_client.list_rules()
        assert len(rules) == 3

        # Check rule names
        rule_names = [rule["name"] for rule in rules]
        assert "test_list_1.yar" in rule_names
        assert "test_list_2.yar" in rule_names
        assert "test_list_3.yar" in rule_names

        # Test filtering by source
        custom_rules = storage_client.list_rules(source="custom")
        assert len(custom_rules) == 2
        custom_names = [rule["name"] for rule in custom_rules]
        assert "test_list_1.yar" in custom_names
        assert "test_list_2.yar" in custom_names
        assert "test_list_3.yar" not in custom_names

        community_rules = storage_client.list_rules(source="community")
        assert len(community_rules) == 1
        assert community_rules[0]["name"] == "test_list_3.yar"

    def test_save_sample(self, storage_client, mock_settings):
        """Test saving a sample file."""
        filename = "test_sample.bin"
        content = b"Test sample content"

        # Save the sample
        path, file_hash = storage_client.save_sample(filename, content)

        # Check the hash
        expected_hash = hashlib.sha256(content).hexdigest()
        assert file_hash == expected_hash

        # Verify the file exists
        sample_path = Path(path)
        assert sample_path.exists()

        # Check the content
        with open(sample_path, "rb") as f:
            saved_content = f.read()
        assert saved_content == content

        # Test with file-like object
        from io import BytesIO

        file_obj = BytesIO(b"File-like object content")
        path2, hash2 = storage_client.save_sample("file_obj.bin", file_obj)

        # Verify the file exists
        sample_path2 = Path(path2)
        assert sample_path2.exists()

        # Check the content
        with open(sample_path2, "rb") as f:
            saved_content2 = f.read()
        assert saved_content2 == b"File-like object content"

    def test_get_sample(self, storage_client):
        """Test getting a sample."""
        filename = "test_get_sample.bin"
        content = b"Test get sample content"

        # Save the sample first
        path, file_hash = storage_client.save_sample(filename, content)

        # Get by file path
        retrieved_content = storage_client.get_sample(path)
        assert retrieved_content == content

        # Get by hash
        retrieved_content = storage_client.get_sample(file_hash)
        assert retrieved_content == content

        # Test with nonexistent sample
        with pytest.raises(StorageError, match="Sample not found"):
            storage_client.get_sample("nonexistent_sample")

    def test_save_result(self, storage_client, mock_settings):
        """Test saving a scan result."""
        result_id = "test-result-12345"
        result_content = {"matches": [{"rule": "test", "strings": []}]}

        # Save the result
        path = storage_client.save_result(result_id, result_content)

        # Verify the file exists
        result_path = Path(path)
        assert result_path.exists()

        # Check the content
        with open(result_path, "r") as f:
            saved_content = json.load(f)
        assert saved_content == result_content

        # Test with special characters in the ID
        special_id = "test/result\\with:special?chars"
        path = storage_client.save_result(special_id, result_content)

        # Verify the file exists with sanitized name
        result_path = Path(path)
        assert result_path.exists()

    def test_get_result(self, storage_client):
        """Test getting a scan result."""
        result_id = "test-get-result"
        result_content = {"matches": [{"rule": "test_get", "strings": []}]}

        # Save the result first
        path = storage_client.save_result(result_id, result_content)

        # Get by ID
        retrieved_content = storage_client.get_result(result_id)
        assert retrieved_content == result_content

        # Get by path
        retrieved_content = storage_client.get_result(path)
        assert retrieved_content == result_content

        # Test with nonexistent result
        with pytest.raises(StorageError, match="Result not found"):
            storage_client.get_result("nonexistent_result")

    def test_save_file(self, storage_client, mock_settings):
        """Test saving a file with metadata."""
        filename = "test_file.txt"
        content = b"Test file content"
        metadata = {"test_key": "test_value", "source": "test"}

        # Save the file
        file_info = storage_client.save_file(filename, content, metadata)

        # Check the returned info
        assert file_info["file_name"] == filename
        assert file_info["file_size"] == len(content)
        assert "file_id" in file_info
        assert "file_hash" in file_info
        assert file_info["metadata"] == metadata

        # Verify the metadata file exists
        file_id = file_info["file_id"]
        meta_path = mock_settings.STORAGE_DIR / "files_meta" / f"{file_id}.json"
        assert meta_path.exists()

        # Check the metadata content
        with open(meta_path, "r") as f:
            saved_meta = json.load(f)
        assert saved_meta["file_name"] == filename
        assert saved_meta["metadata"] == metadata

        # Verify the actual file exists
        file_path_components = [mock_settings.STORAGE_DIR, "files", file_id[:2], file_id[2:4], filename]
        file_path = Path(*file_path_components)
        assert file_path.exists()

        # Check the file content
        with open(file_path, "rb") as f:
            saved_content = f.read()
        assert saved_content == content

        # Test with file-like object
        from io import BytesIO

        file_obj = BytesIO(b"File object content")
        file_info2 = storage_client.save_file("file_obj.txt", file_obj)

        # Verify the file exists
        file_id2 = file_info2["file_id"]
        file_path2_components = [mock_settings.STORAGE_DIR, "files", file_id2[:2], file_id2[2:4], "file_obj.txt"]
        file_path2 = Path(*file_path2_components)
        assert file_path2.exists()

    def test_get_file(self, storage_client):
        """Test getting a file."""
        filename = "test_get_file.txt"
        content = b"Test get file content"

        # Save the file first
        file_info = storage_client.save_file(filename, content)
        file_id = file_info["file_id"]

        # Get the file
        retrieved_content = storage_client.get_file(file_id)
        assert retrieved_content == content

        # Test with nonexistent file
        with pytest.raises(StorageError, match="File not found"):
            storage_client.get_file("nonexistent-file-id")

    def test_get_file_info(self, storage_client):
        """Test getting file metadata."""
        filename = "test_file_info.txt"
        content = b"Test file info content"
        metadata = {"test_key": "test_value"}

        # Save the file first
        file_info = storage_client.save_file(filename, content, metadata)
        file_id = file_info["file_id"]

        # Get the file info
        retrieved_info = storage_client.get_file_info(file_id)

        # Check the info
        assert retrieved_info["file_name"] == filename
        assert retrieved_info["file_size"] == len(content)
        assert retrieved_info["metadata"] == metadata

        # Test with nonexistent file
        with pytest.raises(StorageError, match="File not found"):
            storage_client.get_file_info("nonexistent-file-id")

    def test_list_files(self, storage_client):
        """Test listing files with pagination."""
        # Save multiple files
        num_files = 15
        for i in range(num_files):
            storage_client.save_file(f"list_file_{i}.txt", f"Content {i}".encode(), {"index": i})

        # Test default pagination
        result = storage_client.list_files()
        assert result["total"] == num_files
        assert len(result["files"]) == num_files
        assert result["page"] == 1
        assert result["page_size"] == 100

        # Test custom pagination
        page_size = 5
        result = storage_client.list_files(page=1, page_size=page_size)
        assert result["total"] == num_files
        assert len(result["files"]) == page_size
        assert result["page"] == 1
        assert result["page_size"] == page_size

        # Test second page
        result = storage_client.list_files(page=2, page_size=page_size)
        assert result["total"] == num_files
        assert len(result["files"]) == page_size
        assert result["page"] == 2

        # Test sorting
        # Default is by uploaded_at descending
        result = storage_client.list_files(sort_by="file_name", sort_desc=False)
        names = [f["file_name"] for f in result["files"]]
        assert sorted(names) == names

        result = storage_client.list_files(sort_by="file_name", sort_desc=True)
        names = [f["file_name"] for f in result["files"]]
        assert sorted(names, reverse=True) == names

    def test_delete_file(self, storage_client):
        """Test deleting a file."""
        filename = "test_delete_file.txt"
        content = b"Test delete file content"

        # Save the file first
        file_info = storage_client.save_file(filename, content)
        file_id = file_info["file_id"]

        # Delete the file
        result = storage_client.delete_file(file_id)
        assert result is True

        # Verify it's gone
        with pytest.raises(StorageError, match="File not found"):
            storage_client.get_file(file_id)

        with pytest.raises(StorageError, match="File not found"):
            storage_client.get_file_info(file_id)

        # Test deleting a nonexistent file
        result = storage_client.delete_file("nonexistent-file-id")
        assert result is False

    def test_extract_strings(self, storage_client):
        """Test extracting strings from a file."""
        # Create a file with both ASCII and Unicode strings
        content = b"Hello, world!\x00\x00\x00This is a test.\x00\x00"
        content += "Unicode test string".encode("utf-16le")

        file_info = storage_client.save_file("strings_test.bin", content)
        file_id = file_info["file_id"]

        # Extract strings with default settings
        result = storage_client.extract_strings(file_id)

        # Check the result structure
        assert result["file_id"] == file_id
        assert result["file_name"] == "strings_test.bin"
        assert "strings" in result
        assert "total_strings" in result
        assert result["min_length"] == 4
        assert result["include_unicode"] is True
        assert result["include_ascii"] is True

        # Check with custom settings
        result = storage_client.extract_strings(file_id, min_length=10, include_unicode=False, limit=1)
        assert result["min_length"] == 10
        assert result["include_unicode"] is False
        assert result["include_ascii"] is True
        assert len(result["strings"]) <= 1  # Might be 0 if no strings meet criteria

        # Test with nonexistent file
        with pytest.raises(StorageError, match="File not found"):
            storage_client.extract_strings("nonexistent-file-id")

    def test_get_hex_view(self, storage_client):
        """Test getting a hex view of a file."""
        # Create a test file with varied content
        content = bytes(range(0, 128))  # 0-127 byte values
        file_info = storage_client.save_file("hex_test.bin", content)
        file_id = file_info["file_id"]

        # Get hex view with default settings
        result = storage_client.get_hex_view(file_id)

        # Check the result structure
        assert result["file_id"] == file_id
        assert result["file_name"] == "hex_test.bin"
        assert "hex_content" in result
        assert result["offset"] == 0
        assert result["bytes_per_line"] == 16
        assert result["total_size"] == len(content)

        # The hex view should contain string representations
        assert "00000000" in result["hex_content"]  # Offset
        assert "00 01 02 03" in result["hex_content"]  # Hex values

        # Test with custom settings
        result = storage_client.get_hex_view(file_id, offset=16, length=32, bytes_per_line=8)
        assert result["offset"] == 16
        assert result["length"] == 32
        assert result["bytes_per_line"] == 8

        # Now the hex view should start at 16 (0x10)
        assert "00000010" in result["hex_content"]

        # Test with offset beyond file size
        result = storage_client.get_hex_view(file_id, offset=1000)
        assert result["hex_content"] == ""

        # Test with nonexistent file
        with pytest.raises(StorageError, match="File not found"):
            storage_client.get_hex_view("nonexistent-file-id")
