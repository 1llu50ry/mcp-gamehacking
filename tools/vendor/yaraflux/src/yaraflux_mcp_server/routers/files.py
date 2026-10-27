"""Files router for YaraFlux MCP Server.

This module provides API endpoints for file management, including upload, download,
listing, and analysis of files.
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from yaraflux_mcp_server.auth import get_current_active_user, validate_admin
from yaraflux_mcp_server.models import (
    ErrorResponse,
    FileDeleteResponse,
    FileHexRequest,
    FileHexResponse,
    FileInfo,
    FileListResponse,
    FileString,
    FileStringsRequest,
    FileStringsResponse,
    FileUploadResponse,
    User,
)
from yaraflux_mcp_server.storage import StorageError, get_storage_client

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/files",
    tags=["files"],
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None),
    current_user: User = Depends(get_current_active_user),
):
    """Upload a file to the storage system."""
    try:
        # Read file content
        file_content = await file.read()

        # Parse metadata if provided
        file_metadata = {}
        if metadata:
            try:
                import json  # pylint: disable=import-outside-toplevel

                file_metadata = json.loads(metadata)
                if not isinstance(file_metadata, dict):
                    file_metadata = {}
            except Exception as e:
                logger.warning(f"Invalid metadata JSON: {str(e)}")

        # Add user information to metadata
        file_metadata["uploader"] = current_user.username

        # Save the file
        storage = get_storage_client()
        file_info = storage.save_file(file.filename, file_content, file_metadata)

        # Create response
        response = FileUploadResponse(
            file_info=FileInfo(
                file_id=UUID(file_info["file_id"]),
                file_name=file_info["file_name"],
                file_size=file_info["file_size"],
                file_hash=file_info["file_hash"],
                mime_type=file_info["mime_type"],
                uploaded_at=file_info["uploaded_at"],
                uploader=file_info["metadata"].get("uploader"),
                metadata=file_info["metadata"],
            )
        )

        return response
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error uploading file: {str(e)}"
        ) from e


@router.get("/info/{file_id}", response_model=FileInfo)
async def get_file_info(file_id: UUID):
    """Get detailed information about a file."""
    try:
        storage = get_storage_client()
        file_info = storage.get_file_info(str(file_id))

        # Create response
        response = FileInfo(
            file_id=UUID(file_info["file_id"]),
            file_name=file_info["file_name"],
            file_size=file_info["file_size"],
            file_hash=file_info["file_hash"],
            mime_type=file_info["mime_type"],
            uploaded_at=file_info["uploaded_at"],
            uploader=file_info["metadata"].get("uploader"),
            metadata=file_info["metadata"],
        )

        return response
    except StorageError as e:
        logger.error(f"File not found: {file_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {file_id}") from e
    except Exception as e:
        logger.error(f"Error getting file info: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error getting file info: {str(e)}"
        ) from e


@router.get("/download/{file_id}")
async def download_file(
    file_id: UUID,
    as_text: bool = Query(False, description="Return as text if possible"),
):
    """Download a file's content."""
    try:
        storage = get_storage_client()
        file_data = storage.get_file(str(file_id))
        file_info = storage.get_file_info(str(file_id))

        # Determine content type
        content_type = file_info.get("mime_type", "application/octet-stream")

        # If requested as text and mime type is textual, try to decode
        if as_text and (
            content_type.startswith("text/")
            or content_type in ["application/json", "application/xml", "application/javascript"]
        ):
            try:
                text_content = file_data.decode("utf-8")
                return Response(content=text_content, media_type=content_type)
            except UnicodeDecodeError:
                # If not valid UTF-8, fall back to binary
                pass

        # Return as binary
        return Response(
            content=file_data,
            media_type=content_type,
            headers={"Content-Disposition": f"attachment; filename=\"{file_info['file_name']}\""},
        )
    except StorageError as e:
        logger.error(f"File not found: {file_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {file_id}") from e
    except Exception as e:
        logger.error(f"Error downloading file: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error downloading file: {str(e)}"
        ) from e


@router.get("/list", response_model=FileListResponse)
async def list_files(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(100, ge=1, le=1000, description="Items per page"),
    sort_by: str = Query("uploaded_at", description="Field to sort by"),
    sort_desc: bool = Query(True, description="Sort in descending order"),
):
    """List files with pagination and sorting."""
    try:
        storage = get_storage_client()
        result = storage.list_files(page, page_size, sort_by, sort_desc)

        # Convert to response model
        files = []
        for file_info in result.get("files", []):
            files.append(
                FileInfo(
                    file_id=UUID(file_info["file_id"]),
                    file_name=file_info["file_name"],
                    file_size=file_info["file_size"],
                    file_hash=file_info["file_hash"],
                    mime_type=file_info["mime_type"],
                    uploaded_at=file_info["uploaded_at"],
                    uploader=file_info["metadata"].get("uploader"),
                    metadata=file_info["metadata"],
                )
            )

        response = FileListResponse(
            files=files,
            total=result.get("total", 0),
            page=result.get("page", page),
            page_size=result.get("page_size", page_size),
        )

        return response
    except Exception as e:
        logger.error(f"Error listing files: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error listing files: {str(e)}"
        ) from e


@router.delete("/{file_id}", response_model=FileDeleteResponse)
async def delete_file(file_id: UUID, current_user: User = Depends(validate_admin)):  # Ensure user is an admin
    """Delete a file from storage."""
    if not current_user.role.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    try:
        storage = get_storage_client()

        # Get file info first for the response
        try:
            file_info = storage.get_file_info(str(file_id))
            file_name = file_info.get("file_name", "Unknown file")
        except StorageError:
            # File not found, respond with error
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {file_id}") from None

        # Delete the file
        result = storage.delete_file(str(file_id))

        if result:
            return FileDeleteResponse(file_id=file_id, success=True, message=f"File {file_name} deleted successfully")
        return FileDeleteResponse(file_id=file_id, success=False, message="File could not be deleted")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error deleting file: {str(e)}"
        ) from e


@router.post("/strings/{file_id}", response_model=FileStringsResponse)
async def extract_strings(file_id: UUID, request: FileStringsRequest):
    """Extract strings from a file."""
    try:
        storage = get_storage_client()
        result = storage.extract_strings(
            str(file_id),
            min_length=request.min_length,
            include_unicode=request.include_unicode,
            include_ascii=request.include_ascii,
            limit=request.limit,
        )

        # Convert strings to response model format
        strings = []
        for string_info in result.get("strings", []):
            strings.append(
                FileString(
                    string=string_info["string"], offset=string_info["offset"], string_type=string_info["string_type"]
                )
            )

        response = FileStringsResponse(
            file_id=UUID(result["file_id"]),
            file_name=result["file_name"],
            strings=strings,
            total_strings=result["total_strings"],
            min_length=result["min_length"],
            include_unicode=result["include_unicode"],
            include_ascii=result["include_ascii"],
        )

        return response
    except StorageError as e:
        logger.error(f"File not found: {file_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {file_id}") from e
    except Exception as e:
        logger.error(f"Error extracting strings: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error extracting strings: {str(e)}"
        ) from e


@router.post("/hex/{file_id}", response_model=FileHexResponse)
async def get_hex_view(file_id: UUID, request: FileHexRequest):
    """Get hexadecimal view of file content."""
    try:
        storage = get_storage_client()
        result = storage.get_hex_view(
            str(file_id), offset=request.offset, length=request.length, bytes_per_line=request.bytes_per_line
        )

        response = FileHexResponse(
            file_id=UUID(result["file_id"]),
            file_name=result["file_name"],
            hex_content=result["hex_content"],
            offset=result["offset"],
            length=result["length"],
            total_size=result["total_size"],
            bytes_per_line=result["bytes_per_line"],
            include_ascii=result["include_ascii"],
        )

        return response
    except StorageError as error:
        logger.error(f"File not found: {file_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {file_id}") from error
    except Exception as e:
        logger.error(f"Error getting hex view: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error getting hex view: {str(e)}"
        ) from e
