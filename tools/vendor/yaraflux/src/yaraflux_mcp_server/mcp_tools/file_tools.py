"""File management tools for Claude MCP integration.

This module provides tools for file operations including uploading, downloading,
viewing hex dumps, and extracting strings from files. It uses direct function implementations
with inline error handling.
"""

import base64
import logging
from typing import Any, Dict, Optional

from yaraflux_mcp_server.mcp_tools.base import register_tool
from yaraflux_mcp_server.storage import StorageError, get_storage_client

# Configure logging
logger = logging.getLogger(__name__)


@register_tool()
def upload_file(
    data: str, file_name: str, encoding: str = "base64", metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Upload a file to the storage system.

    This tool allows you to upload files with metadata for later retrieval and analysis.
    Files can be uploaded as base64-encoded data or plain text.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Upload this file with base64 data: SGVsbG8gV29ybGQ="
    "Save this text as a file named example.txt: This is the content"
    "Store this code snippet as script.py with metadata indicating it's executable"

    Args:
        data: File content encoded as specified by the encoding parameter
        file_name: Name of the file
        encoding: Encoding of the data ("base64" or "text")
        metadata: Optional metadata to associate with the file

    Returns:
        File information including ID, size, and metadata
    """
    try:
        # Validate parameters
        if not data:
            raise ValueError("File data cannot be empty")

        if not file_name:
            raise ValueError("File name cannot be empty")

        if encoding not in ["base64", "text"]:
            raise ValueError(f"Unsupported encoding: {encoding}")

        # Decode the data
        if encoding == "base64":
            try:
                decoded_data = base64.b64decode(data)
            except Exception as e:
                raise ValueError(f"Invalid base64 data: {str(e)}") from e
        else:  # encoding == "text"
            decoded_data = data.encode("utf-8")

        # Save the file
        storage = get_storage_client()
        file_info = storage.save_file(file_name, decoded_data, metadata or {})

        return {"success": True, "message": f"File {file_name} uploaded successfully", "file_info": file_info}
    except ValueError as e:
        logger.error(f"Value error in upload_file: {str(e)}")
        return {"success": False, "message": str(e)}
    except StorageError as e:
        logger.error(f"Storage error in upload_file: {str(e)}")
        return {"success": False, "message": f"Storage error: {str(e)}"}
    except Exception as e:
        logger.error(f"Unexpected error in upload_file: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def get_file_info(file_id: str) -> Dict[str, Any]:
    """Get detailed information about a file.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Get details about file abc123"
    "Show me the metadata for file xyz789"
    "What's the size and upload date of file 456def?"

    Args:
        file_id: ID of the file

    Returns:
        File information including metadata
    """
    try:
        if not file_id:
            raise ValueError("File ID cannot be empty")

        storage = get_storage_client()
        file_info = storage.get_file_info(file_id)

        return {"success": True, "file_info": file_info}
    except StorageError as e:
        logger.error(f"Error getting file info: {str(e)}")
        return {"success": False, "message": f"Error getting file info: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in get_file_info: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in get_file_info: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def list_files(
    page: int = 1, page_size: int = 100, sort_by: str = "uploaded_at", sort_desc: bool = True
) -> Dict[str, Any]:
    """List files with pagination and sorting.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me all the uploaded files"
    "List the most recently uploaded files first"
    "Show files sorted by name in alphabetical order"
    "List the largest files first"

    Args:
        page: Page number (1-based)
        page_size: Number of items per page
        sort_by: Field to sort by (uploaded_at, file_name, file_size)
        sort_desc: Sort in descending order if True

    Returns:
        List of files with pagination info
    """
    try:
        # Validate parameters
        if page < 1:
            raise ValueError("Page number must be positive")

        if page_size < 1:
            raise ValueError("Page size must be positive")

        valid_sort_fields = ["uploaded_at", "file_name", "file_size"]
        if sort_by not in valid_sort_fields:
            raise ValueError(f"Invalid sort field: {sort_by}. Must be one of {valid_sort_fields}")

        storage = get_storage_client()
        result = storage.list_files(page, page_size, sort_by, sort_desc)

        return {
            "success": True,
            "files": result.get("files", []),
            "total": result.get("total", 0),
            "page": result.get("page", page),
            "page_size": result.get("page_size", page_size),
        }
    except StorageError as e:
        logger.error(f"Error listing files: {str(e)}")
        return {"success": False, "message": f"Error listing files: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in list_files: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in list_files: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def delete_file(file_id: str) -> Dict[str, Any]:
    """Delete a file from storage.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Delete file abc123"
    "Remove the file with ID xyz789"
    "Please get rid of file 456def"

    Args:
        file_id: ID of the file to delete

    Returns:
        Deletion result
    """
    try:
        if not file_id:
            raise ValueError("File ID cannot be empty")

        storage = get_storage_client()

        # Get file info first to include in response
        try:
            file_info = storage.get_file_info(file_id)
            file_name = file_info.get("file_name", "Unknown file")
        except StorageError as e:
            # Return error if get_file_info fails
            logger.error(f"Error getting file info: {str(e)}")
            return {"success": False, "message": f"Error deleting file: {str(e)}"}
        except Exception:
            file_name = "Unknown file"

        # Delete the file
        result = storage.delete_file(file_id)

        if result:
            return {"success": True, "message": f"File {file_name} deleted successfully", "file_id": file_id}
        return {"success": False, "message": f"File {file_id} not found or could not be deleted"}
    except StorageError as e:
        logger.error(f"Error deleting file: {str(e)}")
        return {"success": False, "message": f"Error deleting file: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in delete_file: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in delete_file: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def extract_strings(
    file_id: str,
    min_length: int = 4,
    include_unicode: bool = True,
    include_ascii: bool = True,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    """Extract strings from a file.

    This tool extracts ASCII and/or Unicode strings from a file with a specified minimum length.
    It's useful for analyzing binary files or looking for embedded text in files.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Extract strings from file abc123"
    "Find all text strings in the file with ID xyz789"
    "Show me any readable text in file 456def with at least 8 characters"

    Args:
        file_id: ID of the file
        min_length: Minimum string length
        include_unicode: Include Unicode strings
        include_ascii: Include ASCII strings
        limit: Maximum number of strings to return

    Returns:
        Extracted strings and metadata
    """
    try:
        # Validate parameters
        if not file_id:
            raise ValueError("File ID cannot be empty")

        if min_length < 1:
            raise ValueError("Minimum string length must be positive")

        if not include_unicode and not include_ascii:
            raise ValueError("At least one string type (Unicode or ASCII) must be included")

        storage = get_storage_client()
        result = storage.extract_strings(
            file_id, min_length=min_length, include_unicode=include_unicode, include_ascii=include_ascii, limit=limit
        )

        return {
            "success": True,
            "file_id": result.get("file_id"),
            "file_name": result.get("file_name"),
            "strings": result.get("strings", []),
            "total_strings": result.get("total_strings", 0),
            "min_length": result.get("min_length", min_length),
            "include_unicode": result.get("include_unicode", include_unicode),
            "include_ascii": result.get("include_ascii", include_ascii),
        }
    except StorageError as e:
        logger.error(f"Error extracting strings: {str(e)}")
        return {"success": False, "message": f"Error extracting strings: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in extract_strings: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in extract_strings: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def get_hex_view(
    file_id: str, offset: int = 0, length: Optional[int] = None, bytes_per_line: int = 16
) -> Dict[str, Any]:
    """Get hexadecimal view of file content.

    This tool provides a hexadecimal representation of file content with optional ASCII view.
    It's useful for examining binary files or seeing the raw content of text files.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me a hex dump of file abc123"
    "Display the hex representation of file xyz789"
    "I need to see the raw bytes of file 456def"

    Args:
        file_id: ID of the file
        offset: Starting offset in bytes
        length: Number of bytes to return (if None, a reasonable default is used)
        bytes_per_line: Number of bytes per line in output

    Returns:
        Hexadecimal representation of file content
    """
    try:
        # Validate parameters
        if not file_id:
            raise ValueError("File ID cannot be empty")

        if offset < 0:
            raise ValueError("Offset must be non-negative")

        if length is not None and length < 1:
            raise ValueError("Length must be positive")

        if bytes_per_line < 1:
            raise ValueError("Bytes per line must be positive")

        storage = get_storage_client()
        result = storage.get_hex_view(file_id, offset=offset, length=length, bytes_per_line=bytes_per_line)

        return {
            "success": True,
            "file_id": result.get("file_id"),
            "file_name": result.get("file_name"),
            "hex_content": result.get("hex_content"),
            "offset": result.get("offset", offset),
            "length": result.get("length", 0),
            "total_size": result.get("total_size", 0),
            "bytes_per_line": result.get("bytes_per_line", bytes_per_line),
        }
    except StorageError as e:
        logger.error(f"Error getting hex view: {str(e)}")
        return {"success": False, "message": f"Error getting hex view: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in get_hex_view: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in get_hex_view: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def download_file(file_id: str, encoding: str = "base64") -> Dict[str, Any]:
    """Download a file's content.

    This tool retrieves the content of a file, returning it in the specified encoding.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Download file abc123 and show me its contents"
    "Get the content of file xyz789 as text if possible"
    "Retrieve file 456def for me"

    Args:
        file_id: ID of the file to download
        encoding: Encoding for the returned data ("base64" or "text")

    Returns:
        File content and metadata
    """
    try:
        # Validate parameters
        if not file_id:
            raise ValueError("File ID cannot be empty")

        if encoding not in ["base64", "text"]:
            raise ValueError(f"Unsupported encoding: {encoding}")

        storage = get_storage_client()
        file_data = storage.get_file(file_id)
        file_info = storage.get_file_info(file_id)

        # Encode the data as requested
        if encoding == "base64":
            encoded_data = base64.b64encode(file_data).decode("ascii")
        elif encoding == "text":
            try:
                encoded_data = file_data.decode("utf-8")
            except UnicodeDecodeError:
                # If the file isn't valid utf-8 text, fall back to base64
                encoded_data = base64.b64encode(file_data).decode("ascii")
                encoding = "base64"  # Update encoding to reflect what was actually used
        else:
            # This shouldn't happen due to validation, but just in case
            encoded_data = base64.b64encode(file_data).decode("ascii")
            encoding = "base64"

        return {
            "success": True,
            "file_id": file_id,
            "file_name": file_info.get("file_name"),
            "file_size": file_info.get("file_size"),
            "mime_type": file_info.get("mime_type"),
            "data": encoded_data,
            "encoding": encoding,
        }
    except StorageError as e:
        logger.error(f"Error downloading file: {str(e)}")
        return {"success": False, "message": f"Error downloading file: {str(e)}"}
    except ValueError as e:
        logger.error(f"Value error in download_file: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in download_file: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}
