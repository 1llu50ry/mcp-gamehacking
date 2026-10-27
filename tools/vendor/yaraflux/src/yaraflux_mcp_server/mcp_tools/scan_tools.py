"""YARA scanning tools for Claude MCP integration.

This module provides tools for scanning files and URLs with YARA rules.
It uses direct function calls with proper error handling.
"""

import base64
import logging
from json import JSONDecodeError
from typing import Any, Dict, List, Optional

from yaraflux_mcp_server.mcp_tools.base import register_tool
from yaraflux_mcp_server.storage import get_storage_client
from yaraflux_mcp_server.yara_service import YaraError, yara_service

# Configure logging
logger = logging.getLogger(__name__)


@register_tool()
def scan_url(
    url: str, rule_names: Optional[List[str]] = None, sources: Optional[List[str]] = None, timeout: Optional[int] = None
) -> Dict[str, Any]:
    """Scan a file from a URL with YARA rules.

    This function downloads and scans a file from the provided URL using YARA rules.
    It's particularly useful for scanning potentially malicious files without storing
    them locally on the user's machine.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Can you scan this URL for malware: https://example.com/suspicious-file.exe"
    "Analyze https://example.com/document.pdf for malicious patterns"
    "Check if the file at this URL contains known threats: https://example.com/sample.exe"

    Args:
        url: URL of the file to scan
        rule_names: Optional list of rule names to match (if None, match all)
        sources: Optional list of sources to match rules from (if None, match all)
        timeout: Optional timeout in seconds (if None, use default)

    Returns:
        Scan result containing file details, scan status, and any matches found
    """
    try:
        # Fetch and scan the file
        result = yara_service.fetch_and_scan(url=url, rule_names=rule_names, sources=sources, timeout=timeout)

        return {
            "success": True,
            "scan_id": str(result.scan_id),
            "file_name": result.file_name,
            "file_size": result.file_size,
            "file_hash": result.file_hash,
            "scan_time": result.scan_time,
            "timeout_reached": result.timeout_reached,
            "matches": [match.model_dump() for match in result.matches],
            "match_count": len(result.matches),
        }
    except YaraError as e:
        logger.error(f"Error scanning URL {url}: {str(e)}")
        return {"success": False, "message": str(e), "error_type": "YaraError"}
    except Exception as e:
        logger.error(f"Unexpected error scanning URL {url}: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def scan_data(
    data: str,
    filename: str,
    *,
    encoding: str = "base64",
    rule_names: Optional[List[str]] = None,
    sources: Optional[List[str]] = None,
    timeout: Optional[int] = None,
) -> Dict[str, Any]:
    """Scan in-memory data with YARA rules.

    This function scans provided binary or text data using YARA rules.
    It supports both base64-encoded data and plain text, making it versatile
    for various sources of potentially malicious content.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Scan this base64 data: SGVsbG8gV29ybGQ="
    "Can you check if this text contains malicious patterns: eval(atob('ZXZhbChwcm9tcHQoKSk7'))"
    "Analyze this string for malware signatures: document.write(unescape('%3C%73%63%72%69%70%74%3E'))"

    Args:
        data: Data to scan (base64-encoded by default)
        filename: Name of the file for reference
        encoding: Encoding of the data ("base64" or "text")
        rule_names: Optional list of rule names to match (if None, match all)
        sources: Optional list of sources to match rules from (if None, match all)
        timeout: Optional timeout in seconds (if None, use default)

    Returns:
        Scan result containing match details and file metadata
    """
    try:
        # Validate parameters
        if not filename:
            raise ValueError("Filename cannot be empty")

        if not data:
            raise ValueError("Empty data")

        # Validate encoding
        if encoding not in ["base64", "text"]:
            raise ValueError(f"Unsupported encoding: {encoding}")

        # Decode the data
        if encoding == "base64":
            # Validate base64 format before attempting to decode
            # Check if the data contains valid base64 characters (allowing for padding)
            import re  # pylint: disable=import-outside-toplevel

            if not re.match(r"^[A-Za-z0-9+/]*={0,2}$", data):
                raise ValueError("Invalid base64 format")

            try:
                decoded_data = base64.b64decode(data)
            except Exception as e:
                raise ValueError(f"Invalid base64 data: {str(e)}") from e
        else:  # encoding == "text"
            decoded_data = data.encode("utf-8")

        # Scan the data
        result = yara_service.match_data(
            data=decoded_data, file_name=filename, rule_names=rule_names, sources=sources, timeout=timeout
        )

        return {
            "success": True,
            "scan_id": str(result.scan_id),
            "file_name": result.file_name,
            "file_size": result.file_size,
            "file_hash": result.file_hash,
            "scan_time": result.scan_time,
            "timeout_reached": result.timeout_reached,
            "matches": [match.model_dump() for match in result.matches],
            "match_count": len(result.matches),
        }
    except YaraError as e:
        logger.error(f"Error scanning data: {str(e)}")
        return {"success": False, "message": str(e), "error_type": "YaraError"}
    except ValueError as e:
        logger.error(f"Value error in scan_data: {str(e)}")
        return {"success": False, "message": str(e), "error_type": "ValueError"}
    except Exception as e:
        logger.error(f"Unexpected error scanning data: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def get_scan_result(scan_id: str) -> Dict[str, Any]:
    """Get a scan result by ID.

    This function retrieves previously saved scan results using their unique ID.
    It allows users to access historical scan data and analyze matches without
    rescanning the content.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me the results from scan abc123"
    "Retrieve the details for scan ID xyz789"
    "What were the findings from my previous scan?"

    Args:
        scan_id: ID of the scan result

    Returns:
        Complete scan result including file metadata and any matches found
    """
    try:
        # Validate scan_id
        if not scan_id:
            raise ValueError("Scan ID cannot be empty")

        # Get the result from storage
        storage = get_storage_client()
        result_data = storage.get_result(scan_id)

        # Validate result_data is valid JSON
        if isinstance(result_data, str):
            try:
                # Try to parse as JSON if it's a string
                import json  # pylint: disable=import-outside-toplevel

                result_data = json.loads(result_data)
            except ImportError as e:
                raise ImportError(f"Error loading JSON module: {str(e)}") from e
            except JSONDecodeError as e:
                raise ValueError(f"Invalid JSON data: {str(e)}") from e
            except ValueError as e:
                raise ValueError(f"Invalid JSON data: {str(e)}") from e
        return {"success": True, "result": result_data}
    except ValueError as e:
        logger.error(f"Value error in get_scan_result: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:  # pylint: disable=broad-except
        logger.error(f"Error getting scan result {scan_id}: {str(e)}")
        return {"success": False, "message": str(e)}
