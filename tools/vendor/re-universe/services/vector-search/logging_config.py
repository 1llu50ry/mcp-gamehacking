"""Logging configuration for Vector Search Service."""

import logging
import sys
import structlog
from typing import Any, Dict
from pythonjsonlogger import jsonlogger

from config import settings


class StructuredFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter with additional context."""

    def add_fields(self, log_record: Dict[str, Any], record: logging.LogRecord, message_dict: Dict[str, Any]) -> None:
        """Add custom fields to log records."""
        super().add_fields(log_record, record, message_dict)

        # Add service context
        log_record['service'] = settings.service_name
        log_record['version'] = settings.service_version

        # Add performance metrics if available
        if hasattr(record, 'duration'):
            log_record['duration_ms'] = record.duration
        if hasattr(record, 'query_type'):
            log_record['query_type'] = record.query_type
        if hasattr(record, 'result_count'):
            log_record['result_count'] = record.result_count


def configure_logging() -> None:
    """Configure structured logging for the application."""

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.TimeStamper(fmt="ISO"),
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.ConsoleRenderer() if settings.debug else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure standard logging
    if settings.log_format.lower() == "structured":
        formatter = StructuredFormatter(
            fmt='%(asctime)s %(name)s %(levelname)s %(message)s'
        )
    else:
        formatter = logging.Formatter(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    # Configure root logger
    logging.root.setLevel(getattr(logging, settings.log_level))
    logging.root.handlers = [handler]

    # Configure specific loggers
    loggers = [
        'uvicorn',
        'uvicorn.error',
        'uvicorn.access',
        'fastapi',
        'asyncpg',
        'vector_search'
    ]

    for logger_name in loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(getattr(logging, settings.log_level))
        if logger_name == 'uvicorn.access' and not settings.debug:
            # Reduce access log noise in production
            logger.setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.BoundLogger:
    """Get a structured logger instance."""
    return structlog.get_logger(name)