"""Common test fixtures for YaraFlux MCP Server tests."""

from unittest.mock import Mock

import pytest

# Configure pytest-asyncio
pytest_plugins = ["pytest_asyncio"]

# Set asyncio fixture default scope to function
pytestmark = pytest.mark.asyncio(scope="function")

from yaraflux_mcp_server.auth import _user_db  # noqa
from yaraflux_mcp_server.models import UserInDB
from yaraflux_mcp_server.storage.base import StorageClient


@pytest.fixture(autouse=True)
def clean_user_db():
    """Clean up the user database before and after each test."""
    _user_db.clear()
    yield
    _user_db.clear()


@pytest.fixture
def mock_storage():
    """Create a mock storage client with user management methods."""
    storage = Mock(spec=StorageClient)

    # Add user management methods that aren't in StorageClient base class
    storage.get_user = Mock()
    storage.save_user = Mock()
    storage.delete_user = Mock()
    storage.list_users = Mock(return_value=[])

    return storage


@pytest.fixture
def mock_user_db():
    """Create a mock user database."""
    return {}


@pytest.fixture
def test_user_data():
    """Test user data fixture."""
    return {"username": "testuser", "password": "testpass123", "is_admin": False, "disabled": False}


@pytest.fixture
def test_user(test_user_data, clean_user_db):
    """Create a test UserInDB instance."""
    from yaraflux_mcp_server.auth import get_password_hash

    return UserInDB(
        username=test_user_data["username"],
        hashed_password=get_password_hash(test_user_data["password"]),
        is_admin=test_user_data["is_admin"],
        disabled=test_user_data["disabled"],
    )
