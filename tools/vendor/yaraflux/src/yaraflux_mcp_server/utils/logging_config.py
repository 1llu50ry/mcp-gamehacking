"""Logging configuration for YaraFlux MCP Server.

This module provides a comprehensive logging configuration with structured JSON logs,
log rotation, and contextual information.
"""

import json
import logging
import logging.config
import os
import sys
import threading  # Import threading at module level
import uuid
from datetime import datetime
from functools import wraps
from logging.handlers import RotatingFileHandler
from typing import Any, Callable, Dict, Optional, TypeVar, cast

# Define a context variable for request IDs
REQUEST_ID_CONTEXT: Dict[int, str] = {}

# Type definitions
F = TypeVar("F", bound=Callable[..., Any])


def get_request_id() -> str:
    """Get the current request ID from context or generate a new one."""
    thread_id = id(threading.current_thread())
    if thread_id not in REQUEST_ID_CONTEXT:
        REQUEST_ID_CONTEXT[thread_id] = str(uuid.uuid4())
    return REQUEST_ID_CONTEXT[thread_id]


def set_request_id(request_id: Optional[str] = None) -> str:
    """Set the current request ID in the context."""
    thread_id = id(threading.current_thread())
    if request_id is None:
        request_id = str(uuid.uuid4())
    REQUEST_ID_CONTEXT[thread_id] = request_id
    return request_id


def clear_request_id() -> None:
    """Clear the current request ID from the context."""
    thread_id = id(threading.current_thread())
    if thread_id in REQUEST_ID_CONTEXT:
        del REQUEST_ID_CONTEXT[thread_id]


class RequestIdFilter(logging.Filter):
    """Logging filter to add request ID to log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Add request ID to the log record."""
        record.request_id = get_request_id()  # type: ignore
        return True


class JsonFormatter(logging.Formatter):
    """Formatter to produce JSON-formatted logs."""

    def __init__(
        self,
        fmt: Optional[str] = None,
        datefmt: Optional[str] = None,
        style: str = "%",
        validate: bool = True,
        *,
        defaults: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Initialize the formatter."""
        super().__init__(fmt, datefmt, style, validate, defaults=defaults)
        self.hostname = os.uname().nodename

    def format(self, record: logging.LogRecord) -> str:
        """Format the record as JSON."""
        # Get the formatted exception info if available
        exc_info = None
        if record.exc_info:
            exc_info = self.formatException(record.exc_info)

        # Create log data dictionary
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "request_id": getattr(record, "request_id", "unknown"),
            "hostname": self.hostname,
            "process_id": record.process,
            "thread_id": record.thread,
        }

        # Add exception info if available
        if exc_info:
            log_data["exception"] = exc_info.split("\n")

        # Add extra attributes
        for key, value in record.__dict__.items():
            if key not in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "id",
                "levelname",
                "levelno",
                "lineno",
                "module",
                "msecs",
                "message",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "thread",
                "threadName",
                "request_id",  # Already included above
            }:
                # Try to add it if it's serializable
                try:
                    json.dumps({key: value})
                    log_data[key] = value
                except (TypeError, OverflowError):
                    # Skip values that can't be serialized to JSON
                    log_data[key] = str(value)

        # Format as JSON
        return json.dumps(log_data)


def mask_sensitive_data(log_record: Dict[str, Any], sensitive_fields: Optional[list] = None) -> Dict[str, Any]:
    """Mask sensitive data in a log record dictionary.

    Args:
        log_record: Dictionary log record
        sensitive_fields: List of sensitive field names to mask

    Returns:
        Dictionary with sensitive fields masked
    """
    if sensitive_fields is None:
        sensitive_fields = [
            "password",
            "token",
            "secret",
            "api_key",
            "key",
            "auth",
            "credentials",
            "jwt",
        ]

    result = {}
    for key, value in log_record.items():
        if isinstance(value, dict):
            result[key] = mask_sensitive_data(value, sensitive_fields)
        elif isinstance(value, list):
            result[key] = [
                mask_sensitive_data(item, sensitive_fields) if isinstance(item, dict) else item for item in value
            ]
        elif any(sensitive in key.lower() for sensitive in sensitive_fields):
            result[key] = "**REDACTED**"
        else:
            result[key] = value

    return result


def log_entry_exit(logger: Optional[logging.Logger] = None, level: int = logging.DEBUG) -> Callable[[F], F]:
    """Decorator to log function entry and exit.

    Args:
        logger: Logger to use (if None, get logger based on module name)
        level: Logging level

    Returns:
        Decorator function
    """

    def decorator(func: F) -> F:
        """Decorator implementation."""
        # Get the module name if logger not provided
        nonlocal logger
        if logger is None:
            logger = logging.getLogger(func.__module__)

        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            """Wrapper function to log entry and exit."""
            # Generate a request ID if not already set
            request_id = get_request_id()

            # Log entry
            func_args = ", ".join([str(arg) for arg in args] + [f"{k}={v}" for k, v in kwargs.items()])
            logger.log(level, f"Entering {func.__name__}({func_args})", extra={"request_id": request_id})

            # Execute function
            try:
                result = func(*args, **kwargs)

                # Log exit
                logger.log(level, f"Exiting {func.__name__}", extra={"request_id": request_id})
                return result
            except Exception as e:
                # Log exception
                logger.exception(f"Exception in {func.__name__}: {str(e)}", extra={"request_id": request_id})
                raise

        return cast(F, wrapper)

    return decorator


def configure_logging(
    log_level: str = "INFO",
    *,
    log_file: Optional[str] = None,
    enable_json: bool = True,
    log_to_console: bool = True,
    max_bytes: int = 10485760,  # 10MB
    backup_count: int = 10,
) -> None:
    """Configure logging for the application.

    Args:
        log_level: Logging level
        log_file: Path to log file (if None, no file logging)
        enable_json: Whether to use JSON formatting
        log_to_console: Whether to log to console
        max_bytes: Maximum size of log file before rotation
        backup_count: Number of backup files to keep
    """
    # Threading is now imported at module level

    # Create handlers
    handlers = {}

    # Console handler
    if log_to_console:
        console_handler = logging.StreamHandler(sys.stdout)
        if enable_json:
            console_handler.setFormatter(JsonFormatter())
        else:
            console_handler.setFormatter(
                logging.Formatter("%(asctime)s - %(name)s - [%(request_id)s] - %(levelname)s - %(message)s")
            )
        console_handler.addFilter(RequestIdFilter())
        handlers["console"] = {
            "class": "logging.StreamHandler",
            "level": log_level,
            "formatter": "json" if enable_json else "standard",
            "filters": ["request_id"],
            "stream": "ext://sys.stdout",
        }

    # File handler (if log_file provided)
    if log_file:
        os.makedirs(os.path.dirname(os.path.abspath(log_file)), exist_ok=True)
        file_handler = RotatingFileHandler(
            filename=log_file,
            maxBytes=max_bytes,
            backupCount=backup_count,
        )
        if enable_json:
            file_handler.setFormatter(JsonFormatter())
        else:
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s - %(name)s - [%(request_id)s] - %(levelname)s - %(message)s")
            )
        file_handler.addFilter(RequestIdFilter())
        handlers["file"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "level": log_level,
            "formatter": "json" if enable_json else "standard",
            "filters": ["request_id"],
            "filename": log_file,
            "maxBytes": max_bytes,
            "backupCount": backup_count,
        }

    # Create logging configuration
    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s - %(name)s - [%(request_id)s] - %(levelname)s - %(message)s",
            },
            "json": {
                "()": "yaraflux_mcp_server.utils.logging_config.JsonFormatter",
            },
        },
        "filters": {
            "request_id": {
                "()": "yaraflux_mcp_server.utils.logging_config.RequestIdFilter",
            },
        },
        "handlers": handlers,
        "loggers": {
            "": {  # Root logger
                "handlers": list(handlers.keys()),
                "level": log_level,
                "propagate": True,
            },
            "yaraflux_mcp_server": {
                "handlers": list(handlers.keys()),
                "level": log_level,
                "propagate": False,
            },
        },
    }

    # Apply configuration
    logging.config.dictConfig(logging_config)

    # Log startup message
    logger = logging.getLogger("yaraflux_mcp_server")
    logger.info(
        "Logging configured",
        extra={
            "log_level": log_level,
            "log_file": log_file,
            "enable_json": enable_json,
            "log_to_console": log_to_console,
        },
    )
