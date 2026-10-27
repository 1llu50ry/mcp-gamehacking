"""Main application entry point for YaraFlux MCP Server.

This module initializes the FastAPI application with MCP integration, routers,
middleware, and event handlers.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from yaraflux_mcp_server.auth import init_user_db
from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.yara_service import yara_service

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> None:  # pylint: disable=unused-argument disable=redefined-outer-name
    """
    Lifespan context manager for FastAPI application.

    Args:
        app: The FastAPI application instance

    This replaces the deprecated @app.on_event handlers and manages the application lifecycle.
    """
    if app:
        logger.info("App found")
    # ===== Startup operations =====
    logger.info("Starting YaraFlux MCP Server")

    # Ensure directories exist
    ensure_directories_exist()
    logger.info("Directory structure verified")

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

    # Yield control back to the application
    yield

    # ===== Shutdown operations =====
    logger.info("Shutting down YaraFlux MCP Server")


def ensure_directories_exist() -> None:
    """Ensure all required directories exist."""
    # Get directory paths from settings
    directories = [settings.STORAGE_DIR, settings.YARA_RULES_DIR, settings.YARA_SAMPLES_DIR, settings.YARA_RESULTS_DIR]

    # Create each directory
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        logger.info(f"Ensured directory exists: {directory}")

    # Create source subdirectories for rules
    os.makedirs(settings.YARA_RULES_DIR / "community", exist_ok=True)
    os.makedirs(settings.YARA_RULES_DIR / "custom", exist_ok=True)
    logger.info("Ensured rule source directories exist")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI application
    """
    # Create FastAPI app with lifespan
    app = FastAPI(  # pylint: disable=redefined-outer-name
        title="YaraFlux MCP Server",
        description="Model Context Protocol server for YARA scanning",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Add exception handler for YaraError
    @app.exception_handler(Exception)
    async def generic_exception_handler(exc: Exception):
        """Handle generic exceptions."""
        logger.error(f"Unhandled exception: {str(exc)}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Internal server error", "detail": str(exc)},
        )

    # Add API routers
    # Import routers here to avoid circular imports
    try:
        from yaraflux_mcp_server.routers import (  # pylint: disable=import-outside-toplevel
            auth_router,
            files_router,
            rules_router,
            scan_router,
        )

        app.include_router(auth_router, prefix=settings.API_PREFIX)
        app.include_router(rules_router, prefix=settings.API_PREFIX)
        app.include_router(scan_router, prefix=settings.API_PREFIX)
        app.include_router(files_router, prefix=settings.API_PREFIX)
        logger.info("API routers initialized")
    except Exception as e:
        logger.error(f"Error initializing API routers: {str(e)}")  # pylint: disable=logging-fstring-interpolation

    # Add MCP router
    try:
        # Import both MCP tools modules
        import yaraflux_mcp_server.mcp_tools  # pylint: disable=import-outside-toplevel disable=unused-import

        # Initialize Claude MCP tools with FastAPI
        from yaraflux_mcp_server.claude_mcp import init_fastapi  # pylint: disable=import-outside-toplevel

        init_fastapi(app)

        logger.info("MCP tools initialized and registered with FastAPI")
    except Exception as e:
        logger.error(f"Error setting up MCP: {str(e)}")
        logger.warning("MCP integration skipped.")

    # Add health check endpoint
    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy"}

    return app


# Create and export the application
app = create_app()

# Define __all__ to explicitly export the app variable
__all__ = ["app"]


if __name__ == "__main__":
    import uvicorn

    # Run the app
    uvicorn.run("yaraflux_mcp_server.app:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
