"""
MCP Clients Package
==================

This package contains various MCP (Model Context Protocol) client implementations
for the Cheat Engine Server automation system.

Client Types:
------------
- simple_client: Basic MCP client with fundamental automation
- enhanced_client: Advanced client with comprehensive error handling
- reliable_client: Focused on working automation with memory scanning
- working_client: Demonstrates successful MCP automation workflow
- complete_client: Final comprehensive implementation with all features

Each client demonstrates different aspects of MCP automation:
- Process launching and management
- GUI automation using PyAutoGUI integration
- Memory scanning and pattern detection
- Error handling and recovery
- Comprehensive logging and reporting

Usage:
------
Run any client from the project root:

python clients/simple_client.py
python clients/reliable_client.py
python clients/complete_client.py

All clients automatically import from the server module structure.
"""

__version__ = "1.0.0"
__author__ = "MCP Cheat Engine Server"

__all__ = []
