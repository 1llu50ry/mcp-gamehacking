"""Tests for token management and authentication in auth.py."""

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt

from yaraflux_mcp_server.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    SECRET_KEY,
    UserRole,
    authenticate_user,
    create_access_token,
    create_refresh_token,
    create_user,
    decode_token,
    get_current_user,
    refresh_access_token,
)
from yaraflux_mcp_server.models import TokenData, User


@pytest.fixture
def test_token_data():
    """Test token data fixture."""
    return {"sub": "testuser", "role": UserRole.USER}


def test_create_access_token(test_token_data):
    """Test access token creation."""
    token = create_access_token(test_token_data)

    decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

    assert decoded["sub"] == test_token_data["sub"]
    assert decoded["role"] == test_token_data["role"]
    assert "exp" in decoded
    expiration = datetime.fromtimestamp(decoded["exp"], UTC)
    now = datetime.now(UTC)
    assert (expiration - now).total_seconds() <= ACCESS_TOKEN_EXPIRE_MINUTES * 60


def test_create_refresh_token(test_token_data):
    """Test refresh token creation."""
    token = create_refresh_token(test_token_data)

    decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

    assert decoded["sub"] == test_token_data["sub"]
    assert decoded["role"] == test_token_data["role"]
    assert decoded.get("refresh") is True
    assert "exp" in decoded
    expiration = datetime.fromtimestamp(decoded["exp"], UTC)
    now = datetime.now(UTC)
    assert (expiration - now).total_seconds() <= REFRESH_TOKEN_EXPIRE_MINUTES * 60


def test_decode_token_valid(test_token_data):
    """Test decoding a valid token."""
    token_data = {**test_token_data, "exp": int((datetime.now(UTC) + timedelta(minutes=15)).timestamp())}
    token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)

    decoded = decode_token(token)
    assert isinstance(decoded, TokenData)
    assert decoded.username == test_token_data["sub"]
    assert decoded.role == test_token_data["role"]


def test_decode_token_expired(test_token_data):
    """Test decoding an expired token."""
    token_data = {**test_token_data, "exp": int((datetime.now(UTC) - timedelta(minutes=15)).timestamp())}
    token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)

    with pytest.raises(HTTPException) as exc_info:
        decode_token(token)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    # Accept either of these error messages
    assert "Token has expired" in str(exc_info.value.detail) or "Signature has expired" in str(exc_info.value.detail)


def test_decode_token_invalid():
    """Test decoding an invalid token."""
    token = "invalid_token"

    with pytest.raises(HTTPException) as exc_info:
        decode_token(token)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    # Accept different possible error messages
    assert "segments" in str(exc_info.value.detail) or "credentials" in str(exc_info.value.detail).lower()


@pytest.mark.asyncio
async def test_get_current_user_success():
    """Test getting current user from valid token."""
    # Create an actual user in the database for this test
    username = "test_current_user"
    password = "test_password"
    role = UserRole.USER

    # Create the user
    create_user(username=username, password=password, role=role)

    # Create token for this user
    token_data = {"sub": username, "role": role}
    token = create_access_token(token_data)

    # Get the user with the token
    user = await get_current_user(token)

    assert isinstance(user, User)
    assert user.username == username
    assert user.role == role


@pytest.mark.asyncio
async def test_get_current_user_invalid_token():
    """Test getting current user with invalid token."""
    token = "invalid_token"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(token)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED


def test_refresh_access_token_success():
    """Test successful access token refresh."""
    # Create an actual user for this test
    username = "refresh_test_user"
    password = "test_password"
    role = UserRole.USER

    # Create the user
    create_user(username=username, password=password, role=role)

    # Create token for this user
    token_data = {"sub": username, "role": role}
    refresh_token = create_refresh_token(token_data)

    # Refresh the token
    new_token = refresh_access_token(refresh_token)

    # Verify the new token
    decoded = jwt.decode(new_token, SECRET_KEY, algorithms=[ALGORITHM])
    assert decoded["sub"] == username
    assert decoded["role"] == role
    assert "refresh" not in decoded


def test_refresh_access_token_not_refresh_token(test_token_data):
    """Test refresh with non-refresh token."""
    access_token = create_access_token(test_token_data)

    with pytest.raises(HTTPException) as exc_info:
        refresh_access_token(access_token)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "refresh token" in str(exc_info.value.detail).lower()


def test_refresh_access_token_expired(test_token_data):
    """Test refresh with expired refresh token."""
    token_data = {
        **test_token_data,
        "exp": int((datetime.now(UTC) - timedelta(minutes=15)).timestamp()),
        "refresh": True,
    }
    expired_token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)

    with pytest.raises(HTTPException) as exc_info:
        refresh_access_token(expired_token)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    # Accept different possible error messages
    assert "expired" in str(exc_info.value.detail).lower()
