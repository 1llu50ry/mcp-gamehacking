"""YARA rules router for YaraFlux MCP Server.

This module provides API routes for YARA rule management, including listing,
adding, updating, and deleting rules.
"""

import logging
from datetime import UTC, datetime
from typing import List, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)

from yaraflux_mcp_server.auth import get_current_active_user, validate_admin
from yaraflux_mcp_server.models import ErrorResponse, User, YaraRuleCreate, YaraRuleMetadata
from yaraflux_mcp_server.yara_service import YaraError, yara_service

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/rules",
    tags=["rules"],
    responses={
        401: {"description": "Unauthorized", "model": ErrorResponse},
        403: {"description": "Forbidden", "model": ErrorResponse},
        404: {"description": "Not Found", "model": ErrorResponse},
        422: {"description": "Validation Error", "model": ErrorResponse},
    },
)

# Import MCP tools with safeguards
try:
    from yaraflux_mcp_server.mcp_tools import import_threatflux_rules as import_rules_tool
    from yaraflux_mcp_server.mcp_tools import validate_yara_rule as validate_rule_tool
except Exception as e:
    logger.error(f"Error importing MCP tools: {str(e)}")

    # Create fallback functions
    def validate_rule_tool(content: str):
        try:
            # Create a temporary rule name for validation
            temp_rule_name = f"validate_{int(datetime.now(UTC).timestamp())}.yar"
            # Validate via direct service call
            yara_service.add_rule(temp_rule_name, content)
            yara_service.delete_rule(temp_rule_name)
            return {"valid": True, "message": "Rule is valid"}
        except Exception as error:
            return {"valid": False, "message": str(error)}

    def import_rules_tool(url: Optional[str] = None):
        # Simple import implementation
        url_msg = f" from {url}" if url else ""
        return {"success": False, "message": f"MCP tools not available for import{url_msg}"}


@router.get("/", response_model=List[YaraRuleMetadata])
async def list_rules(source: Optional[str] = None):
    """List all YARA rules.

    Args:
        source: Optional source filter ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        List of YARA rule metadata
    """
    try:
        rules = yara_service.list_rules(source)
        return rules
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error


@router.get("/{rule_name}", response_model=dict)
async def get_rule(
    rule_name: str,
    source: Optional[str] = "custom",
):
    """Get a YARA rule's content and metadata.

    Args:
        rule_name: Name of the rule
        source: Source of the rule ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        Rule content and metadata

    Raises:
        HTTPException: If rule not found
    """
    try:
        # Get rule content
        content = yara_service.get_rule(rule_name, source)

        # Find metadata in the list of rules
        metadata = None
        rules = yara_service.list_rules(source)
        for rule in rules:
            if rule.name == rule_name:
                metadata = rule
                break

        return {
            "name": rule_name,
            "source": source,
            "content": content,
            "metadata": metadata.model_dump() if metadata else {},
        }
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.get("/{rule_name}/raw")
async def get_rule_raw(
    rule_name: str,
    source: Optional[str] = "custom",
):
    """Get a YARA rule's raw content as plain text.

    Args:
        rule_name: Name of the rule
        source: Source of the rule ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        Plain text rule content

    Raises:
        HTTPException: If rule not found
    """
    try:
        # Get rule content
        content = yara_service.get_rule(rule_name, source)

        # Return as plain text
        return Response(content=content, media_type="text/plain")
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post("/", response_model=YaraRuleMetadata)
async def create_rule(rule: YaraRuleCreate, current_user: User = Depends(get_current_active_user)):
    """Create a new YARA rule.

    Args:
        rule: Rule to create
        current_user: Current authenticated user

    Returns:
        Metadata of the created rule

    Raises:
        HTTPException: If rule creation fails
    """
    try:
        metadata = yara_service.add_rule(rule.name, rule.content)
        logger.info(f"Rule {rule.name} created by {current_user.username}")
        return metadata
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.post("/upload", response_model=YaraRuleMetadata)
async def upload_rule(
    rule_file: UploadFile = File(...),
    source: str = Form("custom"),
    current_user: User = Depends(get_current_active_user),
):
    """Upload a YARA rule file.

    Args:
        rule_file: YARA rule file to upload
        source: Source of the rule ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        Metadata of the uploaded rule

    Raises:
        HTTPException: If file upload or rule creation fails
    """
    try:
        # Read file content
        content = await rule_file.read()

        # Get rule name from filename
        rule_name = rule_file.filename
        if not rule_name:
            raise ValueError("Filename is required")

        # Add rule
        metadata = yara_service.add_rule(rule_name, content.decode("utf-8"), source)
        logger.info(f"Rule {rule_name} uploaded by {current_user.username}")
        return metadata
    except YaraError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error


@router.put("/{rule_name}", response_model=YaraRuleMetadata)
async def update_rule(
    rule_name: str,
    content: str = Body(...),
    source: str = "custom",
    current_user: User = Depends(get_current_active_user),
):
    """Update an existing YARA rule.

    Args:
        rule_name: Name of the rule
        content: Updated rule content
        source: Source of the rule ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        Metadata of the updated rule

    Raises:
        HTTPException: If rule update fails
    """
    try:
        metadata = yara_service.update_rule(rule_name, content, source)
        logger.info(f"Rule {rule_name} updated by {current_user.username}")
        return metadata
    except YaraError as error:
        if "Rule not found" in str(error):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.put("/{rule_name}/plain", response_model=YaraRuleMetadata)
async def update_rule_plain(
    rule_name: str,
    source: str = "custom",
    content: str = Body(..., media_type="text/plain"),
    current_user: User = Depends(get_current_active_user),
):
    """Update an existing YARA rule using plain text.

    This endpoint accepts the YARA rule as plain text in the request body, making it
    easier to update YARA rules without having to escape special characters for JSON.

    Args:
        rule_name: Name of the rule
        source: Source of the rule ("custom" or "community")
        content: Updated YARA rule content as plain text
        current_user: Current authenticated user

    Returns:
        Metadata of the updated rule

    Raises:
        HTTPException: If rule update fails
    """
    try:
        metadata = yara_service.update_rule(rule_name, content, source)
        logger.info(f"Rule {rule_name} updated by {current_user.username} via plain text endpoint")
        return metadata
    except YaraError as error:
        if "Rule not found" in str(error):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.delete("/{rule_name}")
async def delete_rule(rule_name: str, source: str = "custom", current_user: User = Depends(get_current_active_user)):
    """Delete a YARA rule.

    Args:
        rule_name: Name of the rule
        source: Source of the rule ("custom" or "community")
        current_user: Current authenticated user

    Returns:
        Success message

    Raises:
        HTTPException: If rule deletion fails
    """
    try:
        result = yara_service.delete_rule(rule_name, source)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_name} not found in {source}",
            )

        logger.info(f"Rule {rule_name} deleted by {current_user.username}")

        return {"message": f"Rule {rule_name} deleted"}
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error


@router.post("/import")
async def import_rules(url: Optional[str] = None, current_user: User = Depends(validate_admin)):
    """Import ThreatFlux YARA rules from GitHub.

    Args:
        url: URL to the GitHub repository
        current_user: Current authenticated admin user

    Returns:
        Import result

    Raises:
        HTTPException: If import fails
    """
    try:
        result = import_rules_tool(url)

        if not result.get("success"):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get("message", "Import failed"),
            )

        logger.info(f"Rules imported from {url or 'ThreatFlux repository'} by {current_user.username}")

        return result
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error


@router.post("/validate")
async def validate_rule(request: Request):
    """Validate a YARA rule.

    This endpoint tries to handle both JSON and plain text inputs, with some format detection.
    For guaranteed reliability, use the /validate/plain endpoint for plain text YARA rules.

    Args:
        request: Request object containing the rule content
        current_user: Current authenticated user

    Returns:
        Validation result
    """
    try:
        # Read content as text
        content = await request.body()
        content_str = content.decode("utf-8")

        # Basic heuristic to detect YARA vs JSON:
        # If it starts with a curly brace and has line breaks, it might be a YARA rule
        # If it doesn't look like valid JSON, treat it as a YARA rule
        if not content_str.strip().startswith("rule"):
            try:
                # Try to parse as JSON
                import json  # pylint: disable=import-outside-toplevel

                json_content = json.loads(content_str)

                # If it parsed as JSON, check what kind of content it has
                if isinstance(json_content, str):
                    # It was a JSON string, use that as the content
                    content_str = json_content
                elif isinstance(json_content, dict) and "content" in json_content:
                    # It was a JSON object with a content field
                    content_str = json_content["content"]
            except json.JSONDecodeError:
                # It wasn't valid JSON, assume it's a YARA rule
                logger.error("Failed to decode JSON content from %s", content_str)

        # Use the validate_yara_rule MCP tool
        result = validate_rule_tool(content_str)
        return result
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)) from error


@router.post("/validate/plain")
async def validate_rule_plain(
    content: str = Body(..., media_type="text/plain"),
):
    """Validate a YARA rule submitted as plain text.

    This endpoint accepts the YARA rule as plain text without requiring JSON formatting.

    Args:
        content: YARA rule content to validate as plain text
        current_user: Current authenticated user

    Returns:
        Validation result
    """
    try:
        # Use the validate_yara_rule MCP tool
        result = validate_rule_tool(content)
        return result
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.post("/plain", response_model=YaraRuleMetadata)
async def create_rule_plain(
    rule_name: str,
    source: str = "custom",
    content: str = Body(..., media_type="text/plain"),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new YARA rule using plain text content.

    This endpoint accepts the YARA rule as plain text in the request body, making it
    easier to submit YARA rules without having to escape special characters for JSON.

    Args:
        rule_name: Name of the rule file (with or without .yar extension)
        source: Source of the rule ("custom" or "community")
        content: YARA rule content as plain text
        current_user: Current authenticated user

    Returns:
        Metadata of the created rule

    Raises:
        HTTPException: If rule creation fails
    """
    try:
        metadata = yara_service.add_rule(rule_name, content, source)
        logger.info(f"Rule {rule_name} created by {current_user.username} via plain text endpoint")
        return metadata
    except YaraError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
