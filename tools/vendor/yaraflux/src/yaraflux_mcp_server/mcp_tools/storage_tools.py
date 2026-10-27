"""Storage management tools for Claude MCP integration.

This module provides tools for managing storage, including checking storage usage
and cleaning up old files. It uses direct function implementations with inline
error handling.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional

from yaraflux_mcp_server.mcp_tools.base import register_tool
from yaraflux_mcp_server.storage import get_storage_client

# Configure logging
logger = logging.getLogger(__name__)


@register_tool()
def get_storage_info() -> Dict[str, Any]:
    """Get information about the storage system.

    This tool provides detailed information about storage usage, including:
    - Storage type (local or remote)
    - Directory locations
    - File counts and sizes by storage type

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me storage usage information"
    "How much space is being used by the system?"
    "What files are stored and how much space do they take up?"

    Returns:
        Information about storage usage and configuration
    """
    try:
        storage = get_storage_client()

        # Get storage configuration
        config = {
            "storage_type": storage.__class__.__name__.replace("StorageClient", "").lower(),
        }

        # Get directory paths for local storage
        if hasattr(storage, "rules_dir"):
            config["local_directories"] = {
                "rules": str(storage.rules_dir),
                "samples": str(storage.samples_dir),
                "results": str(storage.results_dir),
            }

        # Get storage usage
        usage = {}

        # Rules storage
        try:
            rules = storage.list_rules()
            rules_count = len(rules)
            rules_size = sum(rule.get("size", 0) for rule in rules if isinstance(rule, dict))
            usage["rules"] = {
                "file_count": rules_count,
                "size_bytes": rules_size,
                "size_human": f"{rules_size:.2f} B",
            }
        except Exception as e:
            logger.warning(f"Error getting rules storage info: {e}")
            usage["rules"] = {"file_count": 0, "size_bytes": 0, "size_human": "0.00 B"}

        # Files storage (samples)
        try:
            files = storage.list_files()
            files_count = files.get("total", 0)
            files_size = sum(file.get("file_size", 0) for file in files.get("files", []))
            usage["samples"] = {
                "file_count": files_count,
                "size_bytes": files_size,
                "size_human": format_size(files_size),
            }
        except Exception as e:
            logger.warning(f"Error getting files storage info: {e}")
            usage["samples"] = {"file_count": 0, "size_bytes": 0, "size_human": "0.00 B"}

        # Results storage
        try:
            # This is an approximation since we don't have a direct way to list results
            # A more accurate implementation would need storage.list_results() method
            import os  # pylint: disable=import-outside-toplevel

            results_path = getattr(storage, "results_dir", None)
            if results_path and os.path.exists(results_path):
                results_files = [f for f in os.listdir(results_path) if f.endswith(".json")]
                results_size = sum(os.path.getsize(os.path.join(results_path, f)) for f in results_files)
                usage["results"] = {
                    "file_count": len(results_files),
                    "size_bytes": results_size,
                    "size_human": format_size(results_size),
                }
            else:
                usage["results"] = {"file_count": 0, "size_bytes": 0, "size_human": "0.00 B"}
        except Exception as e:
            logger.warning(f"Error getting results storage info: {e}")
            usage["results"] = {"file_count": 0, "size_bytes": 0, "size_human": "0.00 B"}

        # Total usage
        total_count = sum(item.get("file_count", 0) for item in usage.values())
        total_size = sum(item.get("size_bytes", 0) for item in usage.values())
        usage["total"] = {
            "file_count": total_count,
            "size_bytes": total_size,
            "size_human": format_size(total_size),
        }

        return {
            "success": True,
            "info": {
                "storage_type": config["storage_type"],
                **({"local_directories": config.get("local_directories", {})} if "local_directories" in config else {}),
                "usage": usage,
            },
        }
    except Exception as e:
        logger.error(f"Error in get_storage_info: {str(e)}")
        return {"success": False, "message": f"Error getting storage info: {str(e)}"}


@register_tool()
def clean_storage(storage_type: str, older_than_days: Optional[int] = None) -> Dict[str, Any]:
    """Clean up storage by removing old files.

    This tool removes old files from storage to free up space. It can target
    specific storage types and age thresholds.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Clean up old scan results"
    "Remove files older than 30 days"
    "Free up space by deleting old samples"

    Args:
        storage_type: Type of storage to clean ('results', 'samples', or 'all')
        older_than_days: Remove files older than X days (if None, use default)

    Returns:
        Cleanup result with count of removed files and freed space
    """
    try:
        if storage_type not in ["results", "samples", "all"]:
            raise ValueError(f"Invalid storage type: {storage_type}. Must be 'results', 'samples', or 'all'")

        storage = get_storage_client()
        cleaned_count = 0
        freed_bytes = 0

        # Calculate cutoff date
        if older_than_days is not None:
            cutoff_date = datetime.now(UTC) - timedelta(days=older_than_days)
        else:
            # Default to 30 days
            cutoff_date = datetime.now(UTC) - timedelta(days=30)

        # Clean results
        if storage_type in ["results", "all"]:
            try:
                # Implementation depends on the storage backend
                # For local storage, we can delete files older than cutoff_date
                if hasattr(storage, "results_dir") and storage.results_dir.exists():
                    import os  # pylint: disable=import-outside-toplevel

                    results_path = storage.results_dir
                    for file_path in results_path.glob("*.json"):
                        try:
                            # Check file modification time (make timezone-aware)
                            mtime = datetime.fromtimestamp(os.path.getmtime(file_path), tz=UTC)
                            if mtime < cutoff_date:
                                # Check file size before deleting
                                file_size = os.path.getsize(file_path)

                                # Delete the file
                                os.remove(file_path)

                                # Update counters
                                cleaned_count += 1
                                freed_bytes += file_size
                        except (OSError, IOError) as e:
                            logger.warning(f"Error cleaning results file {file_path}: {e}")
            except Exception as e:
                logger.error(f"Error cleaning results storage: {e}")

        # Clean samples
        if storage_type in ["samples", "all"]:
            try:
                # For file storage, we need to list files and check timestamps
                files = storage.list_files(page=1, page_size=1000, sort_by="uploaded_at", sort_desc=False)

                for file_info in files.get("files", []):
                    try:
                        # Extract timestamp and convert to datetime
                        uploaded_str = file_info.get("uploaded_at", "")
                        if not uploaded_str:
                            continue

                        if isinstance(uploaded_str, str):
                            uploaded_at = datetime.fromisoformat(uploaded_str.replace("Z", "+00:00"))
                        else:
                            uploaded_at = uploaded_str

                        # Check if file is older than cutoff date
                        if uploaded_at < cutoff_date:
                            # Get file size
                            file_size = file_info.get("file_size", 0)

                            # Delete the file
                            file_id = file_info.get("file_id", "")
                            if file_id:
                                deleted = storage.delete_file(file_id)
                                if deleted:
                                    # Update counters
                                    cleaned_count += 1
                                    freed_bytes += file_size
                    except Exception as e:
                        logger.warning(f"Error cleaning sample {file_info.get('file_id', '')}: {e}")
            except Exception as e:
                logger.error(f"Error cleaning samples storage: {e}")

        return {
            "success": True,
            "message": f"Cleaned {cleaned_count} files from {storage_type} storage",
            "cleaned_count": cleaned_count,
            "freed_bytes": freed_bytes,
            "freed_human": format_size(freed_bytes),
            "cutoff_date": cutoff_date.isoformat(),
        }
    except ValueError as e:
        logger.error(f"Value error in clean_storage: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in clean_storage: {str(e)}")
        return {"success": False, "message": f"Error cleaning storage: {str(e)}"}


def format_size(size_bytes: int) -> str:
    """Format a byte size into a human-readable string.

    Args:
        size_bytes: Size in bytes

    Returns:
        Human-readable size string (e.g., "1.23 MB")
    """
    if size_bytes < 1024:
        return f"{size_bytes:.2f} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.2f} KB"
    if size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.2f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"
