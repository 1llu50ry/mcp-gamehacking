"""Unit tests for rules router."""

from io import BytesIO
from unittest.mock import MagicMock, Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from yaraflux_mcp_server.auth import get_current_active_user, validate_admin
from yaraflux_mcp_server.models import User, UserRole, YaraRuleMetadata
from yaraflux_mcp_server.routers.rules import router
from yaraflux_mcp_server.yara_service import YaraError

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
def sample_rule_metadata():
    """Sample rule metadata fixture."""
    return YaraRuleMetadata(
        name="test_rule",
        source="custom",
        type="text",
        description="Test rule",
        author="Test Author",
        created_at="2025-01-01T00:00:00",
        updated_at="2025-01-01T00:00:00",
        tags=["test"],
    )


@pytest.fixture
def sample_rule_content():
    """Sample rule content fixture."""
    return """
    rule test_rule {
        meta:
            description = "Test rule"
            author = "Test Author"
        strings:
            $a = "test string"
        condition:
            $a
    }
    """


class TestListRules:
    """Tests for list_rules endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_list_rules_success(self, mock_yara_service, client_with_user, sample_rule_metadata):
        """Test listing rules successfully."""
        # Setup mock
        mock_yara_service.list_rules.return_value = [sample_rule_metadata]

        # Make request
        response = client_with_user.get("/rules/")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert len(result) == 1
        assert result[0]["name"] == "test_rule"
        assert result[0]["source"] == "custom"

        # Verify service was called
        mock_yara_service.list_rules.assert_called_once_with(None)

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_list_rules_with_source(self, mock_yara_service, client_with_user, sample_rule_metadata):
        """Test listing rules with source filter."""
        # Setup mock
        mock_yara_service.list_rules.return_value = [sample_rule_metadata]

        # Make request
        response = client_with_user.get("/rules/?source=custom")

        # Check response
        assert response.status_code == 200

        # Verify service was called with source
        mock_yara_service.list_rules.assert_called_once_with("custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_list_rules_error(self, mock_yara_service, client_with_user):
        """Test listing rules with error."""
        # Setup mock with error
        mock_yara_service.list_rules.side_effect = YaraError("Failed to list rules")

        # Make request
        response = client_with_user.get("/rules/")

        # Check response
        assert response.status_code == 500
        assert "Failed to list rules" in response.json()["detail"]


class TestGetRule:
    """Tests for get_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_get_rule_success(self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content):
        """Test getting rule successfully."""
        # Setup mocks
        mock_yara_service.get_rule.return_value = sample_rule_content
        mock_yara_service.list_rules.return_value = [sample_rule_metadata]

        # Make request
        response = client_with_user.get("/rules/test_rule")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"
        assert result["source"] == "custom"
        assert "test string" in result["content"]
        assert "metadata" in result

        # Verify service was called
        mock_yara_service.get_rule.assert_called_once_with("test_rule", "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_get_rule_with_source(self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content):
        """Test getting rule with specific source."""
        # Setup mocks
        mock_yara_service.get_rule.return_value = sample_rule_content
        mock_yara_service.list_rules.return_value = [sample_rule_metadata]

        # Make request
        response = client_with_user.get("/rules/test_rule?source=community")

        # Check response
        assert response.status_code == 200

        # Verify service was called with correct source
        mock_yara_service.get_rule.assert_called_once_with("test_rule", "community")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_get_rule_not_found(self, mock_yara_service, client_with_user):
        """Test getting non-existent rule."""
        # Setup mock with error
        mock_yara_service.get_rule.side_effect = YaraError("Rule not found")

        # Make request
        response = client_with_user.get("/rules/nonexistent_rule")

        # Check response
        assert response.status_code == 404
        assert "Rule not found" in response.json()["detail"]


class TestGetRuleRaw:
    """Tests for get_rule_raw endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_get_rule_raw_success(self, mock_yara_service, client_with_user, sample_rule_content):
        """Test getting raw rule content successfully."""
        # Setup mock
        mock_yara_service.get_rule.return_value = sample_rule_content

        # Make request
        response = client_with_user.get("/rules/test_rule/raw")

        # Check response
        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]
        assert "test string" in response.text

        # Verify service was called
        mock_yara_service.get_rule.assert_called_once_with("test_rule", "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_get_rule_raw_not_found(self, mock_yara_service, client_with_user):
        """Test getting raw content for non-existent rule."""
        # Setup mock with error
        mock_yara_service.get_rule.side_effect = YaraError("Rule not found")

        # Make request
        response = client_with_user.get("/rules/nonexistent_rule/raw")

        # Check response
        assert response.status_code == 404
        assert "Rule not found" in response.json()["detail"]


class TestCreateRule:
    """Tests for create_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_create_rule_success(self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content):
        """Test creating rule successfully."""
        # Setup mock
        mock_yara_service.add_rule.return_value = sample_rule_metadata

        # Prepare request data
        rule_data = {"name": "test_rule", "content": sample_rule_content, "source": "custom"}

        # Make request
        response = client_with_user.post("/rules/", json=rule_data)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"
        assert result["source"] == "custom"

        # Verify service was called
        mock_yara_service.add_rule.assert_called_once_with("test_rule", sample_rule_content)

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_create_rule_invalid(self, mock_yara_service, client_with_user):
        """Test creating invalid rule."""
        # Setup mock with error
        mock_yara_service.add_rule.side_effect = YaraError("Invalid YARA syntax")

        # Prepare request data
        rule_data = {"name": "invalid_rule", "content": "invalid content", "source": "custom"}

        # Make request
        response = client_with_user.post("/rules/", json=rule_data)

        # Check response
        assert response.status_code == 400
        assert "Invalid YARA syntax" in response.json()["detail"]


class TestUploadRule:
    """Tests for upload_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_upload_rule_success(self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content):
        """Test uploading rule file successfully."""
        # Setup mock
        mock_yara_service.add_rule.return_value = sample_rule_metadata

        # Create test file
        file_content = sample_rule_content.encode("utf-8")
        file = {"rule_file": ("test_rule.yar", BytesIO(file_content), "text/plain")}

        # Additional form data
        data = {"source": "custom"}

        # Make request
        response = client_with_user.post("/rules/upload", files=file, data=data)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"

        # Verify service was called correctly
        mock_yara_service.add_rule.assert_called_once_with("test_rule.yar", sample_rule_content, "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_upload_rule_invalid(self, mock_yara_service, client_with_user):
        """Test uploading invalid rule file."""
        # Setup mock with error
        mock_yara_service.add_rule.side_effect = YaraError("Invalid YARA syntax")

        # Create test file
        file_content = b"invalid rule content"
        file = {"rule_file": ("invalid.yar", BytesIO(file_content), "text/plain")}

        # Make request
        response = client_with_user.post("/rules/upload", files=file)

        # Check response
        assert response.status_code == 400
        assert "Invalid YARA syntax" in response.json()["detail"]

    def test_upload_rule_no_file(self, client_with_user):
        """Test uploading without file."""
        # Make request without file
        response = client_with_user.post("/rules/upload")

        # Check response
        assert response.status_code == 422  # Validation error
        assert "field required" in response.text.lower()


class TestUpdateRule:
    """Tests for update_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_update_rule_success(self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content):
        """Test updating rule successfully."""
        # Setup mock
        mock_yara_service.update_rule.return_value = sample_rule_metadata

        # Make request
        response = client_with_user.put("/rules/test_rule", json=sample_rule_content)

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"

        # Verify service was called correctly
        mock_yara_service.update_rule.assert_called_once_with("test_rule", sample_rule_content, "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_update_rule_not_found(self, mock_yara_service, client_with_user, sample_rule_content):
        """Test updating non-existent rule."""
        # Setup mock with not found error
        mock_yara_service.update_rule.side_effect = YaraError("Rule not found")

        # Make request
        response = client_with_user.put("/rules/nonexistent_rule", json=sample_rule_content)

        # Check response
        assert response.status_code == 404
        assert "Rule not found" in response.json()["detail"]

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_update_rule_invalid(self, mock_yara_service, client_with_user):
        """Test updating rule with invalid content."""
        # Setup mock with validation error
        mock_yara_service.update_rule.side_effect = YaraError("Invalid YARA syntax")

        # Make request
        response = client_with_user.put("/rules/test_rule", json="invalid content")

        # Check response
        assert response.status_code == 400
        assert "Invalid YARA syntax" in response.json()["detail"]


class TestUpdateRulePlain:
    """Tests for update_rule_plain endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_update_rule_plain_success(
        self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content
    ):
        """Test updating rule with plain text successfully."""
        # Setup mock
        mock_yara_service.update_rule.return_value = sample_rule_metadata

        # Make request with plain text content
        response = client_with_user.put(
            "/rules/test_rule/plain?source=custom", content=sample_rule_content, headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"

        # Verify service was called correctly
        mock_yara_service.update_rule.assert_called_once_with("test_rule", sample_rule_content, "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_update_rule_plain_not_found(self, mock_yara_service, client_with_user, sample_rule_content):
        """Test updating non-existent rule with plain text."""
        # Setup mock with not found error
        mock_yara_service.update_rule.side_effect = YaraError("Rule not found")

        # Make request
        response = client_with_user.put(
            "/rules/nonexistent_rule/plain", content=sample_rule_content, headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 404
        assert "Rule not found" in response.json()["detail"]


class TestDeleteRule:
    """Tests for delete_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_delete_rule_success(self, mock_yara_service, client_with_user):
        """Test deleting rule successfully."""
        # Setup mock
        mock_yara_service.delete_rule.return_value = True

        # Make request
        response = client_with_user.delete("/rules/test_rule")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert "deleted" in result["message"]

        # Verify service was called correctly
        mock_yara_service.delete_rule.assert_called_once_with("test_rule", "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_delete_rule_not_found(self, mock_yara_service, client_with_user):
        """Test deleting non-existent rule."""
        # Setup mock with not found result
        mock_yara_service.delete_rule.return_value = False

        # Make request
        response = client_with_user.delete("/rules/nonexistent_rule")

        # Check response
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_delete_rule_error(self, mock_yara_service, client_with_user):
        """Test deleting rule with error."""
        # Setup mock with error
        mock_yara_service.delete_rule.side_effect = YaraError("Failed to delete rule")

        # Make request
        response = client_with_user.delete("/rules/test_rule")

        # Check response
        assert response.status_code == 500
        assert "Failed to delete rule" in response.json()["detail"]


class TestImportRules:
    """Tests for import_rules endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.import_rules_tool")
    def test_import_rules_success(self, mock_import_tool, client_with_admin):
        """Test importing rules successfully as admin."""
        # Setup mock
        mock_import_tool.return_value = {
            "success": True,
            "message": "Rules imported successfully",
            "imported": 10,
            "failed": 0,
        }

        # Make request
        response = client_with_admin.post("/rules/import")

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert result["imported"] == 10

        # Verify tool was called with default parameters
        mock_import_tool.assert_called_once_with(None)

    @patch("yaraflux_mcp_server.routers.rules.import_rules_tool")
    def test_import_rules_with_params(self, mock_import_tool, client_with_admin):
        """Test importing rules with custom parameters."""
        # Setup mock
        mock_import_tool.return_value = {"success": True, "message": "Rules imported successfully"}

        # Make request with custom parameters
        response = client_with_admin.post("/rules/import?url=https://example.com/repo&branch=develop")

        # Check response
        assert response.status_code == 200

        # Verify tool was called with custom parameters
        mock_import_tool.assert_called_once_with("https://example.com/repo")

    @patch("yaraflux_mcp_server.routers.rules.import_rules_tool")
    def test_import_rules_failure(self, mock_import_tool, client_with_admin):
        """Test import failure."""
        # Setup mock with failure result
        mock_import_tool.return_value = {"success": False, "message": "Import failed", "error": "Network error"}

        # Make request
        response = client_with_admin.post("/rules/import")

        # Check response
        assert response.status_code == 500
        assert "Import failed" in response.json()["detail"]

    def test_import_rules_non_admin(self, client_with_user):
        """Test import attempt by non-admin user."""
        # Make request with non-admin client
        response = client_with_user.post("/rules/import")

        # Check response - should be blocked by auth
        assert response.status_code == 403


class TestValidateRule:
    """Tests for validate_rule endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.validate_rule_tool")
    def test_validate_rule_json_success(self, mock_validate_tool, client_with_user, sample_rule_content):
        """Test validating rule successfully with JSON content."""
        # Setup mock
        mock_validate_tool.return_value = {"valid": True, "message": "Rule is valid"}

        # Make request with JSON format
        response = client_with_user.post("/rules/validate", json={"content": sample_rule_content})

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is True

        # Verify validation was called
        mock_validate_tool.assert_called_once()

    @patch("yaraflux_mcp_server.routers.rules.validate_rule_tool")
    def test_validate_rule_plain_success(self, mock_validate_tool, client_with_user, sample_rule_content):
        """Test validating rule successfully with plain text content."""
        # Setup mock
        mock_validate_tool.return_value = {"valid": True, "message": "Rule is valid"}

        # Make request with plain text
        response = client_with_user.post(
            "/rules/validate", content=sample_rule_content, headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is True

        # Verify validation was called with the plain text content
        mock_validate_tool.assert_called_once_with(sample_rule_content)

    @patch("yaraflux_mcp_server.routers.rules.validate_rule_tool")
    def test_validate_rule_invalid(self, mock_validate_tool, client_with_user):
        """Test validating invalid rule."""
        # Setup mock for invalid rule
        mock_validate_tool.return_value = {
            "valid": False,
            "message": "Syntax error",
            "error_details": "line 3: syntax error, unexpected identifier",
        }

        # Make request with invalid content
        response = client_with_user.post(
            "/rules/validate", content="invalid rule", headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 200  # Still 200 even for invalid rules
        result = response.json()
        assert result["valid"] is False
        assert "Syntax error" in result["message"]


class TestValidateRulePlain:
    """Tests for validate_rule_plain endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.validate_rule_tool")
    def test_validate_rule_plain_success(self, mock_validate_tool, client_with_user, sample_rule_content):
        """Test validating rule with plain text endpoint."""
        # Setup mock
        mock_validate_tool.return_value = {"valid": True, "message": "Rule is valid"}

        # Make request
        response = client_with_user.post(
            "/rules/validate/plain", content=sample_rule_content, headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is True

        # Verify tool was called with correct content
        mock_validate_tool.assert_called_once_with(sample_rule_content)

    @patch("yaraflux_mcp_server.routers.rules.validate_rule_tool")
    def test_validate_rule_plain_invalid(self, mock_validate_tool, client_with_user):
        """Test validating invalid rule with plain text endpoint."""
        # Setup mock for invalid rule
        mock_validate_tool.return_value = {"valid": False, "message": "Syntax error at line 5"}

        # Make request with invalid content
        invalid_content = 'rule invalid { strings: $a = "test condition: invalid }'
        response = client_with_user.post(
            "/rules/validate/plain", content=invalid_content, headers={"Content-Type": "text/plain"}
        )

        # Check response
        assert response.status_code == 200  # Still 200 for invalid rules
        result = response.json()
        assert result["valid"] is False
        assert "Syntax error" in result["message"]


class TestCreateRulePlain:
    """Tests for create_rule_plain endpoint."""

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_create_rule_plain_success(
        self, mock_yara_service, client_with_user, sample_rule_metadata, sample_rule_content
    ):
        """Test creating rule with plain text successfully."""
        # Setup mock
        mock_yara_service.add_rule.return_value = sample_rule_metadata

        # Make request
        response = client_with_user.post(
            "/rules/plain?rule_name=test_rule&source=custom",
            content=sample_rule_content,
            headers={"Content-Type": "text/plain"},
        )

        # Check response
        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "test_rule"
        assert result["source"] == "custom"

        # Verify service was called correctly
        mock_yara_service.add_rule.assert_called_once_with("test_rule", sample_rule_content, "custom")

    @patch("yaraflux_mcp_server.routers.rules.yara_service")
    def test_create_rule_plain_invalid(self, mock_yara_service, client_with_user):
        """Test creating rule with invalid plain text."""
        # Setup mock with error
        mock_yara_service.add_rule.side_effect = YaraError("Invalid YARA syntax")

        # Make request with invalid content
        response = client_with_user.post(
            "/rules/plain?rule_name=invalid_rule",
            content="invalid rule content",
            headers={"Content-Type": "text/plain"},
        )

        # Check response
        assert response.status_code == 400
        assert "Invalid YARA syntax" in response.json()["detail"]
