"""Unit tests for the legacy claude_mcp_tools module."""

import importlib
import logging
from unittest.mock import patch

import pytest

from yaraflux_mcp_server import claude_mcp_tools


class TestClaudeMcpTools:
    """Tests for claude_mcp_tools module."""

    def test_module_exports_all_tools(self):
        """Test that the module exports all expected tools."""
        # List of all expected tools
        expected_tools = [
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

        # Verify each tool is exported and available in the module
        for tool_name in expected_tools:
            assert hasattr(claude_mcp_tools, tool_name), f"Tool {tool_name} should be exported"

        # Verify the __all__ list matches the expected tools
        for tool_name in claude_mcp_tools.__all__:
            assert tool_name in expected_tools, f"Unexpected tool {tool_name} in __all__"

        # Verify all expected tools are in __all__
        for tool_name in expected_tools:
            assert tool_name in claude_mcp_tools.__all__, f"Tool {tool_name} should be in __all__"

    def test_deprecation_warning(self, caplog):
        """Test that a deprecation warning is logged when the module is imported."""
        with caplog.at_level(logging.WARNING):
            # Reload the module to trigger the warning
            importlib.reload(claude_mcp_tools)

            # Verify deprecation warning was logged
            assert "deprecated" in caplog.text
            assert "Please import from yaraflux_mcp_server.mcp_tools package instead" in caplog.text

    def test_scan_url_imports_from_package(self):
        """Test that scan_url function is imported from the mcp_tools package."""
        # Direct comparison test instead of mocking
        from yaraflux_mcp_server.mcp_tools.scan_tools import scan_url as original_scan_url

        # Verify the function imported in claude_mcp_tools is the same as the one in scan_tools
        assert claude_mcp_tools.scan_url is original_scan_url

    def test_list_yara_rules_imports_from_package(self):
        """Test that list_yara_rules function is imported from the mcp_tools package."""
        # Direct comparison test instead of mocking
        from yaraflux_mcp_server.mcp_tools.rule_tools import list_yara_rules as original_list_yara_rules

        # Verify the function imported in claude_mcp_tools is the same as the one in rule_tools
        assert claude_mcp_tools.list_yara_rules is original_list_yara_rules

    def test_upload_file_imports_from_package(self):
        """Test that upload_file function is imported from the mcp_tools package."""
        # Direct comparison test instead of mocking
        from yaraflux_mcp_server.mcp_tools.file_tools import upload_file as original_upload_file

        # Verify the function imported in claude_mcp_tools is the same as the one in file_tools
        assert claude_mcp_tools.upload_file is original_upload_file

    def test_get_storage_info_imports_from_package(self):
        """Test that get_storage_info function is imported from the mcp_tools package."""
        # Direct comparison test instead of mocking
        from yaraflux_mcp_server.mcp_tools.storage_tools import get_storage_info as original_get_storage_info

        # Verify the function imported in claude_mcp_tools is the same as the one in storage_tools
        assert claude_mcp_tools.get_storage_info is original_get_storage_info
