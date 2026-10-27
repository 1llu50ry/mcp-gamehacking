"""Base classes for storage abstraction in YaraFlux MCP Server.

This module defines the StorageError exception and the StorageClient abstract base class
that all storage implementations must inherit from.
"""

import logging
from abc import ABC, abstractmethod
from typing import Any, BinaryIO, Dict, List, Optional, Tuple, Union

# Configure logging
logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Custom exception for storage-related errors."""


class StorageClient(ABC):
    """Abstract base class for storage clients."""

    # YARA Rule Management Methods

    @abstractmethod
    def save_rule(self, rule_name: str, content: str, source: str = "custom") -> str:
        """Save a YARA rule to storage.

        Args:
            rule_name: Name of the rule
            content: YARA rule content
            source: Source of the rule (e.g., "custom" or "community")

        Returns:
            Path or key where the rule was saved
        """

    @abstractmethod
    def get_rule(self, rule_name: str, source: str = "custom") -> str:
        """Get a YARA rule from storage.

        Args:
            rule_name: Name of the rule
            source: Source of the rule

        Returns:
            Content of the rule

        Raises:
            StorageError: If rule not found
        """

    @abstractmethod
    def delete_rule(self, rule_name: str, source: str = "custom") -> bool:
        """Delete a YARA rule from storage.

        Args:
            rule_name: Name of the rule
            source: Source of the rule

        Returns:
            True if successful, False otherwise
        """

    @abstractmethod
    def list_rules(self, source: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all YARA rules in storage.

        Args:
            source: Optional filter by source

        Returns:
            List of rule metadata
        """

    # Sample Management Methods

    @abstractmethod
    def save_sample(self, filename: str, content: Union[bytes, BinaryIO]) -> Tuple[str, str]:
        """Save a sample file to storage.

        Args:
            filename: Name of the file
            content: File content as bytes or file-like object

        Returns:
            Tuple of (path/key where sample was saved, sha256 hash)
        """

    @abstractmethod
    def get_sample(self, sample_id: str) -> bytes:
        """Get a sample from storage.

        Args:
            sample_id: ID of the sample (hash or filename)

        Returns:
            Sample content

        Raises:
            StorageError: If sample not found
        """

    # Result Management Methods

    @abstractmethod
    def save_result(self, result_id: str, content: Dict[str, Any]) -> str:
        """Save a scan result to storage.

        Args:
            result_id: ID for the result
            content: Result data

        Returns:
            Path or key where the result was saved
        """

    @abstractmethod
    def get_result(self, result_id: str) -> Dict[str, Any]:
        """Get a scan result from storage.

        Args:
            result_id: ID of the result

        Returns:
            Result data

        Raises:
            StorageError: If result not found
        """

    # File Management Methods

    @abstractmethod
    def save_file(
        self, filename: str, content: Union[bytes, BinaryIO], metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Save a file to storage with optional metadata.

        Args:
            filename: Name of the file
            content: File content as bytes or file-like object
            metadata: Optional metadata to store with the file

        Returns:
            FileInfo dictionary containing file details
        """

    @abstractmethod
    def get_file(self, file_id: str) -> bytes:
        """Get a file from storage.

        Args:
            file_id: ID of the file

        Returns:
            File content

        Raises:
            StorageError: If file not found
        """

    @abstractmethod
    def list_files(
        self, page: int = 1, page_size: int = 100, sort_by: str = "uploaded_at", sort_desc: bool = True
    ) -> Dict[str, Any]:
        """List files in storage with pagination.

        Args:
            page: Page number (1-based)
            page_size: Number of items per page
            sort_by: Field to sort by
            sort_desc: Sort in descending order if True

        Returns:
            Dictionary with files list and pagination info
        """

    @abstractmethod
    def get_file_info(self, file_id: str) -> Dict[str, Any]:
        """Get file metadata.

        Args:
            file_id: ID of the file

        Returns:
            File information

        Raises:
            StorageError: If file not found
        """

    @abstractmethod
    def delete_file(self, file_id: str) -> bool:
        """Delete a file from storage.

        Args:
            file_id: ID of the file

        Returns:
            True if successful, False otherwise
        """

    @abstractmethod
    def extract_strings(
        self,
        file_id: str,
        *,
        min_length: int = 4,
        include_unicode: bool = True,
        include_ascii: bool = True,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Extract strings from a file.

        Args:
            file_id: ID of the file
            min_length: Minimum string length
            include_unicode: Include Unicode strings
            include_ascii: Include ASCII strings
            limit: Maximum number of strings to return

        Returns:
            Dictionary with extracted strings and metadata

        Raises:
            StorageError: If file not found
        """

    @abstractmethod
    def get_hex_view(
        self, file_id: str, *, offset: int = 0, length: Optional[int] = None, bytes_per_line: int = 16
    ) -> Dict[str, Any]:
        """Get hexadecimal view of file content.

        Args:
            file_id: ID of the file
            offset: Starting offset in bytes
            length: Number of bytes to return (if None, return all from offset)
            bytes_per_line: Number of bytes per line in output

        Returns:
            Dictionary with hex content and metadata

        Raises:
            StorageError: If file not found
        """
