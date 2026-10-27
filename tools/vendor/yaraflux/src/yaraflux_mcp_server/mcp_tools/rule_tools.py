"""YARA rule management tools for Claude MCP integration.

This module provides tools for managing YARA rules, including listing,
adding, updating, validating, and deleting rules. It uses direct function
implementations with inline error handling.
"""

import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from tarfile import ReadError
from typing import Any, Dict, List, Optional

import httpx

from yaraflux_mcp_server.mcp_tools.base import register_tool
from yaraflux_mcp_server.yara_service import YaraError, yara_service

# Configure logging
logger = logging.getLogger(__name__)


@register_tool()
def list_yara_rules(source: Optional[str] = None) -> List[Dict[str, Any]]:
    """List available YARA rules.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me all YARA rules"
    "List custom YARA rules only"
    "What community rules are available?"

    Args:
        source: Optional source filter ("custom" or "community")

    Returns:
        List of YARA rule metadata objects
    """
    try:
        # Validate source if provided
        if source and source not in ["custom", "community", "all"]:
            raise ValueError(f"Invalid source: {source}. Must be 'custom', 'community', or 'all'")

        # Get rules from the YARA service
        rules = yara_service.list_rules(None if source == "all" else source)

        # Convert to dict for serialization
        return [rule.model_dump() for rule in rules]
    except ValueError as e:
        logger.error(f"Value error in list_yara_rules: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Error listing YARA rules: {str(e)}")
        return []


@register_tool()
def get_yara_rule(rule_name: str, source: str = "custom") -> Dict[str, Any]:
    """Get a YARA rule's content.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Show me the code for rule suspicious_strings"
    "Get the content of the ransomware detection rule"
    "What does the CVE-2023-1234 rule look like?"

    Args:
        rule_name: Name of the rule to get
        source: Source of the rule ("custom" or "community")

    Returns:
        Rule content and metadata
    """
    try:
        # Validate source
        if source not in ["custom", "community"]:
            raise ValueError(f"Invalid source: {source}. Must be 'custom' or 'community'")

        # Get rule content
        content = yara_service.get_rule(rule_name, source)

        # Get rule metadata
        rules = yara_service.list_rules(source)
        metadata = None
        for rule in rules:
            if rule.name == rule_name:
                metadata = rule
                break

        # Return content and metadata
        return {
            "success": True,
            "result": {
                "name": rule_name,
                "source": source,
                "content": content,
                "metadata": metadata.model_dump() if metadata else {},
            },
        }
    except YaraError as e:
        logger.error(f"YARA error in get_yara_rule: {str(e)}")
        return {"success": False, "message": str(e), "name": rule_name, "source": source}
    except ValueError as e:
        logger.error(f"Value error in get_yara_rule: {str(e)}")
        return {"success": False, "message": str(e), "name": rule_name, "source": source}
    except Exception as e:
        logger.error(f"Unexpected error in get_yara_rule: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}", "name": rule_name, "source": source}


@register_tool()
def validate_yara_rule(content: str) -> Dict[str, Any]:
    """Validate a YARA rule.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Check if this YARA rule syntax is valid"
    "Validate this detection rule for me"
    "Is this YARA code correctly formatted?"

    Args:
        content: YARA rule content to validate

    Returns:
        Validation result with detailed error information if invalid
    """
    try:
        if not content.strip():
            raise ValueError("Rule content cannot be empty")

        try:
            # Create a temporary rule name for validation
            temp_rule_name = f"validate_{int(datetime.now(UTC).timestamp())}.yar"

            # Attempt to add the rule (this will validate it)
            yara_service.add_rule(temp_rule_name, content)

            # Rule is valid, delete it
            yara_service.delete_rule(temp_rule_name)

            return {"valid": True, "message": "Rule is valid"}

        except YaraError as e:
            # Capture the original compilation error
            error_message = str(e)
            logger.debug("YARA compilation error: %s", error_message)
            raise YaraError("Rule validation failed: " + error_message) from e

    except YaraError as e:
        logger.error(f"YARA error in validate_yara_rule: {str(e)}")
        return {"valid": False, "message": str(e), "error_type": "YaraError"}
    except ValueError as e:
        logger.error(f"Value error in validate_yara_rule: {str(e)}")
        return {"valid": False, "message": str(e), "error_type": "ValueError"}
    except Exception as e:
        logger.error(f"Unexpected error in validate_yara_rule: {str(e)}")
        return {
            "valid": False,
            "message": f"Unexpected error: {str(e)}",
            "error_type": e.__class__.__name__,
        }


@register_tool()
def add_yara_rule(name: str, content: str, source: str = "custom") -> Dict[str, Any]:
    """Add a new YARA rule.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Create a new YARA rule named suspicious_urls"
    "Add this detection rule for PowerShell obfuscation"
    "Save this YARA rule to detect malicious macros"

    Args:
        name: Name of the rule
        content: YARA rule content
        source: Source of the rule ("custom" or "community")

    Returns:
        Result of the operation
    """
    try:
        # Validate source
        if source not in ["custom", "community"]:
            raise ValueError(f"Invalid source: {source}. Must be 'custom' or 'community'")

        # Ensure rule name has .yar extension
        if not name.endswith(".yar"):
            name = f"{name}.yar"

        # Validate content
        if not content.strip():
            raise ValueError("Rule content cannot be empty")

        # Add the rule
        metadata = yara_service.add_rule(name, content, source)

        return {"success": True, "message": f"Rule {name} added successfully", "metadata": metadata.model_dump()}
    except YaraError as e:
        logger.error(f"YARA error in add_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except ValueError as e:
        logger.error(f"Value error in add_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in add_yara_rule: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def update_yara_rule(name: str, content: str, source: str = "custom") -> Dict[str, Any]:
    """Update an existing YARA rule.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Update the ransomware detection rule"
    "Modify the suspicious_urls rule to include these new patterns"
    "Fix the syntax error in the malicious_macros rule"

    Args:
        name: Name of the rule
        content: Updated YARA rule content
        source: Source of the rule ("custom" or "community")

    Returns:
        Result of the operation
    """
    try:
        # Validate source
        if source not in ["custom", "community"]:
            raise ValueError(f"Invalid source: {source}. Must be 'custom' or 'community'")

        # Ensure rule exists
        yara_service.get_rule(name, source)  # Will raise YaraError if not found

        # Validate content
        if not content.strip():
            raise ValueError("Rule content cannot be empty")

        # Update the rule
        metadata = yara_service.update_rule(name, content, source)

        return {"success": True, "message": f"Rule {name} updated successfully", "metadata": metadata.model_dump()}
    except YaraError as e:
        logger.error(f"YARA error in update_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except ValueError as e:
        logger.error(f"Value error in update_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in update_yara_rule: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def delete_yara_rule(name: str, source: str = "custom") -> Dict[str, Any]:
    """Delete a YARA rule.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Delete the ransomware detection rule"
    "Remove the rule named suspicious_urls"
    "Get rid of the outdated CVE-2020-1234 rule"

    Args:
        name: Name of the rule
        source: Source of the rule ("custom" or "community")

    Returns:
        Result of the operation
    """
    try:
        # Validate source
        if source not in ["custom", "community"]:
            raise ValueError(f"Invalid source: {source}. Must be 'custom' or 'community'")

        # Delete the rule
        result = yara_service.delete_rule(name, source)

        if result:
            return {"success": True, "message": f"Rule {name} deleted successfully"}
        return {"success": False, "message": f"Rule {name} not found"}
    except YaraError as e:
        logger.error(f"YARA error in delete_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except ValueError as e:
        logger.error(f"Value error in delete_yara_rule: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in delete_yara_rule: {str(e)}")
        return {"success": False, "message": f"Unexpected error: {str(e)}"}


@register_tool()
def import_threatflux_rules(url: Optional[str] = None, branch: str = "main") -> Dict[str, Any]:
    """Import ThreatFlux YARA rules from GitHub.

    For LLM users connecting through MCP, this can be invoked with natural language like:
    "Import YARA rules from ThreatFlux"
    "Get the latest detection rules from the ThreatFlux repository"
    "Import YARA rules from a custom GitHub repo"

    Args:
        url: URL to the GitHub repository (if None, use default ThreatFlux repository)
        branch: Branch name to import from

    Returns:
        Import result
    """
    try:
        # Set default URL if not provided
        if url is None:
            url = "https://github.com/ThreatFlux/YARA-Rules"

        # Validate branch
        if not branch:
            branch = "main"

        import_count = 0
        error_count = 0

        # Check for connection errors immediately
        try:
            # Test connection by attempting to access the URL
            test_response = httpx.get(url.replace("github.com", "raw.githubusercontent.com"), timeout=10)
            if test_response.status_code >= 400:
                raise ValueError(f"HTTP {test_response.status_code}")
        except ConnectionError as e:
            logger.error("Connection error in import_threatflux_rules: %s", str(e))
            return {"success": False, "message": f"Connection error: {str(e)}", "error": str(e)}

        # Create a temporary directory for downloading the repo
        with tempfile.TemporaryDirectory() as temp_dir:
            # Set up paths
            temp_path = Path(temp_dir)
            if not temp_path.exists():
                temp_path.mkdir(parents=True)

            # Clone or download the repository
            if "github.com" in url:
                # Format for raw content
                raw_url = url.replace("github.com", "raw.githubusercontent.com")
                if raw_url.endswith("/"):
                    raw_url = raw_url[:-1]

                # Get the repository contents
                import_path = f"{raw_url}/{branch}"

                # Download and process index.json if available
                try:
                    index_url = f"{import_path}/index.json"
                    response = httpx.get(index_url, follow_redirects=True)
                    if response.status_code == 200:
                        # Parse index
                        index = response.json()
                        rule_files = index.get("rules", [])

                        # Download each rule file
                        for rule_file in rule_files:
                            rule_url = f"{import_path}/{rule_file}"
                            try:
                                rule_response = httpx.get(rule_url, follow_redirects=True)
                                if rule_response.status_code == 200:
                                    rule_content = rule_response.text
                                    rule_name = os.path.basename(rule_file)

                                    # Add the rule
                                    yara_service.add_rule(rule_name, rule_content, "community")
                                    import_count += 1
                                else:
                                    logger.warning(
                                        f"Failed to download rule {rule_file}: HTTP {rule_response.status_code}"
                                    )
                                    error_count += 1
                            except Exception as e:
                                logger.error(f"Error downloading rule {rule_file}: {str(e)}")
                                error_count += 1
                    else:
                        # No index.json, try a different approach
                        raise ValueError("Index not found")
                except Exception:  # noqa
                    # Try fetching individual .yar files from specific directories
                    directories = ["malware", "general", "packer", "persistence"]

                    for directory in directories:
                        try:
                            # This is a simple approach, in a real implementation, you'd need to
                            # get the directory listing from the GitHub API or parse HTML
                            common_rule_files = [
                                f"{directory}/apt.yar",
                                f"{directory}/generic.yar",
                                f"{directory}/capabilities.yar",
                                f"{directory}/indicators.yar",
                            ]

                            for rule_file in common_rule_files:
                                rule_url = f"{import_path}/{rule_file}"
                                try:
                                    rule_response = httpx.get(rule_url, follow_redirects=True)
                                    if rule_response.status_code == 200:
                                        rule_content = rule_response.text
                                        rule_name = os.path.basename(rule_file)

                                        # Add the rule
                                        yara_service.add_rule(rule_name, rule_content, "community")
                                        import_count += 1
                                except Exception:
                                    # Rule file not found, skip
                                    continue
                        except Exception as e:
                            logger.warning(f"Error processing directory {directory}: {str(e)}")
            else:
                # Local path
                import_path = Path(url)
                if not import_path.exists():
                    raise YaraError(f"Local path not found: {url}")

                # Process .yar files
                for rule_file in import_path.glob("**/*.yar"):
                    try:
                        with open(rule_file, "r", encoding="utf-8") as f:
                            rule_content = f.read()

                        rule_name = rule_file.name
                        yara_service.add_rule(rule_name, rule_content, "community")
                        import_count += 1
                    except FileNotFoundError:
                        logger.warning("Rule file not found: %s", rule_file)
                        error_count += 1
                    except ReadError as e:
                        logger.error("Error reading rule file: %s", str(e))
                        error_count += 1

        # Reload rules
        yara_service.load_rules()

        return {
            "success": True,
            "message": f"Imported {import_count} rules from {url} ({error_count} errors)",
            "import_count": import_count,
            "error_count": error_count,
        }
    except YaraError as e:
        logger.error(f"YARA error in import_threatflux_rules: {str(e)}")
        return {"success": False, "message": str(e)}
    except Exception as e:
        logger.error(f"Unexpected error in import_threatflux_rules: {str(e)}")
        return {
            "success": False,
            "message": f"Error importing rules: {str(e)}",
            "error": str(e),  # Include the original error message
        }
