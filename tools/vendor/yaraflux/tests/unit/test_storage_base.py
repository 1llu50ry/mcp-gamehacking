"""Unit tests for the storage base module."""

import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict
from unittest.mock import MagicMock, Mock, patch

import pytest

from yaraflux_mcp_server.storage.base import StorageClient, StorageError


class MockStorageClient(StorageClient):
    """Mock storage client for testing the abstract base class."""

    def __init__(self):
        """Initialize mock storage client."""
        self.rules = {}
        self.files = {}
        self.results = {}
        self.samples = {}
        self.strings = {}

    def save_rule(self, name: str, content: str, source: str = "custom") -> bool:
        """Save a YARA rule."""
        key = f"{source}:{name}"
        self.rules[key] = content
        return True

    def get_rule(self, name: str, source: str = "custom") -> str:
        """Get a YARA rule's content."""
        key = f"{source}:{name}"
        if key not in self.rules:
            raise StorageError(f"Rule not found: {key}")
        return self.rules[key]

    def delete_rule(self, name: str, source: str = "custom") -> bool:
        """Delete a YARA rule."""
        key = f"{source}:{name}"
        if key not in self.rules:
            return False
        del self.rules[key]
        return True

    def list_rules(self, source: str = None) -> list:
        """List YARA rules."""
        result = []
        for key, content in self.rules.items():
            rule_source, name = key.split(":", 1)
            if source and rule_source != source:
                continue
            result.append(
                {
                    "name": name,
                    "source": rule_source,
                    "created": datetime.now(UTC),
                    "modified": None,
                }
            )
        return result

    def save_file(self, file_name: str, data: bytes, metadata: Dict = None) -> Dict:
        """Save a file."""
        file_id = f"test-file-{len(self.files) + 1}"
        self.files[file_id] = {
            "file_id": file_id,
            "file_name": file_name,
            "file_size": len(data),
            "file_hash": "test-hash",
            "data": data,
            "metadata": metadata or {},
        }
        return self.files[file_id]

    def get_file(self, file_id: str) -> bytes:
        """Get file data."""
        if file_id not in self.files:
            raise StorageError(f"File not found: {file_id}")
        return self.files[file_id]["data"]

    def get_file_info(self, file_id: str) -> Dict:
        """Get file metadata."""
        if file_id not in self.files:
            raise StorageError(f"File not found: {file_id}")
        file_info = self.files[file_id].copy()
        # Remove data from info
        if "data" in file_info:
            del file_info["data"]
        return file_info

    def delete_file(self, file_id: str) -> bool:
        """Delete a file."""
        if file_id not in self.files:
            return False
        del self.files[file_id]
        return True

    def list_files(
        self, page: int = 1, page_size: int = 100, sort_by: str = "uploaded_at", sort_desc: bool = True
    ) -> Dict:
        """List files."""
        files = list(self.files.values())
        # Simple pagination
        start = (page - 1) * page_size
        end = start + page_size
        return {
            "files": files[start:end],
            "total": len(files),
            "page": page,
            "page_size": page_size,
        }

    def save_result(self, result_id: str, result_data: Dict) -> str:
        """Save a scan result."""
        self.results[result_id] = result_data
        return result_id

    def get_result(self, result_id: str) -> Dict:
        """Get a scan result."""
        if result_id not in self.results:
            raise StorageError(f"Result not found: {result_id}")
        return self.results[result_id]

    def save_sample(self, file_name: str, data: bytes) -> tuple:
        """Save a sample file."""
        sample_id = f"sample-{len(self.samples) + 1}"
        temp_file = tempfile.NamedTemporaryFile(delete=False)
        temp_file.write(data)
        temp_file.close()
        self.samples[sample_id] = {
            "file_path": temp_file.name,
            "file_hash": "test-hash",
            "sample_id": sample_id,
            "data": data,
        }
        return temp_file.name, "test-hash"

    def get_sample(self, sample_id: str) -> bytes:
        """Get sample data."""
        if sample_id not in self.samples:
            raise StorageError(f"Sample not found: {sample_id}")
        return self.samples[sample_id]["data"]

    def extract_strings(
        self,
        file_id: str,
        min_length: int = 4,
        include_unicode: bool = True,
        include_ascii: bool = True,
        limit: int = None,
    ) -> Dict:
        """Extract strings from a file."""
        if file_id not in self.files:
            raise StorageError(f"File not found: {file_id}")

        # Mock extracted strings
        strings = [
            {"string": "test_string_1", "offset": 0, "string_type": "ascii"},
            {"string": "test_string_2", "offset": 100, "string_type": "unicode"},
        ]

        if limit is not None and limit > 0:
            strings = strings[:limit]

        return {
            "file_id": file_id,
            "file_name": self.files[file_id]["file_name"],
            "strings": strings,
            "total_strings": len(strings),
            "min_length": min_length,
            "include_unicode": include_unicode,
            "include_ascii": include_ascii,
        }

    def get_hex_view(self, file_id: str, offset: int = 0, length: int = None, bytes_per_line: int = 16) -> Dict:
        """Get a hex view of file content."""
        if file_id not in self.files:
            raise StorageError(f"File not found: {file_id}")

        data = self.files[file_id]["data"]
        total_size = len(data)

        if length is None:
            length = min(256, total_size - offset)

        if offset >= total_size:
            offset = 0
            length = 0

        # Create a simple hex representation
        hex_content = ""
        for i in range(0, min(length, total_size - offset), bytes_per_line):
            chunk = data[offset + i : offset + i + bytes_per_line]
            hex_line = " ".join(f"{b:02x}" for b in chunk)
            ascii_line = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
            hex_content += f"{offset + i:08x}  {hex_line.ljust(bytes_per_line * 3)}  |{ascii_line}|\n"

        return {
            "file_id": file_id,
            "file_name": self.files[file_id]["file_name"],
            "hex_content": hex_content,
            "offset": offset,
            "length": length,
            "total_size": total_size,
            "bytes_per_line": bytes_per_line,
        }


def test_storage_error():
    """Test the StorageError exception."""
    # Create a StorageError
    error = StorageError("Test error message")

    # Check the error message
    assert str(error) == "Test error message"

    # Check that it's a subclass of Exception
    assert isinstance(error, Exception)


def test_mock_storage_client():
    """Test the mock storage client implementation."""
    # Create a storage client
    client = MockStorageClient()

    # Test rule operations
    rule_name = "test_rule.yar"
    rule_content = "rule TestRule { condition: true }"

    # Save a rule
    assert client.save_rule(rule_name, rule_content, "custom") is True

    # Get the rule
    assert client.get_rule(rule_name, "custom") == rule_content

    # List rules
    rules = client.list_rules()
    assert len(rules) == 1
    assert rules[0]["name"] == rule_name
    assert rules[0]["source"] == "custom"

    # Test file operations
    file_name = "test_file.txt"
    file_data = b"Test file content"

    # Save a file
    file_info = client.save_file(file_name, file_data)
    assert file_info["file_name"] == file_name
    assert file_info["file_size"] == len(file_data)

    # Get file data
    file_id = file_info["file_id"]
    assert client.get_file(file_id) == file_data

    # Get file info
    info = client.get_file_info(file_id)
    assert info["file_name"] == file_name
    assert "data" not in info  # Data should be excluded

    # List files
    files_result = client.list_files()
    assert files_result["total"] == 1
    assert files_result["files"][0]["file_name"] == file_name

    # Test result operations
    result_id = "test-result-id"
    result_data = {"test": "result"}

    # Save a result
    assert client.save_result(result_id, result_data) == result_id

    # Get the result
    assert client.get_result(result_id) == result_data

    # Test sample operations
    sample_name = "test_sample.bin"
    sample_data = b"Test sample data"

    # Save a sample
    file_path, file_hash = client.save_sample(sample_name, sample_data)

    assert os.path.exists(file_path)
    assert file_hash == "test-hash"

    # Clean up
    os.unlink(file_path)


def test_missing_rule():
    """Test error handling for missing rules."""
    client = MockStorageClient()

    # Try to get a nonexistent rule
    with pytest.raises(StorageError) as exc_info:
        client.get_rule("nonexistent_rule.yar", "custom")

    assert "Rule not found" in str(exc_info.value)


def test_missing_file():
    """Test error handling for missing files."""
    client = MockStorageClient()

    # Try to get a nonexistent file
    with pytest.raises(StorageError) as exc_info:
        client.get_file("nonexistent-file-id")

    assert "File not found" in str(exc_info.value)

    # Try to get info for a nonexistent file
    with pytest.raises(StorageError) as exc_info:
        client.get_file_info("nonexistent-file-id")

    assert "File not found" in str(exc_info.value)


def test_missing_result():
    """Test error handling for missing results."""
    client = MockStorageClient()

    # Try to get a nonexistent result
    with pytest.raises(StorageError) as exc_info:
        client.get_result("nonexistent-result-id")

    assert "Result not found" in str(exc_info.value)


def test_delete_operations():
    """Test delete operations for rules and files."""
    client = MockStorageClient()

    # Add a rule and a file
    rule_name = "delete_rule.yar"
    rule_content = "rule DeleteRule { condition: true }"
    client.save_rule(rule_name, rule_content)

    file_name = "delete_file.txt"
    file_data = b"Delete me"
    file_info = client.save_file(file_name, file_data)
    file_id = file_info["file_id"]

    # Delete the rule
    assert client.delete_rule(rule_name) is True

    # Verify rule is gone
    with pytest.raises(StorageError):
        client.get_rule(rule_name)

    # Delete the file
    assert client.delete_file(file_id) is True

    # Verify file is gone
    with pytest.raises(StorageError):
        client.get_file(file_id)


def test_pagination():
    """Test file listing with pagination."""
    client = MockStorageClient()

    # Add multiple files
    for i in range(10):
        file_name = f"pagination_file_{i}.txt"
        client.save_file(file_name, f"Content {i}".encode())

    # Test default pagination
    result = client.list_files()
    assert result["total"] == 10
    assert len(result["files"]) == 10
    assert result["page"] == 1
    assert result["page_size"] == 100

    # Test with custom page size
    result = client.list_files(page=1, page_size=5)
    assert result["total"] == 10
    assert len(result["files"]) == 5
    assert result["page"] == 1
    assert result["page_size"] == 5

    # Test second page
    result = client.list_files(page=2, page_size=5)
    assert result["total"] == 10
    assert len(result["files"]) == 5
    assert result["page"] == 2
    assert result["page_size"] == 5

    # Test empty page (beyond available data)
    result = client.list_files(page=3, page_size=5)
    assert result["total"] == 10
    assert len(result["files"]) == 0
    assert result["page"] == 3
    assert result["page_size"] == 5
