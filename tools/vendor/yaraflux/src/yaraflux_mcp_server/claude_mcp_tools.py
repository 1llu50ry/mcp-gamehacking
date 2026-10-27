"""Legacy MCP tools module for YaraFlux integration with Claude Desktop.

This module is maintained for backward compatibility and now imports
from the new modular mcp_tools package.
"""

import logging

# Configure logging
logger = logging.getLogger(__name__)

from .mcp_tools.file_tools import (
    delete_file,
    download_file,
    extract_strings,
    get_file_info,
    get_hex_view,
    list_files,
    upload_file,
)
from .mcp_tools.rule_tools import (
    add_yara_rule,
    delete_yara_rule,
    get_yara_rule,
    import_threatflux_rules,
    list_yara_rules,
    update_yara_rule,
    validate_yara_rule,
)

# Import from new modular package
from .mcp_tools.scan_tools import get_scan_result, scan_data, scan_url
from .mcp_tools.storage_tools import clean_storage, get_storage_info

# Warning for deprecation
logger.warning(
    "The yaraflux_mcp_server.mcp_tools module is deprecated. "
    "Please import from yaraflux_mcp_server.mcp_tools package instead."
)

# Export all tools
__all__ = [
    # Scan tools
    "scan_url",
    "scan_data",
    "get_scan_result",
    # Rule tools
    "list_yara_rules",
    "get_yara_rule",
    "validate_yara_rule",
    "add_yara_rule",
    "update_yara_rule",
    "delete_yara_rule",
    "import_threatflux_rules",
    # File tools
    "upload_file",
    "get_file_info",
    "list_files",
    "delete_file",
    "extract_strings",
    "get_hex_view",
    "download_file",
    # Storage tools
    "get_storage_info",
    "clean_storage",
]
