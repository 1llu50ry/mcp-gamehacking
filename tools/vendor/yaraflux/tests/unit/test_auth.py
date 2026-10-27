"""Unit tests for auth module."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from yaraflux_mcp_server.auth import (
    UserRole,
    authenticate_user,
    create_access_token,
    create_refresh_token,
    create_user,
    decode_token,
    delete_user,
    get_current_active_user,
    get_current_user,
    get_password_hash,
    get_user,
    list_users,
    refresh_access_token,
    update_user,
    validate_admin,
    verify_password,
)
from yaraflux_mcp_server.models import TokenData, User


def test_get_password_hash():
    """Test password hashing."""
    password = "testpassword"
    hashed = get_password_hash(password)

    # Verify it's not the original password
    assert hashed != password
    # Verify it's a bcrypt hash
    assert hashed.startswith("$2b$")


def test_verify_password():
    """Test password verification."""
    password = "testpassword"
    hashed = get_password_hash(password)

    # Verify correct password works
    assert verify_password(password, hashed)
    # Verify incorrect password fails
    assert not verify_password("wrongpassword", hashed)


def test_get_user_exists():
    """Test getting a user that exists."""
    # Create a user first
    username = "testuser"
    password = "testpass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Now get the user
    user = get_user(username)

    assert user is not None
    assert user.username == username
    assert user.role == role


def test_get_user_not_exists():
    """Test getting a user that doesn't exist."""
    user = get_user("nonexistentuser")
    assert user is None


def test_authenticate_user_success():
    """Test successful user authentication."""
    # Create a user first
    username = "authuser"
    password = "authpass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Now authenticate
    user = authenticate_user(username, password)

    assert user is not None
    assert user.username == username
    assert user.role == role


def test_authenticate_user_wrong_password():
    """Test user authentication with wrong password."""
    # Create a user first
    username = "wrongpassuser"
    password = "correctpass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Now authenticate with wrong password
    user = authenticate_user(username, "wrongpass")

    assert user is None


def test_authenticate_user_not_exists():
    """Test authenticating a user that doesn't exist."""
    user = authenticate_user("nonexistentuser", "anypassword")
    assert user is None


def test_create_access_token():
    """Test creating an access token."""
    data = {"sub": "testuser", "role": UserRole.USER}
    token = create_access_token(data)

    # Token should be a non-empty string
    assert isinstance(token, str)
    assert len(token) > 0


def test_create_refresh_token():
    """Test creating a refresh token."""
    data = {"sub": "testuser", "role": UserRole.USER}
    token = create_refresh_token(data)

    # Token should be a non-empty string
    assert isinstance(token, str)
    assert len(token) > 0

    # Decode the token and verify it contains refresh flag
    from jose import jwt

    from yaraflux_mcp_server.auth import ALGORITHM, SECRET_KEY

    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    assert payload.get("refresh") is True


def test_decode_token_valid():
    """Test decoding a valid token."""
    # Create a token
    data = {"sub": "testuser", "role": UserRole.USER}
    token = create_access_token(data)

    # Decode it
    token_data = decode_token(token)

    assert isinstance(token_data, TokenData)
    assert token_data.username == data["sub"]
    assert token_data.role == data["role"]


@pytest.mark.asyncio
@patch("yaraflux_mcp_server.auth.get_user")
async def test_get_current_active_user_success(mock_get_user):
    """Test getting current active user with valid token."""
    # Set up the mocks
    mock_get_user.return_value = User(username="testuser", role=UserRole.USER, disabled=False)

    # Create a token
    data = {"sub": "testuser", "role": UserRole.USER}
    token = create_access_token(data)

    # Get current user
    user = await get_current_user(token)

    assert user is not None
    assert user.username == "testuser"
    assert user.role == UserRole.USER
    assert not user.disabled

    # Test active user
    active_user = await get_current_active_user(user)
    assert active_user is not None


@pytest.mark.asyncio
@patch("yaraflux_mcp_server.auth.get_user")
async def test_get_current_active_user_disabled(mock_get_user):
    """Test getting disabled user."""
    # Set up the mock
    from yaraflux_mcp_server.models import UserInDB

    mock_user = UserInDB(username="disableduser", role=UserRole.USER, disabled=True, hashed_password="fakehash")
    mock_get_user.return_value = mock_user

    # Create a token
    data = {"sub": "disableduser", "role": UserRole.USER}
    token = create_access_token(data)

    # Get current user - this should raise an exception
    with pytest.raises(HTTPException) as exc_info:
        user = await get_current_user(token)

    # Check that the correct error was raised
    assert exc_info.value.status_code == 403
    assert "disabled" in str(exc_info.value.detail).lower()


@pytest.mark.asyncio
@patch("yaraflux_mcp_server.auth.get_user")
async def test_validate_admin_success(mock_get_user):
    """Test validating admin with valid token and admin role."""
    # Set up the mock
    mock_get_user.return_value = User(username="adminuser", role=UserRole.ADMIN, disabled=False)

    # Create a token
    data = {"sub": "adminuser", "role": UserRole.ADMIN}
    token = create_access_token(data)

    # Get current user
    user = await get_current_user(token)

    # Validate admin
    admin_user = await validate_admin(user)
    assert admin_user is not None
    assert admin_user.username == "adminuser"
    assert admin_user.role == UserRole.ADMIN


@pytest.mark.asyncio
@patch("yaraflux_mcp_server.auth.get_user")
async def test_validate_admin_not_admin(mock_get_user):
    """Test validating admin with non-admin role."""
    # Set up the mock
    mock_get_user.return_value = User(username="regularuser", role=UserRole.USER, disabled=False)

    # Create a token
    data = {"sub": "regularuser", "role": UserRole.USER}
    token = create_access_token(data)

    # Get current user
    user = await get_current_user(token)

    # Validate admin should raise exception
    with pytest.raises(HTTPException) as exc_info:
        await validate_admin(user)

    assert exc_info.value.status_code == 403
    assert "admin" in str(exc_info.value.detail).lower()


def test_refresh_access_token():
    """Test refreshing an access token."""
    # Create a refresh token
    data = {"sub": "testuser", "role": UserRole.USER}
    refresh_token = create_refresh_token(data)

    # Refresh it to get an access token
    access_token = refresh_access_token(refresh_token)

    # Decode the new token
    token_data = decode_token(access_token)

    assert isinstance(token_data, TokenData)
    assert token_data.username == data["sub"]
    assert token_data.role == data["role"]

    # Verify it's not a refresh token by checking the raw payload
    from jose import jwt

    from yaraflux_mcp_server.auth import ALGORITHM, SECRET_KEY

    payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
    assert payload.get("refresh") is None


def test_refresh_access_token_not_refresh_token():
    """Test refreshing with a non-refresh token."""
    # Create an access token
    data = {"sub": "testuser", "role": UserRole.USER}
    access_token = create_access_token(data)

    # Try to refresh it
    with pytest.raises(HTTPException) as exc_info:
        refresh_access_token(access_token)

    assert exc_info.value.status_code == 401
    assert "refresh token" in str(exc_info.value.detail).lower()


def test_refresh_access_token_expired():
    """Test refreshing with an expired refresh token."""
    # Create a token that's already expired
    data = {
        "sub": "testuser",
        "role": UserRole.USER,
        "refresh": True,
        "exp": int((datetime.now(UTC) - timedelta(minutes=5)).timestamp()),
    }
    # We need to manually create this token since the create_refresh_token function would create a valid one
    from jose import jwt

    from yaraflux_mcp_server.auth import ALGORITHM, SECRET_KEY

    expired_token = jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

    # Try to refresh it
    with pytest.raises(HTTPException) as exc_info:
        refresh_access_token(expired_token)

    assert exc_info.value.status_code == 401
    assert "expired" in str(exc_info.value.detail).lower()


def test_update_user():
    """Test updating a user."""
    # Create a user first
    username = "updateuser"
    password = "updatepass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Update the user
    updated = update_user(username=username, role=UserRole.ADMIN, email="test@example.com", disabled=True)

    assert updated is not None
    assert updated.username == username
    assert updated.role == UserRole.ADMIN
    assert updated.email == "test@example.com"
    assert updated.disabled is True


def test_update_user_not_found():
    """Test updating a user that doesn't exist."""
    updated = update_user(username="nonexistentuser", role=UserRole.ADMIN)

    assert updated is None


def test_list_users():
    """Test listing users."""
    # Create a couple of test users
    create_user(username="listuser1", password="pass1", role=UserRole.USER)
    create_user(username="listuser2", password="pass2", role=UserRole.ADMIN)

    # List users
    users = list_users()

    assert isinstance(users, list)
    assert len(users) >= 2  # At least our two test users

    # Check if our test users are in the list
    usernames = [u.username for u in users]
    assert "listuser1" in usernames
    assert "listuser2" in usernames


def test_delete_user():
    """Test deleting a user."""
    # Create a user first
    username = "deleteuser"
    password = "deletepass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Delete the user (as someone else)
    result = delete_user(username=username, current_username="someoneelse")

    assert result is True
    # User should no longer exist
    assert get_user(username) is None


def test_delete_user_not_found():
    """Test deleting a user that doesn't exist."""
    result = delete_user(username="nonexistentuser", current_username="someoneelse")
    assert result is False


def test_delete_user_self():
    """Test deleting own account."""
    # Create a user first
    username = "selfdeleteuser"
    password = "selfdeletepass"
    role = UserRole.USER

    create_user(username=username, password=password, role=role)

    # Try to delete self
    with pytest.raises(ValueError) as exc_info:
        delete_user(username=username, current_username=username)

    assert "cannot delete your own account" in str(exc_info.value).lower()
    # User should still exist
    assert get_user(username) is not None


def test_delete_last_admin():
    """Test deleting the last admin user."""
    # Create an admin user
    username = "lastadmin"
    password = "lastadminpass"
    role = UserRole.ADMIN

    create_user(username=username, password=password, role=role)

    # Make sure all other admin users are deleted
    users = list_users()
    for user in users:
        if user.role == UserRole.ADMIN and user.username != username:
            delete_user(user.username, current_username="someoneelse")

    # Try to delete the last admin
    with pytest.raises(ValueError) as exc_info:
        delete_user(username=username, current_username="someoneelse")

    assert "cannot delete the last admin" in str(exc_info.value).lower()
    # Admin should still exist
    assert get_user(username) is not None
