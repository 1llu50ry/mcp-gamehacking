"""Local filesystem storage implementation for YaraFlux MCP Server.

This module provides a storage client that uses the local filesystem for storing
YARA rules, samples, scan results, and other files.
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
import shutil
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, BinaryIO, Dict, List, Optional, Tuple, Union
from uuid import uuid4

from yaraflux_mcp_server.storage.base import StorageClient, StorageError

# Handle conditional imports to avoid circular references
if TYPE_CHECKING:
    from yaraflux_mcp_server.config import settings
else:
    from yaraflux_mcp_server.config import settings

# Configure logging
logger = logging.getLogger(__name__)


class LocalStorageClient(StorageClient):
    """Storage client that uses local filesystem."""

    def __init__(self):
        """Initialize local storage client."""
        self.rules_dir = settings.YARA_RULES_DIR
        self.samples_dir = settings.YARA_SAMPLES_DIR
        self.results_dir = settings.YARA_RESULTS_DIR
        self.files_dir = settings.STORAGE_DIR / "files"
        self.files_meta_dir = settings.STORAGE_DIR / "files_meta"

        # Ensure directories exist
        os.makedirs(self.rules_dir, exist_ok=True)
        os.makedirs(self.samples_dir, exist_ok=True)
        os.makedirs(self.results_dir, exist_ok=True)
        os.makedirs(self.files_dir, exist_ok=True)
        os.makedirs(self.files_meta_dir, exist_ok=True)

        # Create source subdirectories for rules
        os.makedirs(self.rules_dir / "community", exist_ok=True)
        os.makedirs(self.rules_dir / "custom", exist_ok=True)

        logger.info(
            f"Initialized local storage: rules={self.rules_dir}, "
            f"samples={self.samples_dir}, results={self.results_dir}, "
            f"files={self.files_dir}"
        )

    # YARA Rule Management Methods

    def save_rule(self, rule_name: str, content: str, source: str = "custom") -> str:
        """Save a YARA rule to the local filesystem."""
        if not rule_name.endswith(".yar"):
            rule_name = f"{rule_name}.yar"

        source_dir = self.rules_dir / source
        os.makedirs(source_dir, exist_ok=True)

        rule_path = source_dir / rule_name
        try:
            with open(rule_path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.debug(f"Saved rule {rule_name} to {rule_path}")
            return str(rule_path)
        except (IOError, OSError) as e:
            logger.error(f"Failed to save rule {rule_name}: {str(e)}")
            raise StorageError(f"Failed to save rule: {str(e)}") from e

    def get_rule(self, rule_name: str, source: str = "custom") -> str:
        """Get a YARA rule from the local filesystem."""
        if not rule_name.endswith(".yar"):
            rule_name = f"{rule_name}.yar"

        rule_path = self.rules_dir / source / rule_name
        try:
            with open(rule_path, "r", encoding="utf-8") as f:
                content = f.read()
            return content
        except FileNotFoundError as e:
            logger.error(f"Rule not found: {rule_name} in {source}")
            raise StorageError(f"Rule not found: {rule_name}") from e
        except (IOError, OSError) as e:
            logger.error(f"Failed to read rule {rule_name}: {str(e)}")
            raise StorageError(f"Failed to read rule: {str(e)}") from e

    def delete_rule(self, rule_name: str, source: str = "custom") -> bool:
        """Delete a YARA rule from the local filesystem."""
        if not rule_name.endswith(".yar"):
            rule_name = f"{rule_name}.yar"

        rule_path = self.rules_dir / source / rule_name
        try:
            os.remove(rule_path)
            logger.debug(f"Deleted rule {rule_name} from {source}")
            return True
        except FileNotFoundError:
            logger.warning(f"Rule not found for deletion: {rule_name} in {source}")
            return False
        except (IOError, OSError) as e:
            logger.error(f"Failed to delete rule {rule_name}: {str(e)}")
            raise StorageError(f"Failed to delete rule: {str(e)}") from e

    def list_rules(self, source: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all YARA rules in the local filesystem."""
        rules = []

        sources = [source] if source else ["custom", "community"]
        for src in sources:
            source_dir = self.rules_dir / src
            if not source_dir.exists():
                continue

            for rule_path in source_dir.glob("*.yar"):
                try:
                    # Get basic file stats
                    stat = rule_path.stat()
                    created = datetime.fromtimestamp(stat.st_ctime)
                    modified = datetime.fromtimestamp(stat.st_mtime)

                    # Extract rule name from path
                    rule_name = rule_path.name

                    rules.append(
                        {
                            "name": rule_name,
                            "source": src,
                            "created": created.isoformat(),
                            "modified": modified.isoformat(),
                            "size": stat.st_size,
                        }
                    )
                except Exception as e:
                    logger.warning(f"Error processing rule {rule_path}: {str(e)}")

        return rules

    # Sample Management Methods

    def save_sample(self, filename: str, content: Union[bytes, BinaryIO]) -> Tuple[str, str]:
        """Save a sample file to the local filesystem."""
        # Calculate hash for the content
        if hasattr(content, "read"):
            # It's a file-like object, read it first
            content_bytes = content.read()
            if hasattr(content, "seek"):
                content.seek(0)  # Reset position for future reads
        else:
            # It's already bytes
            content_bytes = content

        file_hash = hashlib.sha256(content_bytes).hexdigest()

        # Use hash as directory name for deduplication
        hash_dir = self.samples_dir / file_hash[:2] / file_hash[2:4]
        os.makedirs(hash_dir, exist_ok=True)

        # Save the file with original name inside the hash directory
        file_path = hash_dir / filename
        try:
            with open(file_path, "wb") as f:
                if hasattr(content, "read"):
                    shutil.copyfileobj(content, f)
                else:
                    f.write(content_bytes)

            logger.debug(f"Saved sample {filename} to {file_path} (hash: {file_hash})")
            return str(file_path), file_hash
        except (IOError, OSError) as e:
            logger.error(f"Failed to save sample {filename}: {str(e)}")
            raise StorageError(f"Failed to save sample: {str(e)}") from e

    def get_sample(self, sample_id: str) -> bytes:
        """Get a sample from the local filesystem."""
        # Check if sample_id is a file path
        if os.path.exists(sample_id):
            try:
                with open(sample_id, "rb") as f:
                    return f.read()
            except (IOError, OSError) as e:
                raise StorageError(f"Failed to read sample: {str(e)}") from e

        # Check if sample_id is a hash
        if len(sample_id) == 64:  # SHA-256 hash length
            # Try to find the file in the hash directory structure
            hash_dir = self.samples_dir / sample_id[:2] / sample_id[2:4]
            if hash_dir.exists():
                # Look for any file in this directory
                files = list(hash_dir.iterdir())
                if files:
                    try:
                        with open(files[0], "rb") as f:
                            return f.read()
                    except (IOError, OSError) as e:
                        raise StorageError(f"Failed to read sample: {str(e)}") from e

        raise StorageError(f"Sample not found: {sample_id}")

    # Result Management Methods

    def save_result(self, result_id: str, content: Dict[str, Any]) -> str:
        """Save a scan result to the local filesystem."""
        # Ensure the result ID is valid for a filename
        safe_id = result_id.replace("/", "_").replace("\\", "_")

        result_path = self.results_dir / f"{safe_id}.json"
        try:
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(content, f, indent=2, default=str)

            logger.debug(f"Saved result {result_id} to {result_path}")
            return str(result_path)
        except (IOError, OSError) as e:
            logger.error(f"Failed to save result {result_id}: {str(e)}")
            raise StorageError(f"Failed to save result: {str(e)}") from e

    def get_result(self, result_id: str) -> Dict[str, Any]:
        """Get a scan result from the local filesystem."""
        # Check if result_id is a file path
        if os.path.exists(result_id) and result_id.endswith(".json"):
            result_path = result_id
        else:
            # Ensure the result ID is valid for a filename
            safe_id = result_id.replace("/", "_").replace("\\", "_")
            result_path = self.results_dir / f"{safe_id}.json"

        try:
            with open(result_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError as e:
            logger.error(f"Result not found: {result_id}")
            raise StorageError(f"Result not found: {result_id}") from e
        except (IOError, OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read result {result_id}: {str(e)}")
            raise StorageError(f"Failed to read result: {str(e)}") from e

    # File Management Methods

    def save_file(
        self, filename: str, content: Union[bytes, BinaryIO], metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Save a file to the local filesystem with metadata."""
        # Generate a unique file ID
        file_id = str(uuid4())

        # Create directory for this file
        file_dir = self.files_dir / file_id[:2] / file_id[2:4]
        os.makedirs(file_dir, exist_ok=True)

        # Calculate hash and size
        if hasattr(content, "read"):
            content_bytes = content.read()
            if hasattr(content, "seek"):
                content.seek(0)
        else:
            content_bytes = content

        file_hash = hashlib.sha256(content_bytes).hexdigest()
        file_size = len(content_bytes)

        # Determine mime type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        # Save the file
        file_path = file_dir / filename
        try:
            with open(file_path, "wb") as f:
                if hasattr(content, "read"):
                    shutil.copyfileobj(content, f)
                else:
                    f.write(content_bytes)
        except (IOError, OSError) as e:
            logger.error(f"Failed to save file {filename}: {str(e)}")
            raise StorageError(f"Failed to save file: {str(e)}") from e

        # Prepare file info
        file_info = {
            "file_id": file_id,
            "file_name": filename,
            "file_size": file_size,
            "file_hash": file_hash,
            "mime_type": mime_type,
            "uploaded_at": datetime.now(UTC).isoformat(),
            "metadata": metadata or {},
        }

        # Save metadata
        meta_path = self.files_meta_dir / f"{file_id}.json"
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(file_info, f, indent=2, default=str)
        except (IOError, OSError) as e:
            logger.error(f"Failed to save file metadata for {file_id}: {str(e)}")
            # If metadata save fails, try to delete the file
            try:
                os.remove(file_path)
            except FileNotFoundError as error:
                logger.warning(f"Failed to delete file {file_path} after metadata save error: {str(error)}")
            raise StorageError(f"Failed to save file metadata: {str(e)}") from e

        logger.debug(f"Saved file {filename} as {file_id}")
        return file_info

    def get_file(self, file_id: str) -> bytes:
        """Get a file from the local filesystem."""
        # Get file info first to find the path
        file_info = self.get_file_info(file_id)

        # Construct file path
        file_path = self.files_dir / file_id[:2] / file_id[2:4] / file_info["file_name"]

        try:
            with open(file_path, "rb") as f:
                return f.read()
        except FileNotFoundError as e:
            logger.error(f"File not found: {file_id}")
            raise StorageError(f"File not found: {file_id}") from e
        except (IOError, OSError) as e:
            logger.error(f"Failed to read file {file_id}: {str(e)}")
            raise StorageError(f"Failed to read file: {str(e)}") from e

    def list_files(
        self, page: int = 1, page_size: int = 100, sort_by: str = "uploaded_at", sort_desc: bool = True
    ) -> Dict[str, Any]:
        """List files in the local filesystem with pagination."""
        # Ensure page and page_size are valid
        page = max(1, page)
        page_size = max(1, min(1000, page_size))

        # Get all metadata files
        meta_files = list(self.files_meta_dir.glob("*.json"))

        # Read file info from each metadata file
        files_info = []
        for meta_path in meta_files:
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    file_info = json.load(f)
                    files_info.append(file_info)
            except (IOError, OSError, json.JSONDecodeError) as e:
                logger.warning(f"Failed to read metadata file {meta_path}: {str(e)}")
                continue

        # Sort files
        if files_info and sort_by in files_info[0]:
            files_info.sort(key=lambda x: x.get(sort_by, ""), reverse=sort_desc)

        # Calculate pagination
        total = len(files_info)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size

        # Apply pagination
        paginated_files = files_info[start_idx:end_idx] if start_idx < total else []

        return {"files": paginated_files, "total": total, "page": page, "page_size": page_size}

    def get_file_info(self, file_id: str) -> Dict[str, Any]:
        """Get file metadata from the local filesystem."""
        meta_path = self.files_meta_dir / f"{file_id}.json"

        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError as e:
            logger.error(f"File metadata not found: {file_id}")
            raise StorageError(f"File not found: {file_id}") from e
        except (IOError, OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to read file metadata {file_id}: {str(e)}")
            raise StorageError(f"Failed to read file metadata: {str(e)}") from e

    def delete_file(self, file_id: str) -> bool:
        """Delete a file from the local filesystem."""
        # Get file info first to find the path
        try:
            file_info = self.get_file_info(file_id)
        except StorageError:
            return False

        # Construct file path
        file_path = self.files_dir / file_id[:2] / file_id[2:4] / file_info["file_name"]
        meta_path = self.files_meta_dir / f"{file_id}.json"

        # Delete the file and metadata
        success = True
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except (IOError, OSError) as e:
            logger.error(f"Failed to delete file {file_id}: {str(e)}")
            success = False

        try:
            if os.path.exists(meta_path):
                os.remove(meta_path)
        except (IOError, OSError) as e:
            logger.error(f"Failed to delete file metadata {file_id}: {str(e)}")
            success = False

        return success

    def extract_strings(
        self,
        file_id: str,
        *,
        min_length: int = 4,
        include_unicode: bool = True,
        include_ascii: bool = True,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Extract strings from a file in the local filesystem."""
        # Get file content
        file_content = self.get_file(file_id)
        file_info = self.get_file_info(file_id)

        # Extract strings
        strings = []

        # Function to add a string if it meets the length requirement
        def add_string(string_value: str, offset: int, string_type: str):
            if len(string_value) >= min_length:
                strings.append({"string": string_value, "offset": offset, "string_type": string_type})

        # Extract ASCII strings
        if include_ascii:
            for match in re.finditer(b"[\x20-\x7e]{%d,}" % min_length, file_content):
                try:
                    string = match.group(0).decode("ascii")
                    add_string(string, match.start(), "ascii")
                except UnicodeDecodeError:
                    continue

        # Extract Unicode strings
        if include_unicode:
            # Look for UTF-16LE strings (common in Windows)
            for match in re.finditer(b"(?:[\x20-\x7e]\x00){%d,}" % min_length, file_content):
                try:
                    string = match.group(0).decode("utf-16le")
                    add_string(string, match.start(), "unicode")
                except UnicodeDecodeError:
                    continue

        # Apply limit if specified
        if limit is not None:
            strings = strings[:limit]

        return {
            "file_id": file_id,
            "file_name": file_info["file_name"],
            "strings": strings,
            "total_strings": len(strings),
            "min_length": min_length,
            "include_unicode": include_unicode,
            "include_ascii": include_ascii,
        }

    def get_hex_view(
        self, file_id: str, *, offset: int = 0, length: Optional[int] = None, bytes_per_line: int = 16
    ) -> Dict[str, Any]:
        """Get hexadecimal view of file content from the local filesystem."""
        # Get file content
        file_content = self.get_file(file_id)
        file_info = self.get_file_info(file_id)

        # Apply offset and length
        total_size = len(file_content)
        offset = max(0, min(offset, total_size))

        if length is None:
            # Default to 1024 bytes if not specified to avoid returning huge files
            length = min(1024, total_size - offset)
        else:
            length = min(length, total_size - offset)

        # Get the relevant portion of the file
        data = file_content[offset : offset + length]

        # Format as hex
        hex_lines = []
        ascii_lines = []

        for i in range(0, len(data), bytes_per_line):
            chunk = data[i : i + bytes_per_line]

            # Format hex
            hex_line = " ".join(f"{b:02x}" for b in chunk)
            hex_lines.append(hex_line)

            # Format ASCII (replacing non-printable characters with dots)
            ascii_line = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
            ascii_lines.append(ascii_line)

        # Combine hex and ASCII if requested
        lines = []
        for i, hex_line in enumerate(hex_lines):
            offset_str = f"{offset + i * bytes_per_line:08x}"
            if len(hex_line) < bytes_per_line * 3:  # Pad last line
                hex_line = hex_line.ljust(bytes_per_line * 3 - 1)

            line = f"{offset_str}  {hex_line}"
            if ascii_lines:
                line += f"  |{ascii_lines[i]}|"
            lines.append(line)

        hex_content = "\n".join(lines)

        return {
            "file_id": file_id,
            "file_name": file_info["file_name"],
            "hex_content": hex_content,
            "offset": offset,
            "length": length,
            "total_size": total_size,
            "bytes_per_line": bytes_per_line,
            "include_ascii": True,
        }
