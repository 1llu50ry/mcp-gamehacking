"""Pydantic models for YaraFlux MCP Server.

This module defines data models for requests, responses, and internal representations
used by the YaraFlux MCP Server.
"""

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl, field_validator


class UserRole(str, Enum):
    """User roles for access control."""

    ADMIN = "admin"
    USER = "user"


class TokenData(BaseModel):
    """Data stored in JWT token."""

    username: str
    role: UserRole
    exp: Optional[datetime] = None
    refresh: Optional[bool] = None


class Token(BaseModel):
    """Authentication token response."""

    access_token: str
    token_type: str = "bearer"


class User(BaseModel):
    """User model for authentication and authorization."""

    username: str
    email: Optional[str] = None
    disabled: bool = False
    role: UserRole = UserRole.USER


class UserInDB(User):
    """User model as stored in database with hashed password."""

    hashed_password: str
    created: datetime = Field(datetime.now())
    last_login: Optional[datetime] = None


class YaraMatch(BaseModel):
    """Model for YARA rule match details."""

    rule: str
    namespace: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)
    strings: List[Dict[str, Any]] = Field(default_factory=list)


class YaraScanResult(BaseModel):
    """Model for YARA scanning results."""

    scan_id: UUID = Field(default_factory=uuid4)
    file_name: str
    file_size: int
    file_hash: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    matches: List[YaraMatch] = Field(default_factory=list)
    scan_time: float  # Scan duration in seconds
    timeout_reached: bool = False
    error: Optional[str] = None


class YaraRuleMetadata(BaseModel):
    """Metadata for a YARA rule."""

    name: str
    source: str  # 'community' or 'custom'
    author: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None
    created: datetime = Field(default_factory=lambda: datetime.now(UTC))
    modified: Optional[datetime] = None
    tags: List[str] = Field(default_factory=list)
    is_compiled: bool = False


class YaraRuleContent(BaseModel):
    """Model for YARA rule content."""

    source: str  # The actual rule text


class YaraRule(YaraRuleMetadata):
    """Complete YARA rule with content."""

    content: YaraRuleContent


class YaraRuleCreate(BaseModel):
    """Model for creating a new YARA rule."""

    name: str
    content: str
    author: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    content_type: Optional[str] = "yara"  # Can be 'yara' or 'json'

    @field_validator("name")
    def name_must_be_valid(cls, v: str) -> str:  # pylint: disable=no-self-argument
        """Validate rule name."""
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        if "/" in v or "\\" in v:
            raise ValueError("name cannot contain path separators")
        return v


class ScanRequest(BaseModel):
    """Model for file scan request."""

    url: Optional[HttpUrl] = None
    rule_names: Optional[List[str]] = None  # If None, use all available rules
    timeout: Optional[int] = None  # Scan timeout in seconds

    @field_validator("rule_names")
    def validate_rule_names(cls, v: Optional[List[str]]) -> Optional[List[str]]:  # pylint: disable=no-self-argument
        """Validate rule names."""
        if v is not None and len(v) == 0:
            return None  # Empty list is treated as None (use all rules)
        return v


class ScanResult(BaseModel):
    """Model for scan result response."""

    result: YaraScanResult


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: str
    detail: Optional[str] = None


# File Management Models


class FileInfo(BaseModel):
    """File information model."""

    file_id: UUID = Field(default_factory=uuid4)
    file_name: str
    file_size: int
    file_hash: str
    mime_type: str = "application/octet-stream"
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    uploader: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FileUploadRequest(BaseModel):
    """Model for file upload requests."""

    file_name: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FileUploadResponse(BaseModel):
    """Model for file upload responses."""

    file_info: FileInfo


class FileListResponse(BaseModel):
    """Model for file list responses."""

    files: List[FileInfo]
    total: int
    page: int = 1
    page_size: int = 100


class FileStringsRequest(BaseModel):
    """Model for file strings extraction requests."""

    min_length: int = 4
    include_unicode: bool = True
    include_ascii: bool = True
    limit: Optional[int] = None


class FileString(BaseModel):
    """Model for an extracted string."""

    string: str
    offset: int
    string_type: str  # "ascii" or "unicode"


class FileStringsResponse(BaseModel):
    """Model for file strings extraction responses."""

    file_id: UUID
    file_name: str
    strings: List[FileString]
    total_strings: int
    min_length: int
    include_unicode: bool
    include_ascii: bool


class FileHexRequest(BaseModel):
    """Model for file hex view requests."""

    offset: int = 0
    length: Optional[int] = None
    bytes_per_line: int = 16
    include_ascii: bool = True


class FileHexResponse(BaseModel):
    """Model for file hex view responses."""

    file_id: UUID
    file_name: str
    hex_content: str
    offset: int
    length: int
    total_size: int
    bytes_per_line: int
    include_ascii: bool


class FileDeleteResponse(BaseModel):
    """Model for file deletion responses."""

    file_id: UUID
    success: bool
    message: str
