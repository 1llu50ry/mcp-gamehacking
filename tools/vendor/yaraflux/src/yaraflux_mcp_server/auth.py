"""Authentication and authorization module for YaraFlux MCP Server.

This module provides JWT-based authentication and authorization functionality,
including user management, token generation, validation, and dependencies for
securing FastAPI routes.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Dict, List, Optional, Union

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.models import TokenData, User, UserInDB, UserRole

# Configuration constants
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
SECRET_KEY = settings.JWT_SECRET_KEY
ALGORITHM = settings.JWT_ALGORITHM

# Configure logging
logger = logging.getLogger(__name__)

# Configure password hashing with fallback mechanisms
try:
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    logger.info("Successfully initialized bcrypt password hashing")
except Exception as exc:
    logger.error(f"Error initializing bcrypt: {str(exc)}")
    # Fallback to basic schemes if bcrypt fails
    try:
        pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
        logger.warning("Using fallback password hashing (sha256_crypt) due to bcrypt initialization failure")
    except Exception as inner_exc:
        logger.critical(f"Critical error initializing password hashing: {str(inner_exc)}")
        raise RuntimeError("Failed to initialize password hashing system") from inner_exc

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/auth/token")

# Mock user database - in a real application, replace with a database
_user_db: Dict[str, UserInDB] = {}


def init_user_db() -> None:
    """Initialize the user database with the admin user."""
    # Admin user is always created
    if settings.ADMIN_USERNAME not in _user_db:
        create_user(username=settings.ADMIN_USERNAME, password=settings.ADMIN_PASSWORD, role=UserRole.ADMIN)
        logger.info(f"Created admin user: {settings.ADMIN_USERNAME}")


def get_password_hash(password: str) -> str:
    """Generate a hashed password."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_user(username: str) -> Optional[UserInDB]:
    """Get a user from the database by username."""
    return _user_db.get(username)


def create_user(username: str, password: str, role: UserRole = UserRole.USER, email: Optional[str] = None) -> User:
    """Create a new user."""
    if username in _user_db:
        raise ValueError(f"User already exists: {username}")

    hashed_password = get_password_hash(password)
    user = UserInDB(username=username, hashed_password=hashed_password, role=role, email=email)
    _user_db[username] = user
    logger.info(f"Created user: {username} with role {role}")
    return User(**user.model_dump(exclude={"hashed_password"}))


def authenticate_user(username: str, password: str) -> Optional[UserInDB]:
    """Authenticate a user with username and password."""
    user = get_user(username)
    if not user:
        logger.warning(f"Authentication failed: User not found: {username}")
        return None
    if not verify_password(password, user.hashed_password):
        logger.warning(f"Authentication failed: Invalid password for user: {username}")
        return None
    if user.disabled:
        logger.warning(f"Authentication failed: User is disabled: {username}")
        return None

    user.last_login = datetime.now(UTC)
    return user


def create_token_data(username: str, role: UserRole, expire_time: datetime) -> Dict[str, Union[str, datetime]]:
    """Create base token data."""
    return {"sub": username, "role": role, "exp": expire_time, "iat": datetime.now(UTC)}


def create_access_token(
    data: Dict[str, Union[str, datetime, UserRole]], expires_delta: Optional[timedelta] = None
) -> str:
    """Create a JWT access token."""
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    username = str(data.get("sub"))
    role = data.get("role", UserRole.USER)

    token_data = create_token_data(username, role, expire)
    return jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(
    data: Dict[str, Union[str, datetime, UserRole]], expires_delta: Optional[timedelta] = None
) -> str:
    """Create a JWT refresh token."""
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES))
    username = str(data.get("sub"))
    role = data.get("role", UserRole.USER)

    token_data = create_token_data(username, role, expire)
    token_data["refresh"] = True

    return jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> TokenData:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        username = payload.get("sub")
        if not username:
            raise JWTError("Missing username claim")

        role = payload.get("role", UserRole.USER)
        exp = payload.get("exp")

        if exp and datetime.fromtimestamp(exp, UTC) < datetime.now(UTC):
            raise JWTError("Token has expired")

        return TokenData(username=username, role=role, exp=datetime.fromtimestamp(exp, UTC) if exp else None)

    except JWTError as exc:
        logger.warning(f"Token validation error: {str(exc)}")
        # Use the error message from the JWTError
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def refresh_access_token(refresh_token: str) -> str:
    """Create a new access token using a refresh token."""
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])

        if not payload.get("refresh"):
            logger.warning("Attempt to use non-refresh token for refresh")
            raise JWTError("Invalid refresh token")

        username = payload.get("sub")
        role = payload.get("role", UserRole.USER)

        if not username:
            logger.warning("Refresh token missing username claim")
            raise JWTError("Invalid token data")

        # Create new access token with same role
        access_token_data = {"sub": username, "role": role}
        return create_access_token(access_token_data)

    except JWTError as exc:
        logger.warning(f"Refresh token validation error: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """Get the current user from a JWT token."""
    token_data = decode_token(token)

    user = get_user(token_data.username)
    if not user:
        logger.warning(f"User from token not found: {token_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.disabled:
        logger.warning(f"User from token is disabled: {token_data.username}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    return User(**user.model_dump(exclude={"hashed_password"}))


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Get the current active user."""
    if current_user.disabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


async def validate_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """Validate that the current user is an admin."""
    if current_user.role != UserRole.ADMIN:
        logger.warning(f"Admin access denied for user: {current_user.username}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user


def delete_user(username: str, current_username: str) -> bool:
    """Delete a user from the database."""
    if username not in _user_db:
        return False

    if username == current_username:
        raise ValueError("Cannot delete your own account")

    user = _user_db[username]
    if user.role == UserRole.ADMIN:
        admin_count = sum(1 for u in _user_db.values() if u.role == UserRole.ADMIN)
        if admin_count <= 1:
            raise ValueError("Cannot delete the last admin user")

    del _user_db[username]
    logger.info(f"Deleted user: {username}")
    return True


def list_users() -> List[User]:
    """List all users in the database."""
    return [User(**user.model_dump(exclude={"hashed_password"})) for user in _user_db.values()]


def update_user(
    username: str,
    role: Optional[UserRole] = None,
    email: Optional[str] = None,
    disabled: Optional[bool] = None,
    password: Optional[str] = None,
) -> Optional[User]:
    """Update a user in the database."""
    user = _user_db.get(username)
    if not user:
        return None

    if role is not None and user.role == UserRole.ADMIN and role != UserRole.ADMIN:
        admin_count = sum(1 for u in _user_db.values() if u.role == UserRole.ADMIN)
        if admin_count <= 1:
            raise ValueError("Cannot change role of the last admin user")
        user.role = role
    elif role is not None:
        user.role = role

    if email is not None:
        user.email = email
    if disabled is not None:
        user.disabled = disabled
    if password is not None:
        user.hashed_password = get_password_hash(password)

    logger.info(f"Updated user: {username}")
    return User(**user.model_dump(exclude={"hashed_password"}))
