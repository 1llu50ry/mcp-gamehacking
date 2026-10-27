"""YaraFlux MCP Server implementation using the official MCP SDK.

This module creates a proper MCP server that exposes YARA functionality
to MCP clients following the Model Context Protocol specification.
This version uses a modular approach with standardized parameter parsing and error handling.
"""

import logging
import os

from mcp.server.fastmcp import FastMCP

from yaraflux_mcp_server.auth import init_user_db
from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.yara_service import yara_service

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Import function implementations from the modular mcp_tools package
from yaraflux_mcp_server.mcp_tools.file_tools import delete_file as delete_file_func
from yaraflux_mcp_server.mcp_tools.file_tools import download_file as download_file_func
from yaraflux_mcp_server.mcp_tools.file_tools import extract_strings as extract_strings_func
from yaraflux_mcp_server.mcp_tools.file_tools import get_file_info as get_file_info_func
from yaraflux_mcp_server.mcp_tools.file_tools import get_hex_view as get_hex_view_func
from yaraflux_mcp_server.mcp_tools.file_tools import list_files as list_files_func
from yaraflux_mcp_server.mcp_tools.file_tools import upload_file as upload_file_func
from yaraflux_mcp_server.mcp_tools.rule_tools import add_yara_rule as add_yara_rule_func
from yaraflux_mcp_server.mcp_tools.rule_tools import delete_yara_rule as delete_yara_rule_func
from yaraflux_mcp_server.mcp_tools.rule_tools import get_yara_rule as get_yara_rule_func
from yaraflux_mcp_server.mcp_tools.rule_tools import import_threatflux_rules as import_threatflux_rules_func
from yaraflux_mcp_server.mcp_tools.rule_tools import list_yara_rules as list_yara_rules_func
from yaraflux_mcp_server.mcp_tools.rule_tools import update_yara_rule as update_yara_rule_func
from yaraflux_mcp_server.mcp_tools.rule_tools import validate_yara_rule as validate_yara_rule_func
from yaraflux_mcp_server.mcp_tools.scan_tools import get_scan_result as get_scan_result_func
from yaraflux_mcp_server.mcp_tools.scan_tools import scan_data as scan_data_func
from yaraflux_mcp_server.mcp_tools.scan_tools import scan_url as scan_url_func
from yaraflux_mcp_server.mcp_tools.storage_tools import clean_storage as clean_storage_func
from yaraflux_mcp_server.mcp_tools.storage_tools import get_storage_info as get_storage_info_func

# Create an MCP server.
# `title`/`description`/`version` were never real FastMCP parameters -- they
# were swallowed by the **settings catch-all in mcp 1.3.x and silently
# discarded. mcp >=1.10 replaced that catch-all with an explicit signature, so
# passing them now raises TypeError at import. `instructions` is the supported
# field that actually reaches the client; the version is read from package
# metadata, not declared here (the hardcoded "0.1.0" was stale anyway).
mcp = FastMCP(
    "YaraFlux",
    instructions="MCP server for YARA rule management and file scanning",
)


def register_tools():
    """Register all MCP tools directly with the MCP server.

    This approach preserves the full function signatures and docstrings,
    including natural language examples that show LLM users how to
    interact with these tools through MCP.
    """
    logger.info("Registering MCP tools...")

    # Scan tools
    mcp.tool(name="scan_url")(scan_url_func)
    mcp.tool(name="scan_data")(scan_data_func)
    mcp.tool(name="get_scan_result")(get_scan_result_func)

    # Rule tools
    mcp.tool(name="list_yara_rules")(list_yara_rules_func)
    mcp.tool(name="get_yara_rule")(get_yara_rule_func)
    mcp.tool(name="validate_yara_rule")(validate_yara_rule_func)
    mcp.tool(name="add_yara_rule")(add_yara_rule_func)
    mcp.tool(name="update_yara_rule")(update_yara_rule_func)
    mcp.tool(name="delete_yara_rule")(delete_yara_rule_func)
    mcp.tool(name="import_threatflux_rules")(import_threatflux_rules_func)

    # File tools
    mcp.tool(name="upload_file")(upload_file_func)
    mcp.tool(name="get_file_info")(get_file_info_func)
    mcp.tool(name="list_files")(list_files_func)
    mcp.tool(name="delete_file")(delete_file_func)
    mcp.tool(name="extract_strings")(extract_strings_func)
    mcp.tool(name="get_hex_view")(get_hex_view_func)
    mcp.tool(name="download_file")(download_file_func)

    # Storage tools
    mcp.tool(name="get_storage_info")(get_storage_info_func)
    mcp.tool(name="clean_storage")(clean_storage_func)

    logger.info("Registered all MCP tools successfully")


@mcp.resource("rules://{source}")
def get_rules_list(source: str = "all") -> str:
    """Get a list of YARA rules.

    Args:
        source: Source filter ("custom", "community", or "all")

    Returns:
        Formatted list of rules
    """
    try:
        rules = yara_service.list_rules(None if source == "all" else source)
        if not rules:
            return "No YARA rules found."

        result = f"# YARA Rules ({source})\n\n"
        for rule in rules:
            result += f"- **{rule.name}**"
            if rule.description:
                result += f": {rule.description}"
            result += f" (Source: {rule.source})\n"

        return result
    except Exception as e:
        logger.error(f"Error getting rules list: {str(e)}")
        return f"Error getting rules list: {str(e)}"


@mcp.resource("rule://{name}/{source}")
def get_rule_content(name: str, source: str = "custom") -> str:
    """Get the content of a specific YARA rule.

    Args:
        name: Name of the rule
        source: Source of the rule ("custom" or "community")

    Returns:
        Rule content
    """
    try:
        content = yara_service.get_rule(name, source)
        return f"```yara\n{content}\n```"
    except Exception as e:
        logger.error(f"Error getting rule content: {str(e)}")
        return f"Error getting rule content: {str(e)}"


def initialize_server() -> None:
    """Initialize the MCP server environment."""
    logger.info("Initializing YaraFlux MCP Server...")

    # Ensure directories exist
    directories = [
        settings.STORAGE_DIR,
        settings.YARA_RULES_DIR,
        settings.YARA_SAMPLES_DIR,
        settings.YARA_RESULTS_DIR,
        settings.YARA_RULES_DIR / "community",
        settings.YARA_RULES_DIR / "custom",
    ]

    for directory in directories:
        try:
            os.makedirs(directory, exist_ok=True)
            logger.info(f"Directory ensured: {directory}")
        except Exception as e:
            logger.error(f"Error creating directory {directory}: {str(e)}")
            raise

    # Initialize user database
    try:
        init_user_db()
        logger.info("User database initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing user database: {str(e)}")
        raise

    # Load YARA rules
    try:
        yara_service.load_rules(include_default_rules=settings.YARA_INCLUDE_DEFAULT_RULES)
        logger.info("YARA rules loaded successfully")
    except Exception as e:
        logger.error(f"Error loading YARA rules: {str(e)}")
        raise

    # Register MCP tools
    try:
        register_tools()
    except Exception as e:
        logger.error(f"Error registering MCP tools: {str(e)}")
        raise


async def list_registered_tools() -> list:
    """List all registered tools."""
    try:
        # Get tools using the async method properly
        tools = await mcp.list_tools()

        # MCP SDK may return tools in different formats based on version
        # Newer versions return Tool objects directly, older versions return dicts
        tool_names = []
        for tool in tools:
            if hasattr(tool, "name"):
                # It's a Tool object
                tool_names.append(tool.name)
            elif isinstance(tool, dict) and "name" in tool:
                # It's a dictionary with a name key
                tool_names.append(tool["name"])
            else:
                # Unknown format, try to get a string representation
                tool_names.append(str(tool))

        logger.info(f"Available MCP tools: {tool_names}")
        return tool_names
    except Exception as e:
        logger.error(f"Error listing tools: {str(e)}")
        return []


def run_server(transport_mode="http"):
    """Run the MCP server with the specified transport mode.

    Args:
        transport_mode: Transport mode to use ("stdio" or "http")
    """
    try:
        # Initialize server components
        initialize_server()

        # Set up connection handlers
        mcp.on_connect = lambda: logger.info("MCP connection established")
        mcp.on_disconnect = lambda: logger.info("MCP connection closed")

        # Import asyncio here to ensure it's available for both modes
        import asyncio  # pylint: disable=import-outside-toplevel

        # Run with appropriate transport
        if transport_mode == "stdio":
            logger.info("Starting MCP server with stdio transport")
            # Import stdio_server here since it's only needed for stdio mode
            from mcp.server.stdio import stdio_server  # pylint: disable=import-outside-toplevel

            async def run_stdio() -> None:
                async with stdio_server() as (read_stream, write_stream):
                    # Before the main run, we can list tools properly
                    await list_registered_tools()

                    # Now run the server
                    # pylint: disable=protected-access
                    await mcp._mcp_server.run(
                        read_stream, write_stream, mcp._mcp_server.create_initialization_options()
                    )  # pylint: disable=protected-access

            asyncio.run(run_stdio())
        else:
            logger.info("Starting MCP server with HTTP transport")
            # For HTTP mode, we need to handle the async method differently
            # since mcp.run() is not async itself
            asyncio.run(list_registered_tools())

            # Now run the server
            mcp.run()

    except Exception as e:
        logger.critical(f"Critical error during server operation: {str(e)}")
        raise


# Run the MCP server when executed directly
if __name__ == "__main__":
    import sys

    # Default to stdio transport for MCP integration
    transport = "stdio"

    # If --transport is specified, use that mode
    if "--transport" in sys.argv:
        try:
            transport_index = sys.argv.index("--transport") + 1
            if transport_index < len(sys.argv):
                transport = sys.argv[transport_index]
        except IndexError:
            logger.error("Invalid transport argument")
        except Exception as e:
            logger.error("Error parsing transport argument: %s", str(e))

    logger.info(f"Using transport mode: {transport}")
    run_server(transport)
