"""Tests for user management functions in auth.py."""

from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from yaraflux_mcp_server.auth import (
    UserRole,
    authenticate_user,
    create_user,
    delete_user,
    get_user,
    list_users,
    update_user,
)
from yaraflux_mcp_server.models import User


def test_create_user():
    """Test successful user creation."""
    username = "create_test_user"
    password = "testpass123"
    role = UserRole.USER

    user = create_user(username=username, password=password, role=role)

    assert isinstance(user, User)
    assert user.username == username
    assert user.role == role
    assert not user.disabled


def test_get_user():
    """Test successful user retrieval."""
    # Create a user first
    username = "get_test_user"
    password = "testpass123"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Now retrieve it
    user = get_user(username)

    assert user is not None
    assert user.username == username
    assert user.role == role


def test_get_user_not_found():
    """Test user retrieval when user doesn't exist."""
    user = get_user("nonexistent_user")
    assert user is None


def test_list_users():
    """Test listing users."""
    # Create some users
    create_user(username="list_test_user1", password="pass1", role=UserRole.USER)
    create_user(username="list_test_user2", password="pass2", role=UserRole.ADMIN)

    users = list_users()

    assert isinstance(users, list)
    assert len(users) >= 2  # At least the two we just created
    assert all(isinstance(user, User) for user in users)

    # Check that our test users are in the list
    usernames = [u.username for u in users]
    assert "list_test_user1" in usernames
    assert "list_test_user2" in usernames


def test_authenticate_user_success():
    """Test successful user authentication."""
    username = "auth_test_user"
    password = "authpass123"

    # Create the user
    create_user(username=username, password=password, role=UserRole.USER)

    # Authenticate
    user = authenticate_user(username=username, password=password)

    assert user is not None
    assert user.username == username
    assert user.last_login is not None


def test_authenticate_user_wrong_password():
    """Test authentication with wrong password."""
    username = "auth_test_wrong_pass"
    password = "correctpass"

    # Create the user
    create_user(username=username, password=password, role=UserRole.USER)

    # Try to authenticate with wrong password
    user = authenticate_user(username=username, password="wrongpass")

    assert user is None


def test_authenticate_user_nonexistent():
    """Test authentication with nonexistent user."""
    user = authenticate_user(username="nonexistent_auth_user", password="anypassword")

    assert user is None


def test_update_user():
    """Test successful user update."""
    username = "update_test_user"
    password = "updatepass"

    # Create the user
    create_user(username=username, password=password, role=UserRole.USER)

    # Update the user
    updated = update_user(username=username, role=UserRole.ADMIN, email="test@example.com", disabled=True)

    assert isinstance(updated, User)
    assert updated.username == username
    assert updated.role == UserRole.ADMIN
    assert updated.email == "test@example.com"
    assert updated.disabled


def test_update_user_not_found():
    """Test updating nonexistent user."""
    result = update_user(username="nonexistent_update_user", role=UserRole.ADMIN)

    assert result is None


def test_delete_user():
    """Test successful user deletion."""
    username = "delete_test_user"
    password = "deletepass"

    # Create the user
    create_user(username=username, password=password, role=UserRole.USER)

    # Delete the user
    result = delete_user(username=username, current_username="admin")  # Some other username

    assert result is True
    assert get_user(username) is None


def test_delete_user_not_found():
    """Test deleting nonexistent user."""
    result = delete_user(username="nonexistent_delete_user", current_username="admin")

    assert result is False


def test_delete_user_self():
    """Test attempting to delete own account."""
    username = "self_delete_test_user"

    # Create the user
    create_user(username=username, password="selfdeletepass", role=UserRole.USER)

    # Try to delete yourself
    with pytest.raises(ValueError) as exc_info:
        delete_user(username=username, current_username=username)

    assert "Cannot delete your own account" in str(exc_info.value)
    assert get_user(username) is not None


def test_delete_last_admin():
    """Test attempting to delete the last admin user."""
    admin_username = "last_admin_test"

    # Create a single admin user
    create_user(username=admin_username, password="adminpass", role=UserRole.ADMIN)

    # Make sure this is the only admin (delete any other admins first)
    for user in list_users():
        if user.role == UserRole.ADMIN and user.username != admin_username:
            delete_user(user.username, "testuser")

    # Try to delete the last admin
    with pytest.raises(ValueError) as exc_info:
        delete_user(username=admin_username, current_username="testuser")

    assert "Cannot delete the last admin user" in str(exc_info.value)
    assert get_user(admin_username) is not None
