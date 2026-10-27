#!/usr/bin/env python
"""
Entry point for running the YaraFlux MCP server.

This script initializes the environment and starts the MCP server,
making it available for Claude Desktop integration.
"""

import logging
import os

from yaraflux_mcp_server.auth import init_user_db
from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.yara_service import yara_service

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def setup_environment() -> None:
    """Set up the environment for the MCP server."""
    # Ensure required directories exist
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)
    os.makedirs(settings.YARA_RULES_DIR, exist_ok=True)
    os.makedirs(settings.YARA_SAMPLES_DIR, exist_ok=True)
    os.makedirs(settings.YARA_RESULTS_DIR, exist_ok=True)
    os.makedirs(settings.YARA_RULES_DIR / "community", exist_ok=True)
    os.makedirs(settings.YARA_RULES_DIR / "custom", exist_ok=True)

    # Initialize user database
    try:
        init_user_db()
        logger.info("User database initialized")
    except Exception as e:
        logger.error(f"Error initializing user database: {str(e)}")

    # Load YARA rules
    try:
        yara_service.load_rules(include_default_rules=settings.YARA_INCLUDE_DEFAULT_RULES)
        logger.info("YARA rules loaded")
    except Exception as e:
        logger.error(f"Error loading YARA rules: {str(e)}")


def main() -> None:
    """Main entry point for running the MCP server."""
    logger.info("Starting YaraFlux MCP Server")

    # Set up the environment
    setup_environment()

    # Import the MCP server (after environment setup)
    from yaraflux_mcp_server.mcp_server import mcp  # pylint: disable=import-outside-toplevel

    # Run the MCP server
    logger.info("Running MCP server...")
    mcp.run()


if __name__ == "__main__":
    main()
