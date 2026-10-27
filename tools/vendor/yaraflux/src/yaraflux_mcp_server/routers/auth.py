"""Authentication router for YaraFlux MCP Server.

This module provides API routes for authentication, including login, token generation,
and user management.
"""

import logging
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from yaraflux_mcp_server.auth import (
    authenticate_user,
    create_access_token,
    create_user,
    delete_user,
    get_current_active_user,
    list_users,
    update_user,
    validate_admin,
)
from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.models import Token, User, UserRole

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/auth",
    tags=["authentication"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
    },
)


@router.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """Login and create an access token.

    Args:
        form_data: OAuth2 form with username and password

    Returns:
        JWT access token

    Raises:
        HTTPException: If authentication fails
    """
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value}, expires_delta=access_token_expires
    )

    logger.info(f"User {form_data.username} logged in")

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    """Get current user information.

    Args:
        current_user: Current authenticated user

    Returns:
        User object
    """
    return current_user


@router.get("/users", response_model=List[User])
async def read_users():
    """Get all users (admin only).

    Args:
        current_user: Current authenticated admin user

    Returns:
        List of users
    """
    return list_users()


@router.post("/users", response_model=User)
async def create_new_user(
    username: str,
    password: str,
    role: UserRole = UserRole.USER,
    email: Optional[str] = None,
    current_user: User = Depends(validate_admin),
):
    """Create a new user (admin only).

    Args:
        username: Username for the new user
        password: Password for the new user
        role: Role for the new user
        email: Optional email for the new user
        current_user: Current authenticated admin user

    Returns:
        Created user

    Raises:
        HTTPException: If user creation fails
    """
    try:
        user = create_user(username, password, role, email)
        logger.info(f"User {username} created by {current_user.username}")
        return user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.delete("/users/{username}")
async def remove_user(username: str, current_user: User = Depends(validate_admin)):
    """Delete a user (admin only).

    Args:
        username: Username to delete
        current_user: Current authenticated admin user

    Returns:
        Success message

    Raises:
        HTTPException: If user deletion fails
    """
    try:
        result = delete_user(username, current_user.username)
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {username} not found")

        logger.info(f"User {username} deleted by {current_user.username}")

        return {"message": f"User {username} deleted"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.put("/users/{username}")
async def update_user_info(
    username: str,
    *,
    role: Optional[UserRole] = None,
    email: Optional[str] = None,
    disabled: Optional[bool] = None,
    password: Optional[str] = None,
    current_user: User = Depends(validate_admin),
):
    """Update a user (admin only).

    Args:
        username: Username to update
        role: New role
        email: New email
        disabled: New disabled status
        password: New password
        current_user: Current authenticated admin user

    Returns:
        Success message

    Raises:
        HTTPException: If user update fails
    """
    try:
        user = update_user(username, role, email, disabled, password)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {username} not found")

        logger.info(f"User {username} updated by {current_user.username}")

        return {"message": f"User {username} updated"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
