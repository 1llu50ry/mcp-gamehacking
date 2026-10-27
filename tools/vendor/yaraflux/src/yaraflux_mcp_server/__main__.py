"""Command-line entry point for YaraFlux MCP Server.

This module allows running the YaraFlux MCP Server directly as a Python module:
python -m yaraflux_mcp_server
"""

import logging

import click
import uvicorn

from yaraflux_mcp_server.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@click.group()
def cli() -> None:
    """YaraFlux MCP Server CLI."""
    # No operation needed for group command


@cli.command()
@click.option("--host", default=settings.HOST, help="Host to bind the server to")
@click.option("--port", default=settings.PORT, type=int, help="Port to bind the server to")
@click.option("--debug", is_flag=True, default=settings.DEBUG, help="Enable debug mode with auto-reload")
@click.option("--workers", default=1, type=int, help="Number of worker processes")
def run(host: str, port: int, debug: bool, workers: int) -> None:
    """Run the YaraFlux MCP Server."""
    logger.info(f"Starting YaraFlux MCP Server on {host}:{port}")

    # Display Claude Desktop integration info if debug is enabled
    if debug:
        logger.info("ClaudeDesktop: YaraFlux MCP Server is ready for Claude Desktop integration")
        logger.info("ClaudeDesktop: Ensure you have configured claude_desktop_config.json")

        # Log environment variables (omitting sensitive ones)
        env_vars = {
            "HOST": host,
            "PORT": port,
            "DEBUG": debug,
            "USE_MINIO": settings.USE_MINIO,
            "JWT_SECRET_KEY": "[REDACTED]" if settings.JWT_SECRET_KEY else "[NOT SET]",
            "ADMIN_PASSWORD": "[REDACTED]" if settings.ADMIN_PASSWORD else "[NOT SET]",
        }
        logger.info(f"ClaudeDesktop: Environment variables: {env_vars}")

    # Run with Uvicorn
    uvicorn.run("yaraflux_mcp_server.app:app", host=host, port=port, reload=debug, workers=workers)


@cli.command()
@click.option("--url", default=None, help="URL to the ThreatFlux YARA-Rules repository")
@click.option("--branch", default="master", help="Branch to import rules from")
def import_rules(url: str, branch: str) -> None:
    """Import ThreatFlux YARA rules."""
    # Import dependencies inline to avoid circular imports
    from yaraflux_mcp_server.mcp_tools import import_threatflux_rules  # pylint: disable=import-outside-toplevel

    # Import rules
    logger.info(f"Importing rules from {url or 'default ThreatFlux repository'}")
    result = import_threatflux_rules(url, branch)

    if result.get("success"):
        logger.info(f"Import successful: {result.get('message')}")
    else:
        logger.error(f"Import failed: {result.get('message')}")


if __name__ == "__main__":
    cli()
