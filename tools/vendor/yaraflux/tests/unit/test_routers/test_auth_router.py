"""Unit tests for auth router endpoints."""

from datetime import datetime, timedelta
from typing import Dict, Optional
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import jwt
import pytest
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.testclient import TestClient

from yaraflux_mcp_server.auth import (
    User,
    UserInDB,
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_current_user,
    get_password_hash,
    get_user,
    verify_password,
)
from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.models import Token, TokenData, UserRole
from yaraflux_mcp_server.routers.auth import router


@pytest.fixture
def standard_client():
    """Create a test client for the app with regular user authentication."""
    from yaraflux_mcp_server.app import app

    # Create a test user
    test_user = User(
        username="testuser", email="test@example.com", full_name="Test User", disabled=False, role=UserRole.USER
    )

    # Override the dependencies
    async def override_get_current_user():
        return test_user

    # Use dependency_overrides to bypass authentication
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_current_active_user] = override_get_current_user

    client = TestClient(app)
    yield client

    # Clean up overrides after tests
    app.dependency_overrides = {}


@pytest.fixture
def admin_client():
    """Create a test client for the app with admin user authentication."""
    from yaraflux_mcp_server.app import app

    # Create an admin user
    admin_user = User(
        username="admin", email="admin@example.com", full_name="Admin User", disabled=False, role=UserRole.ADMIN
    )

    # Override the dependencies
    async def override_get_current_admin_user():
        return admin_user

    # Use dependency_overrides to bypass authentication
    app.dependency_overrides[get_current_user] = override_get_current_admin_user
    app.dependency_overrides[get_current_active_user] = override_get_current_admin_user

    client = TestClient(app)
    yield client

    # Clean up overrides after tests
    app.dependency_overrides = {}


@pytest.fixture
def test_user():
    """Create a test user for authentication tests."""
    return UserInDB(
        username="testuser",
        email="test@example.com",
        full_name="Test User",
        disabled=False,
        hashed_password=get_password_hash("testpassword"),
        role=UserRole.USER,
    )


class TestAuthEndpoints:
    """Tests for authentication API endpoints."""

    def test_login_for_access_token_success(self, standard_client):
        """Test successful login with valid credentials."""
        # Mock the authenticate_user and create_access_token functions
        with (
            patch("yaraflux_mcp_server.routers.auth.authenticate_user") as mock_authenticate_user,
            patch("yaraflux_mcp_server.routers.auth.create_access_token") as mock_create_access_token,
        ):

            # Set up the mock return values
            test_user = UserInDB(
                username="testuser",
                email="test@example.com",
                full_name="Test User",
                disabled=False,
                hashed_password="hashed_password",
                role=UserRole.USER,
            )

            mock_authenticate_user.return_value = test_user
            mock_create_access_token.return_value = "mocked_token"

            # Test login endpoint
            response = standard_client.post(
                "/api/v1/auth/token", data={"username": "testuser", "password": "testpassword"}
            )

            # Verify
            assert response.status_code == 200
            assert response.json() == {"access_token": "mocked_token", "token_type": "bearer"}
            mock_authenticate_user.assert_called_once()
            mock_create_access_token.assert_called_once()

    def test_login_for_access_token_invalid_credentials(self, standard_client):
        """Test login with invalid credentials."""
        # Mock authenticate_user to return False (authentication failure)
        with patch("yaraflux_mcp_server.routers.auth.authenticate_user") as mock_authenticate_user:
            mock_authenticate_user.return_value = False

            # Test login endpoint
            response = standard_client.post(
                "/api/v1/auth/token", data={"username": "testuser", "password": "wrongpassword"}
            )

            # Verify
            assert response.status_code == 401
            assert "detail" in response.json()
            assert response.json()["detail"] == "Incorrect username or password"
            mock_authenticate_user.assert_called_once()

    def test_read_users_me(self, standard_client):
        """Test the endpoint that returns the current user."""
        # Test endpoint
        response = standard_client.get("/api/v1/auth/users/me")

        # Verify
        assert response.status_code == 200
        user_data = response.json()

        # Check required fields
        assert user_data["username"] == "testuser"
        assert user_data["email"] == "test@example.com"
        assert "disabled" in user_data
        assert not user_data["disabled"]


class TestUserManagementEndpoints:
    """Tests for user management API endpoints."""

    def test_create_user(self, admin_client):
        """Test creating a new user."""
        # Mock the create_user function
        with patch("yaraflux_mcp_server.auth.create_user") as mock_create_user:
            # Set up mock return value for create_user
            new_user = UserInDB(
                username="newuser",
                email="new@example.com",
                full_name="New User",
                disabled=False,
                hashed_password="hashed_password",
                role=UserRole.USER,
            )
            mock_create_user.return_value = new_user

            # The create_user endpoint actually expects form parameters, not JSON
            response = admin_client.post(
                "/api/v1/auth/users",
                params={
                    "username": "newuser",
                    "password": "newpassword",
                    "role": UserRole.USER.value,
                    "email": "new@example.com",
                },
            )

            # Verify
            assert response.status_code == 200, f"Unexpected status code: {response.status_code}"
            user_data = response.json()
            assert user_data["username"] == "newuser"
            assert user_data["email"] == "new@example.com"
            assert "password" not in user_data

    def test_create_user_not_admin(self, standard_client):
        """Test that non-admin users cannot create new users."""
        # Test endpoint with standard (non-admin) user
        response = standard_client.post(
            "/api/v1/auth/users",
            params={
                "username": "newuser",
                "password": "newpassword",
                "role": UserRole.USER.value,
                "email": "new@example.com",
            },
        )

        # Verify
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin privileges required"

    def test_update_user(self, admin_client):
        """Test updating a user's details."""
        # Mock get_user and update_user directly where they are used in the router
        with patch("yaraflux_mcp_server.routers.auth.update_user") as mock_update_user:
            # The update function returns the updated user
            updated_user = UserInDB(
                username="existinguser",
                email="updated@example.com",
                full_name="Updated User",
                disabled=False,
                hashed_password="hashed_password",
                role=UserRole.USER,
            )
            mock_update_user.return_value = updated_user

            # Test endpoint - correct path
            response = admin_client.put(
                "/api/v1/auth/users/existinguser", params={"email": "updated@example.com", "role": UserRole.USER.value}
            )

            # The actual API returns a message object
            print(f"Update response: {response.json()}")
            assert response.status_code == 200
            assert response.json()["message"] == "User existinguser updated"

    def test_update_user_not_found(self, admin_client):
        """Test updating a non-existent user."""
        # Mock directly at the router level
        with patch("yaraflux_mcp_server.routers.auth.update_user") as mock_update_user:
            # Mock update_user to return None (user not found)
            mock_update_user.return_value = None

            # Test endpoint - correct path
            response = admin_client.put("/api/v1/auth/users/nonexistentuser", params={"email": "updated@example.com"})

            # Verify - the actual error message includes the username
            assert response.status_code == 404
            assert response.json()["detail"] == f"User nonexistentuser not found"

    def test_delete_user(self, admin_client):
        """Test deleting a user."""
        # Mock directly at the router level
        with patch("yaraflux_mcp_server.routers.auth.delete_user") as mock_delete_user:
            # Mock delete_user to return True
            mock_delete_user.return_value = True

            # Test endpoint
            response = admin_client.delete("/api/v1/auth/users/existinguser")

            # Verify - the actual API returns a success message with the username
            assert response.status_code == 200
            assert response.json() == {"message": "User existinguser deleted"}

    def test_delete_user_not_found(self, admin_client):
        """Test deleting a non-existent user."""
        # Mock directly at the router level
        with patch("yaraflux_mcp_server.routers.auth.delete_user") as mock_delete_user:
            # Mock delete_user to return False (user not found)
            mock_delete_user.return_value = False

            # Test endpoint
            response = admin_client.delete("/api/v1/auth/users/nonexistentuser")

            # Verify - the actual error message includes the username
            assert response.status_code == 404
            assert response.json()["detail"] == f"User nonexistentuser not found"
