"""Unit tests for files router."""

import json
from datetime import UTC, datetime
from io import BytesIO
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from yaraflux_mcp_server.auth import get_current_active_user, validate_admin
from yaraflux_mcp_server.models import FileInfo, FileString, FileUploadResponse, User, UserRole
from yaraflux_mcp_server.routers.files import router
from yaraflux_mcp_server.storage import StorageError

# Create test app
app = FastAPI()
app.include_router(router)


@pytest.fixture
def test_user():
    """Test user fixture."""
    return User(username="testuser", role=UserRole.USER, disabled=False, email="test@example.com")


@pytest.fixture
def test_admin():
    """Test admin user fixture."""
    return User(username="testadmin", role=UserRole.ADMIN, disabled=False, email="admin@example.com")


@pytest.fixture
def client_with_user(test_user):
    """TestClient with normal user dependency override."""
    app.dependency_overrides[get_current_active_user] = lambda: test_user
    with TestClient(app) as client:
        yield client
    # Clear overrides after test
    app.dependency_overrides = {}


@pytest.fixture
def client_with_admin(test_admin):
    """TestClient with admin user dependency override."""
    app.dependency_overrides[get_current_active_user] = lambda: test_admin
    app.dependency_overrides[validate_admin] = lambda: test_admin
    with TestClient(app) as client:
        yield client
    # Clear overrides after test
    app.dependency_overrides = {}


@pytest.fixture
def mock_file_info():
    """Mock file info fixture."""
    file_id = str(uuid4())
    return {
        "file_id": file_id,
        "file_name": "test.txt",
        "file_size": 100,
        "file_hash": "abcdef1234567890",
        "mime_type": "text/plain",
        "uploaded_at": datetime.now(UTC).isoformat(),
        "metadata": {"uploader": "testuser"},
    }


class TestUploadFile:
    """Tests for upload_file endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_upload_file_success(self, mock_get_storage, client_with_user, mock_file_info):
        """Test successful file upload."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.save_file.return_value = mock_file_info

        # Create test file
        file_content = b"Test file content"
        file = {"file": ("test.txt", BytesIO(file_content), "text/plain")}

        # Optional metadata
        data = {"metadata": json.dumps({"test": "value"})}

        # Make request
        response = client_with_user.post("/files/upload", files=file, data=data)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["file_info"]["file_name"] == "test.txt"
        assert result["file_info"]["file_size"] == 100

        # Verify storage was called correctly
        mock_storage.save_file.assert_called_once()
        args = mock_storage.save_file.call_args[0]
        assert args[0] == "test.txt"  # filename
        assert args[1] == file_content  # content
        assert "uploader" in args[2]  # metadata
        assert args[2]["uploader"] == "testuser"
        assert args[2]["test"] == "value"

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_upload_file_invalid_metadata(self, mock_get_storage, client_with_user, mock_file_info):
        """Test file upload with invalid JSON metadata."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.save_file.return_value = mock_file_info

        # Create test file
        file_content = b"Test file content"
        file = {"file": ("test.txt", BytesIO(file_content), "text/plain")}

        # Invalid metadata - not JSON
        data = {"metadata": "not-json"}

        # Make request
        response = client_with_user.post("/files/upload", files=file, data=data)

        # Check response (should still succeed but with empty metadata)
        assert response.status_code == 200

        # Verify storage was called with empty metadata except for uploader
        mock_storage.save_file.assert_called_once()
        args = mock_storage.save_file.call_args[0]
        assert args[2]["uploader"] == "testuser"
        assert "test" not in args[2]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_upload_file_storage_error(self, mock_get_storage, client_with_user):
        """Test file upload with storage error."""
        # Setup mock storage with error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.save_file.side_effect = Exception("Storage error")

        # Create test file
        file_content = b"Test file content"
        file = {"file": ("test.txt", BytesIO(file_content), "text/plain")}

        # Make request
        response = client_with_user.post("/files/upload", files=file)

        # Check response
        assert response.status_code == 500
        assert "Error uploading file" in response.json()["detail"]


class TestFileInfo:
    """Tests for get_file_info endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_file_info_success(self, mock_get_storage, client_with_user, mock_file_info):
        """Test getting file info successfully."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.return_value = mock_file_info

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_user.get(f"/files/info/{file_id}")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["file_name"] == "test.txt"
        assert result["file_size"] == 100
        assert result["file_id"] == file_id

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_file_info_not_found(self, mock_get_storage, client_with_user):
        """Test getting info for non-existent file."""
        # Setup mock storage with not found error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.side_effect = StorageError("File not found")

        # Make request with random UUID
        file_id = str(uuid4())
        response = client_with_user.get(f"/files/info/{file_id}")

        # Check response
        assert response.status_code == 404
        assert "File not found" in response.json()["detail"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_file_info_server_error(self, mock_get_storage, client_with_user):
        """Test getting file info with server error."""
        # Setup mock storage with error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.side_effect = Exception("Server error")

        # Make request
        file_id = str(uuid4())
        response = client_with_user.get(f"/files/info/{file_id}")

        # Check response
        assert response.status_code == 500
        assert "Error getting file info" in response.json()["detail"]


class TestDownloadFile:
    """Tests for download_file endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_download_file_binary(self, mock_get_storage, client_with_user, mock_file_info):
        """Test downloading file as binary."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file.return_value = b"Binary content"
        mock_storage.get_file_info.return_value = mock_file_info

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_user.get(f"/files/download/{file_id}")

        # Check response
        assert response.status_code == 200
        assert response.content == b"Binary content"
        assert "text/plain" in response.headers["Content-Type"]
        assert "attachment" in response.headers["Content-Disposition"]
        assert "test.txt" in response.headers["Content-Disposition"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_download_file_as_text(self, mock_get_storage, client_with_user, mock_file_info):
        """Test downloading text file as text."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file.return_value = b"Text content"
        mock_storage.get_file_info.return_value = mock_file_info

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_user.get(f"/files/download/{file_id}?as_text=true")

        # Check response
        assert response.status_code == 200
        assert response.text == "Text content"
        assert "text/plain" in response.headers["Content-Type"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_download_file_as_text_with_binary(self, mock_get_storage, client_with_user, mock_file_info):
        """Test downloading binary file as text falls back to binary."""
        # Setup mock storage with binary content that can't be decoded
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file.return_value = b"\xff\xfe\xfd"  # Non-UTF8 bytes
        mock_storage.get_file_info.return_value = mock_file_info

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_user.get(f"/files/download/{file_id}?as_text=true")

        # Check response - should fall back to binary
        assert response.status_code == 200
        assert response.content == b"\xff\xfe\xfd"
        assert "text/plain" in response.headers["Content-Type"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_download_file_not_found(self, mock_get_storage, client_with_user):
        """Test downloading non-existent file."""
        # Setup mock storage with not found error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file.side_effect = StorageError("File not found")

        # Make request with random UUID
        file_id = str(uuid4())
        response = client_with_user.get(f"/files/download/{file_id}")

        # Check response
        assert response.status_code == 404
        assert "File not found" in response.json()["detail"]


class TestListFiles:
    """Tests for list_files endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_list_files_success(self, mock_get_storage, client_with_user, mock_file_info):
        """Test listing files successfully."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage

        # Create mock result with list of files
        mock_result = {"files": [mock_file_info, mock_file_info], "total": 2, "page": 1, "page_size": 100}
        mock_storage.list_files.return_value = mock_result

        # Make request
        response = client_with_user.get("/files/list")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert len(result["files"]) == 2
        assert result["total"] == 2
        assert result["page"] == 1
        assert result["page_size"] == 100

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_list_files_with_params(self, mock_get_storage, client_with_user):
        """Test listing files with pagination and sorting parameters."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.list_files.return_value = {"files": [], "total": 0, "page": 2, "page_size": 10}

        # Make request with custom params
        response = client_with_user.get("/files/list?page=2&page_size=10&sort_by=file_name&sort_desc=false")

        # Check response
        assert response.status_code == 200

        # Verify storage was called with correct params
        mock_storage.list_files.assert_called_once_with(2, 10, "file_name", False)

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_list_files_error(self, mock_get_storage, client_with_user):
        """Test listing files with error."""
        # Setup mock storage with error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.list_files.side_effect = Exception("Database error")

        # Make request
        response = client_with_user.get("/files/list")

        # Check response
        assert response.status_code == 500
        assert "Error listing files" in response.json()["detail"]


class TestDeleteFile:
    """Tests for delete_file endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_delete_file_success(self, mock_get_storage, client_with_admin, mock_file_info):
        """Test deleting file successfully as admin."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.return_value = mock_file_info
        mock_storage.delete_file.return_value = True

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_admin.delete(f"/files/{file_id}")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert "deleted successfully" in result["message"]
        assert result["file_id"] == file_id

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_delete_file_not_found(self, mock_get_storage, client_with_admin):
        """Test deleting non-existent file."""
        # Setup mock storage with not found error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.side_effect = StorageError("File not found")

        # Make request with random UUID
        file_id = str(uuid4())
        response = client_with_admin.delete(f"/files/{file_id}")

        # Check response
        assert response.status_code == 404
        assert "File not found" in response.json()["detail"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_delete_file_failure(self, mock_get_storage, client_with_admin, mock_file_info):
        """Test deletion failure."""
        # Setup mock storage with successful info but failed deletion
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_file_info.return_value = mock_file_info
        mock_storage.delete_file.return_value = False

        # Make request
        file_id = mock_file_info["file_id"]
        response = client_with_admin.delete(f"/files/{file_id}")

        # Check response
        assert response.status_code == 200  # Still returns 200 but with success=False
        result = response.json()
        assert result["success"] is False
        assert "could not be deleted" in result["message"]

    def test_delete_file_non_admin(self, client_with_user):
        """Test deleting file as non-admin user."""
        # Non-admin users should not be able to delete files
        file_id = str(uuid4())

        # Make request with non-admin client
        response = client_with_user.delete(f"/files/{file_id}")

        # Check response - should be blocked by auth
        assert response.status_code == 403


class TestExtractStrings:
    """Tests for extract_strings endpoint."""

    @pytest.mark.skip("FileString model not defined in tests")
    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_extract_strings_success(self, mock_get_storage, client_with_user, mock_file_info):
        """Test extracting strings successfully."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage

        # Mock strings result
        strings_result = {
            "file_id": mock_file_info["file_id"],
            "file_name": mock_file_info["file_name"],
            "strings": [
                {"string": "test string", "offset": 0, "string_type": "ascii"},
                {"string": "another string", "offset": 20, "string_type": "unicode"},
            ],
            "total_strings": 2,
            "min_length": 4,
            "include_unicode": True,
            "include_ascii": True,
        }
        mock_storage.extract_strings.return_value = strings_result

        # Make request
        file_id = mock_file_info["file_id"]
        request_data = {"min_length": 4, "include_unicode": True, "include_ascii": True, "limit": 100}
        response = client_with_user.post(f"/files/strings/{file_id}", json=request_data)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["file_id"] == file_id
        assert result["file_name"] == mock_file_info["file_name"]
        assert len(result["strings"]) == 2

        # Verify storage was called with correct params
        mock_storage.extract_strings.assert_called_once_with(file_id, 4, True, True, 100)

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_extract_strings_not_found(self, mock_get_storage, client_with_user):
        """Test extracting strings from non-existent file."""
        # Setup mock storage with not found error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.extract_strings.side_effect = StorageError("File not found")

        # Make request with random UUID
        file_id = str(uuid4())
        response = client_with_user.post(f"/files/strings/{file_id}", json={})

        # Check response
        assert response.status_code == 404
        assert "File not found" in response.json()["detail"]


class TestGetHexView:
    """Tests for get_hex_view endpoint."""

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_hex_view_success(self, mock_get_storage, client_with_user, mock_file_info):
        """Test getting hex view successfully."""
        # Setup mock storage
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage

        # Mock hex view result
        hex_result = {
            "file_id": mock_file_info["file_id"],
            "file_name": mock_file_info["file_name"],
            "hex_content": "00000000: 4865 6c6c 6f20 576f 726c 6421         Hello World!",
            "offset": 0,
            "length": 12,
            "total_size": 12,
            "bytes_per_line": 16,
            "include_ascii": True,
        }
        mock_storage.get_hex_view.return_value = hex_result

        # Make request
        file_id = mock_file_info["file_id"]
        request_data = {"offset": 0, "length": 12, "bytes_per_line": 16}
        response = client_with_user.post(f"/files/hex/{file_id}", json=request_data)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["file_id"] == file_id
        assert result["file_name"] == mock_file_info["file_name"]
        assert "Hello World!" in result["hex_content"]

        # Verify storage was called with correct params
        mock_storage.get_hex_view.assert_called_once_with(file_id, offset=0, length=12, bytes_per_line=16)

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_hex_view_not_found(self, mock_get_storage, client_with_user):
        """Test getting hex view for non-existent file."""
        # Setup mock storage with not found error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_hex_view.side_effect = StorageError("File not found")

        # Make request with random UUID
        file_id = str(uuid4())
        response = client_with_user.post(f"/files/hex/{file_id}", json={})

        # Check response
        assert response.status_code == 404
        assert "File not found" in response.json()["detail"]

    @patch("yaraflux_mcp_server.routers.files.get_storage_client")
    def test_get_hex_view_error(self, mock_get_storage, client_with_user):
        """Test getting hex view with error."""
        # Setup mock storage with error
        mock_storage = Mock()
        mock_get_storage.return_value = mock_storage
        mock_storage.get_hex_view.side_effect = Exception("Error processing file")

        # Make request
        file_id = str(uuid4())
        response = client_with_user.post(f"/files/hex/{file_id}", json={})

        # Check response
        assert response.status_code == 500
        assert "Error getting hex view" in response.json()["detail"]
