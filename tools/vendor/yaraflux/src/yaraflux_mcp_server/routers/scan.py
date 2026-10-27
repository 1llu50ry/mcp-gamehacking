"""YARA scanning router for YaraFlux MCP Server.

This module provides API routes for YARA scanning, including scanning files
from URLs and retrieving scan results.
"""

import logging
import os
import tempfile
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from yaraflux_mcp_server.auth import get_current_active_user
from yaraflux_mcp_server.models import ErrorResponse, ScanRequest, ScanResult, User, YaraScanResult
from yaraflux_mcp_server.storage import get_storage_client
from yaraflux_mcp_server.yara_service import YaraError, yara_service

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/scan",
    tags=["scan"],
    responses={
        401: {"description": "Unauthorized", "model": ErrorResponse},
        403: {"description": "Forbidden", "model": ErrorResponse},
        404: {"description": "Not Found", "model": ErrorResponse},
        422: {"description": "Validation Error", "model": ErrorResponse},
    },
)


@router.post("/url", response_model=ScanResult)
async def scan_url(request: ScanRequest, current_user: User = Depends(get_current_active_user)):
    """Scan a file from a URL with YARA rules.

    Args:
        request: Scan request with URL and optional parameters
        current_user: Current authenticated user

    Returns:
        Scan result

    Raises:
        HTTPException: If scanning fails
    """
    if not request.url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL is required")

    try:
        # Scan the URL
        result = yara_service.fetch_and_scan(
            url=str(request.url), rule_names=request.rule_names, timeout=request.timeout
        )

        logger.info(f"Scanned URL {request.url} by {current_user.username}")

        return {"result": result}
    except YaraError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.post("/file", response_model=ScanResult)
async def scan_file(
    file: UploadFile = File(...),
    rule_names: Optional[str] = Form(None),
    timeout: Optional[int] = Form(None),
    current_user: User = Depends(get_current_active_user),
):
    """Scan an uploaded file with YARA rules.

    Args:
        file: File to scan
        rule_names: Optional comma-separated list of rule names
        timeout: Optional timeout in seconds
        current_user: Current authenticated user

    Returns:
        Scan result

    Raises:
        HTTPException: If scanning fails
    """
    try:
        # Parse rule_names if provided
        rules_list = None
        if rule_names:
            rules_list = [name.strip() for name in rule_names.split(",") if name.strip()]

        # Create a temporary file
        temp_file = None
        try:
            # Create a temporary file
            temp_file = tempfile.NamedTemporaryFile(delete=False)

            # Write uploaded file content to the temporary file
            content = await file.read()
            temp_file.write(content)
            temp_file.close()

            # Scan the file
            result = yara_service.match_file(file_path=temp_file.name, rule_names=rules_list, timeout=timeout)

            logger.info(f"Scanned file {file.filename} by {current_user.username}")

            return {"result": result}
        finally:
            # Clean up temporary file
            if temp_file:
                try:
                    os.unlink(temp_file.name)
                except (IOError, OSError):
                    pass
    except YaraError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


@router.get("/result/{scan_id}", response_model=ScanResult)
async def get_scan_result(scan_id: UUID):
    """Get a scan result by ID.

    Args:
        scan_id: ID of the scan result
        current_user: Current authenticated user

    Returns:
        Scan result

    Raises:
        HTTPException: If result not found
    """
    try:
        # Get the storage client
        storage = get_storage_client()

        # Get the result
        result_data = storage.get_result(str(scan_id))

        # Convert to YaraScanResult
        result = YaraScanResult(**result_data)

        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Scan result not found: {str(e)}") from e
