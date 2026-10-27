"""YARA integration service for YaraFlux MCP Server.

This module provides functionality for working with YARA rules, including:
- Rule compilation and validation
- Rule management (add, update, delete)
- File scanning with rules
- Integration with ThreatFlux YARA-Rules repository
"""

import hashlib
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, BinaryIO, Callable, Dict, List, Optional, Union
from urllib.parse import urlparse

import httpx
import yara

from yaraflux_mcp_server.config import settings
from yaraflux_mcp_server.models import YaraMatch, YaraRuleMetadata, YaraScanResult
from yaraflux_mcp_server.storage import StorageClient, StorageError, get_storage_client

# Configure logging
logger = logging.getLogger(__name__)


class YaraError(Exception):
    """Custom exception for YARA-related errors."""


class YaraService:
    """Service for YARA rule compilation, management, and scanning."""

    def __init__(self, storage_client: Optional[StorageClient] = None):
        """Initialize the YARA service.

        Args:
            storage_client: Optional storage client to use
        """
        self.storage = storage_client or get_storage_client()
        self._rules_cache: Dict[str, yara.Rules] = {}
        self._rule_include_callbacks: Dict[str, Callable[[str, str], bytes]] = {}

        # Initialize executor for scanning
        self._executor = ThreadPoolExecutor(max_workers=4)

        logger.info("YARA service initialized")

    def load_rules(self, include_default_rules: bool = True) -> None:
        """Load all YARA rules from storage.

        Args:
            include_default_rules: Whether to include default ThreatFlux rules
        """
        # Clear existing cache
        self._rules_cache.clear()

        # List all available rules
        rules_metadata = self.storage.list_rules()

        # Group rules by source
        rules_by_source: Dict[str, List[Dict[str, Any]]] = {}
        for rule in rules_metadata:
            source = rule.get("source", "custom")
            if source not in rules_by_source:
                rules_by_source[source] = []
            rules_by_source[source].append(rule)

        # First, load all rules individually (this populates include callbacks)
        for rule in rules_metadata:
            try:
                source = rule.get("source", "custom")
                rule_name = rule.get("name")

                # Skip loading community rules individually if they'll be loaded as a whole
                if include_default_rules and source == "community":
                    continue

                self._compile_rule(rule_name, source)
                logger.debug(f"Loaded rule: {rule_name} from {source}")
            except Exception as e:
                logger.warning(f"Failed to load rule {rule.get('name')}: {str(e)}")

        # Then, try to load community rules as a single ruleset if requested
        if include_default_rules and "community" in rules_by_source:
            try:
                self._compile_community_rules()
                logger.info("Loaded community rules as combined ruleset")
            except Exception as e:
                logger.warning(f"Failed to load community rules as combined ruleset: {str(e)}")

        logger.info(f"Loaded {len(self._rules_cache)} rule sets")

    def _compile_rule(self, rule_name: str, source: str = "custom") -> yara.Rules:
        """Compile a single YARA rule from storage.

        Args:
            rule_name: Name of the rule
            source: Source of the rule

        Returns:
            Compiled YARA rules object

        Raises:
            YaraError: If rule compilation fails
        """
        # Check for an existing compiled rule
        cache_key = f"{source}:{rule_name}"
        if cache_key in self._rules_cache:
            return self._rules_cache[cache_key]

        try:
            # Get the rule content from storage
            rule_content = self.storage.get_rule(rule_name, source)

            # Register an include callback for this rule
            self._register_include_callback(source, rule_name)

            # Compile the rule
            compiled_rule = yara.compile(
                source=rule_content,
                includes=True,
                include_callback=self._get_include_callback(source),
                error_on_warning=True,
            )

            # Cache the compiled rule
            self._rules_cache[cache_key] = compiled_rule

            return compiled_rule
        except yara.Error as e:
            logger.error(f"YARA compilation error for rule {rule_name}: {str(e)}")
            raise YaraError(f"Failed to compile rule {rule_name}: {str(e)}") from e
        except StorageError as e:
            logger.error(f"Storage error getting rule {rule_name}: {str(e)}")
            raise YaraError(f"Failed to load rule {rule_name}: {str(e)}") from e

    def _compile_community_rules(self) -> yara.Rules:
        """Compile all community YARA rules as a single ruleset.

        Returns:
            Compiled YARA rules object

        Raises:
            YaraError: If rule compilation fails
        """
        cache_key = "community:all"
        if cache_key in self._rules_cache:
            return self._rules_cache[cache_key]

        try:
            # Get all community rules
            rules_metadata = self.storage.list_rules("community")

            # Create a combined source with imports for all rules
            combined_source = ""
            for rule in rules_metadata:
                rule_name = rule.get("name")
                if not rule_name.endswith(".yar"):
                    continue
                combined_source += f'include "{rule_name}"\n'

            # Skip if no rules found
            if not combined_source:
                raise YaraError("No community rules found")

            # Register include callbacks for all community rules
            for rule in rules_metadata:
                self._register_include_callback("community", rule.get("name"))

            # Compile the combined ruleset
            compiled_rule = yara.compile(
                source=combined_source,
                includes=True,
                include_callback=self._get_include_callback("community"),
                error_on_warning=True,
            )

            # Cache the compiled rule
            self._rules_cache[cache_key] = compiled_rule

            return compiled_rule
        except yara.Error as e:
            logger.error(f"YARA compilation error for community rules: {str(e)}")
            raise YaraError(f"Failed to compile community rules: {str(e)}") from e
        except StorageError as e:
            logger.error(f"Storage error getting community rules: {str(e)}")
            raise YaraError(f"Failed to load community rules: {str(e)}") from e

    def _register_include_callback(self, source: str, rule_name: str) -> None:
        """Register an include callback for a rule.

        Args:
            source: Source of the rule
            rule_name: Name of the rule
        """
        callback_key = f"{source}:{rule_name}"

        # Define the include callback for this rule
        def include_callback(requested_filename: str, namespace: str) -> bytes:
            """Include callback for YARA rules.

            Args:
                requested_filename: Filename requested by the include directive
                namespace: Namespace for the included content

            Returns:
                Content of the included file

            Raises:
                yara.Error: If include file cannot be found
            """
            logger.debug(f"Include requested: {requested_filename} in namespace {namespace}")

            try:
                # Try to load from the same source
                include_content = self.storage.get_rule(requested_filename, source)
                return include_content.encode("utf-8")
            except StorageError:
                # If not found in the same source, try custom rules
                try:
                    if source != "custom":
                        include_content = self.storage.get_rule(requested_filename, "custom")
                        return include_content.encode("utf-8")
                except StorageError:
                    # If not found in custom rules either, try community rules
                    try:
                        if source != "community":
                            include_content = self.storage.get_rule(requested_filename, "community")
                            return include_content.encode("utf-8")
                    except StorageError as e:
                        # If not found anywhere, raise an error
                        logger.warning(f"Include file not found: {requested_filename}")
                        raise yara.Error(f"Include file not found: {requested_filename}") from e

            # If all attempts fail, raise an error
            raise yara.Error(f"Include file not found: {requested_filename}")

        # Register the callback
        self._rule_include_callbacks[callback_key] = include_callback

    def _get_include_callback(self, source: str) -> Callable[[str, str], bytes]:
        """Get the include callback for a source.

        Args:
            source: Source of the rules

        Returns:
            Include callback function
        """

        def combined_callback(requested_filename: str, namespace: str) -> bytes:
            """Combined include callback that tries all registered callbacks.

            Args:
                requested_filename: Filename requested by the include directive
                namespace: Namespace for the included content

            Returns:
                Content of the included file

            Raises:
                yara.Error: If include file cannot be found
            """
            # Try all callbacks associated with this source
            for key, callback in self._rule_include_callbacks.items():
                if key.startswith(f"{source}:"):
                    try:
                        return callback(requested_filename, namespace)
                    except yara.Error:
                        # Try the next callback
                        continue

            # If no callback succeeds, raise an error
            logger.warning(f"Include file not found by any callback: {requested_filename}")
            raise yara.Error(f"Include file not found: {requested_filename}")

        return combined_callback

    def add_rule(self, rule_name: str, content: str, source: str = "custom") -> YaraRuleMetadata:
        """Add a new YARA rule.

        Args:
            rule_name: Name of the rule
            content: YARA rule content
            source: Source of the rule

        Returns:
            Metadata for the added rule

        Raises:
            YaraError: If rule validation or compilation fails
        """
        # Ensure rule_name has .yar extension
        if not rule_name.endswith(".yar"):
            rule_name = f"{rule_name}.yar"

        # Validate the rule by compiling it
        try:
            # Try to compile without includes first for basic validation
            yara.compile(source=content, error_on_warning=True)

            # Then compile with includes to validate imports
            yara.compile(
                source=content,
                includes=True,
                include_callback=self._get_include_callback(source),
                error_on_warning=True,
            )
        except yara.Error as e:
            logger.error(f"YARA validation error for rule {rule_name}: {str(e)}")
            raise YaraError(f"Invalid YARA rule: {str(e)}") from e

        # Save the rule
        try:
            self.storage.save_rule(rule_name, content, source)
            logger.info(f"Added rule {rule_name} from {source}")

            # Compile and cache the rule
            compiled_rule = self._compile_rule(rule_name, source)
            if compiled_rule:
                cache_key = f"{source}:{rule_name}"
                self._rules_cache[cache_key] = compiled_rule
            # Return metadata
            return YaraRuleMetadata(name=rule_name, source=source, created=datetime.now(UTC), is_compiled=True)
        except StorageError as e:
            logger.error(f"Storage error saving rule {rule_name}: {str(e)}")
            raise YaraError(f"Failed to save rule: {str(e)}") from e

    def update_rule(self, rule_name: str, content: str, source: str = "custom") -> YaraRuleMetadata:
        """Update an existing YARA rule.

        Args:
            rule_name: Name of the rule
            content: Updated YARA rule content
            source: Source of the rule

        Returns:
            Metadata for the updated rule

        Raises:
            YaraError: If rule validation, compilation, or update fails
        """
        # Ensure rule exists
        try:
            self.storage.get_rule(rule_name, source)
        except StorageError as e:
            logger.error(f"Rule not found: {rule_name} from {source}")
            raise YaraError(f"Rule not found: {rule_name}") from e

        # Add the rule (this will validate and save it)
        metadata = self.add_rule(rule_name, content, source)

        # Set modified timestamp
        metadata.modified = datetime.now(UTC)

        # Clear cache for this rule
        cache_key = f"{source}:{rule_name}"
        if cache_key in self._rules_cache:
            del self._rules_cache[cache_key]

        # Also clear combined community rules cache if this was a community rule
        if source == "community" and "community:all" in self._rules_cache:
            del self._rules_cache["community:all"]

        return metadata

    def delete_rule(self, rule_name: str, source: str = "custom") -> bool:
        """Delete a YARA rule.

        Args:
            rule_name: Name of the rule
            source: Source of the rule

        Returns:
            True if rule was deleted, False if not found

        Raises:
            YaraError: If rule deletion fails
        """
        try:
            result = self.storage.delete_rule(rule_name, source)

            if result:
                # Clear cache for this rule
                cache_key = f"{source}:{rule_name}"
                if cache_key in self._rules_cache:
                    del self._rules_cache[cache_key]

                # Also clear combined community rules cache if this was a community rule
                if source == "community" and "community:all" in self._rules_cache:
                    del self._rules_cache["community:all"]

                logger.info(f"Deleted rule {rule_name} from {source}")

            return result
        except StorageError as e:
            logger.error(f"Storage error deleting rule {rule_name}: {str(e)}")
            raise YaraError(f"Failed to delete rule: {str(e)}") from e

    def get_rule(self, rule_name: str, source: str = "custom") -> str:
        """Get a YARA rule's content.

        Args:
            rule_name: Name of the rule
            source: Source of the rule

        Returns:
            Rule content

        Raises:
            YaraError: If rule not found
        """
        try:
            return self.storage.get_rule(rule_name, source)
        except StorageError as e:
            logger.error(f"Storage error getting rule {rule_name}: {str(e)}")
            raise YaraError(f"Failed to get rule: {str(e)}") from e

    def list_rules(self, source: Optional[str] = None) -> List[YaraRuleMetadata]:
        """List all YARA rules.

        Args:
            source: Optional filter by source

        Returns:
            List of rule metadata
        """
        try:
            rules_data = self.storage.list_rules(source)

            # Convert to YaraRuleMetadata objects
            rules_metadata = []
            for rule in rules_data:
                try:
                    # Check if rule is compiled
                    is_compiled = False
                    rule_source = rule.get("source", "custom")
                    rule_name = rule.get("name")
                    cache_key = f"{rule_source}:{rule_name}"

                    # Rule is compiled if it's in the cache
                    is_compiled = cache_key in self._rules_cache

                    # Rule is also compiled if it's a community rule and community:all is compiled
                    if rule_source == "community" and "community:all" in self._rules_cache:
                        is_compiled = True

                    # Create metadata object
                    created = rule.get("created")
                    if isinstance(created, str):
                        created = datetime.fromisoformat(created)
                    elif not isinstance(created, datetime):
                        created = datetime.now(UTC)

                    modified = rule.get("modified")
                    if isinstance(modified, str):
                        modified = datetime.fromisoformat(modified)

                    metadata = YaraRuleMetadata(
                        name=rule.get("name"),
                        source=rule.get("source", "custom"),
                        created=created,
                        modified=modified,
                        is_compiled=is_compiled,
                    )

                    rules_metadata.append(metadata)
                except Exception as e:
                    logger.warning(f"Error processing rule metadata: {str(e)}")

            return rules_metadata
        except StorageError as e:
            logger.error(f"Storage error listing rules: {str(e)}")
            raise YaraError(f"Failed to list rules: {str(e)}") from e

    def match_file(
        self,
        file_path: str,
        *,
        rule_names: Optional[List[str]] = None,
        sources: Optional[List[str]] = None,
        timeout: Optional[int] = None,
    ) -> YaraScanResult:
        """Match YARA rules against a file.

        Args:
            file_path: Path to the file to scan
            rule_names: Optional list of rule names to match (if None, match all)
            sources: Optional list of sources to match rules from (if None, match all)
            timeout: Optional timeout in seconds (if None, use default)

        Returns:
            Scan result

        Raises:
            YaraError: If scanning fails
        """
        # Resolve timeout
        if timeout is None:
            timeout = settings.YARA_SCAN_TIMEOUT

        # Get file information
        try:
            file_size = os.path.getsize(file_path)
            if file_size > settings.YARA_MAX_FILE_SIZE:
                logger.warning(f"File too large: {file_path} ({file_size} bytes)")
                raise YaraError(f"File too large: {file_size} bytes (max {settings.YARA_MAX_FILE_SIZE} bytes)")

            # Calculate file hash
            with open(file_path, "rb") as f:
                file_hash = hashlib.sha256(f.read()).hexdigest()

            # Get filename from path
            file_name = os.path.basename(file_path)

            # Prepare the scan
            scan_start = time.time()
            timeout_reached = False
            error = None

            # Collect rules to match
            rules_to_match = self._collect_rules(rule_names, sources)

            # Match rules against the file
            matches: List[yara.Match] = []
            for rule in rules_to_match:
                try:
                    # Match with timeout
                    rule_matches = rule.match(file_path, timeout=timeout)
                    matches.extend(rule_matches)
                except yara.TimeoutError:
                    logger.warning(f"YARA scan timeout for file {file_path}")
                    timeout_reached = True
                    break
                except yara.Error as e:
                    logger.error(f"YARA scan error for file {file_path}: {str(e)}")
                    error = str(e)
                    break

            # Calculate scan time
            scan_time = time.time() - scan_start

            # Process matches
            yara_matches = self._process_matches(matches)

            # Create scan result
            result = YaraScanResult(
                file_name=file_name,
                file_size=file_size,
                file_hash=file_hash,
                matches=yara_matches,
                scan_time=scan_time,
                timeout_reached=timeout_reached,
                error=error,
            )

            # Save the result
            result_id = result.scan_id
            self.storage.save_result(str(result_id), result.model_dump())

            return result
        except (IOError, OSError) as e:
            logger.error(f"File error scanning {file_path}: {str(e)}")
            raise YaraError(f"Failed to scan file: {str(e)}") from e

    def match_data(
        self,
        data: Union[bytes, BinaryIO],
        file_name: str,
        *,
        rule_names: Optional[List[str]] = None,
        sources: Optional[List[str]] = None,
        timeout: Optional[int] = None,
    ) -> YaraScanResult:
        """Match YARA rules against in-memory data.

        Args:
            data: Bytes or file-like object to scan
            file_name: Name of the file for reference
            rule_names: Optional list of rule names to match (if None, match all)
            sources: Optional list of sources to match rules from (if None, match all)
            timeout: Optional timeout in seconds (if None, use default)

        Returns:
            Scan result

        Raises:
            YaraError: If scanning fails
        """
        # Resolve timeout
        if timeout is None:
            timeout = settings.YARA_SCAN_TIMEOUT

        # Ensure data is bytes
        if hasattr(data, "read"):
            # It's a file-like object, read it into memory
            data_bytes = data.read()
            if hasattr(data, "seek"):
                data.seek(0)  # Reset for potential future reads
        else:
            data_bytes = data

        # Check file size
        file_size = len(data_bytes)
        if file_size > settings.YARA_MAX_FILE_SIZE:
            logger.warning(f"Data too large: {file_name} ({file_size} bytes)")
            raise YaraError(f"Data too large: {file_size} bytes (max {settings.YARA_MAX_FILE_SIZE} bytes)")

        # Calculate data hash
        file_hash = hashlib.sha256(data_bytes).hexdigest()

        try:
            # Prepare the scan
            scan_start = time.time()
            timeout_reached = False
            error = None

            # Collect rules to match
            rules_to_match = self._collect_rules(rule_names, sources)

            # Match rules against the data
            matches: List[yara.Match] = []
            for rule in rules_to_match:
                try:
                    # Match with timeout
                    rule_matches = rule.match(data=data_bytes, timeout=timeout)
                    matches.extend(rule_matches)
                except yara.TimeoutError:
                    logger.warning(f"YARA scan timeout for data {file_name}")
                    timeout_reached = True
                    break
                except yara.Error as e:
                    logger.error(f"YARA scan error for data {file_name}: {str(e)}")
                    error = str(e)
                    break

            # Calculate scan time
            scan_time = time.time() - scan_start

            # Process matches
            yara_matches = self._process_matches(matches)

            # Create scan result
            result = YaraScanResult(
                file_name=file_name,
                file_size=file_size,
                file_hash=file_hash,
                matches=yara_matches,
                scan_time=scan_time,
                timeout_reached=timeout_reached,
                error=error,
            )

            # Save the result
            result_id = result.scan_id
            self.storage.save_result(str(result_id), result.model_dump())

            return result
        except Exception as e:
            logger.error(f"Error scanning data {file_name}: {str(e)}")
            raise YaraError(f"Failed to scan data: {str(e)}") from e

    def fetch_and_scan(
        self,
        url: str,
        *,
        rule_names: Optional[List[str]] = None,
        sources: Optional[List[str]] = None,
        timeout: Optional[int] = None,
        download_timeout: int = 30,
    ) -> YaraScanResult:
        """Fetch a file from a URL and scan it with YARA rules.

        Args:
            url: URL to fetch
            rule_names: Optional list of rule names to match (if None, match all)
            sources: Optional list of sources to match rules from (if None, match all)
            timeout: Optional timeout in seconds for YARA scan (if None, use default)
            download_timeout: Timeout in seconds for downloading the file

        Returns:
            Scan result

        Raises:
            YaraError: If fetching or scanning fails
        """
        # Parse URL to get filename
        parsed_url = urlparse(url)
        file_name = os.path.basename(parsed_url.path)
        if not file_name:
            file_name = "downloaded_file"

        # Create a temporary file
        temp_file = None
        try:
            # Download the file
            logger.info(f"Fetching file from URL: {url}")
            with httpx.Client(timeout=download_timeout) as client:
                response = client.get(url, follow_redirects=True)
                response.raise_for_status()  # Raise exception for error status codes

                # Get content
                content = response.content

                # Check file size
                file_size = len(content)
                if file_size > settings.YARA_MAX_FILE_SIZE:
                    logger.warning(f"Downloaded file too large: {file_name} ({file_size} bytes)")
                    raise YaraError(
                        f"Downloaded file too large: {file_size} bytes (max {settings.YARA_MAX_FILE_SIZE} bytes)"
                    ) from None

                # Try to get a better filename from Content-Disposition header if available
                content_disposition = response.headers.get("Content-Disposition")
                if content_disposition and "filename=" in content_disposition:
                    import re  # pylint: disable=import-outside-toplevel

                    filename_match = re.search(r'filename="?([^";]+)"?', content_disposition)
                    if filename_match:
                        file_name = filename_match.group(1)

                # Save to storage
                file_path, file_hash = self.storage.save_sample(filename=file_name, content=content)
                logger.info("Downloaded file saved to storage with hash: %s", file_hash)
                # Scan the file
                if os.path.exists(file_path):
                    # If file_path is a real file on disk, use match_file
                    return self.match_file(file_path, rule_names=rule_names, sources=sources, timeout=timeout)
                # Otherwise, use match_data
                return self.match_data(
                    data=content, file_name=file_name, rule_names=rule_names, sources=sources, timeout=timeout
                )
        except httpx.RequestError as e:
            logger.error(f"HTTP request error fetching {url}: {str(e)}")
            raise YaraError(f"Failed to fetch file: {str(e)}") from e
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error fetching {url}: {e.response.status_code}")
            raise YaraError(f"Failed to fetch file: HTTP {e.response.status_code}") from e
        finally:
            # Clean up temporary file if created
            if temp_file:
                try:
                    temp_file.close()
                    os.unlink(temp_file.name)
                except (IOError, OSError):
                    pass

    def _collect_rules(
        self, rule_names: Optional[List[str]] = None, sources: Optional[List[str]] = None
    ) -> List[yara.Rules]:
        """Collect YARA rules to match.

        Args:
            rule_names: Optional list of rule names to match (if None, match all)
            sources: Optional list of sources to match rules from (if None, match all)

        Returns:
            List of YARA rules objects

        Raises:
            YaraError: If no rules are found
        """
        rules_to_match: List[yara.Rules] = []

        # If specific rules are requested
        if rule_names:
            for rule_name in rule_names:
                # Try to find the rule in all sources if sources not specified
                if not sources:
                    available_sources = ["custom", "community"]
                else:
                    available_sources = sources

                found = False
                for source in available_sources:
                    try:
                        rule = self._compile_rule(rule_name, source)
                        rules_to_match.append(rule)
                        found = True
                        break
                    except YaraError:
                        continue

                if not found:
                    logger.warning(f"Rule not found: {rule_name}")

            if not rules_to_match:
                raise YaraError("No requested rules found")
        else:
            # No specific rules requested, use all available rules

            # Check if we have a community:all ruleset
            if not sources or "community" in sources:
                try:
                    community_rules = self._compile_community_rules()
                    rules_to_match.append(community_rules)
                except YaraError:
                    # Community rules not available as combined set, try individual rules
                    if not sources:
                        sources = ["custom", "community"]

                    # For each source, get all rules
                    for source in sources:
                        try:
                            rules = self.list_rules(source)
                            for rule in rules:
                                try:
                                    compiled_rule = self._compile_rule(rule.name, rule.source)
                                    rules_to_match.append(compiled_rule)
                                except YaraError:
                                    continue
                        except YaraError:
                            continue
            else:
                # Use only specified sources
                for source in sources:
                    try:
                        rules = self.list_rules(source)
                        for rule in rules:
                            try:
                                compiled_rule = self._compile_rule(rule.name, rule.source)
                                rules_to_match.append(compiled_rule)
                            except YaraError:
                                continue
                    except YaraError:
                        continue

        # Ensure we have at least one rule
        if not rules_to_match:
            raise YaraError("No YARA rules available")

        return rules_to_match

    def _process_matches(self, matches: List[yara.Match]) -> List[YaraMatch]:
        """Process YARA matches into YaraMatch objects.

        Args:
            matches: List of YARA match objects

        Returns:
            List of YaraMatch objects
        """
        result: List[YaraMatch] = []

        for match in matches:
            try:
                # Extract rule name
                rule_name = match.rule

                # Extract namespace
                namespace = match.namespace

                # Extract tags
                tags = match.tags

                # Extract metadata
                meta = match.meta

                # Create empty strings list - we're skipping string processing due to compatibility issues
                strings = []

                # Create YaraMatch object
                yara_match = YaraMatch(rule=rule_name, namespace=namespace, tags=tags, meta=meta, strings=strings)

                result.append(yara_match)
            except Exception as e:
                logger.error(f"Error processing YARA match: {str(e)}")
                continue

        return result


# Create a singleton instance
yara_service = YaraService()
