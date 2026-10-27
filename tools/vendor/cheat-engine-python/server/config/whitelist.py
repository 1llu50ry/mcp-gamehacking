"""
Process Whitelist Module
Manages allowed processes for security
"""

import json
import os
import logging
import re
from typing import List, Set, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

@dataclass
class WhitelistEntry:
    """Single whitelist entry"""
    process_name: str
    description: str
    category: str
    added_date: str
    enabled: bool = True
    exact_match: bool = True
    
    def matches(self, process_name: str) -> bool:
        """Check if this entry matches a process name"""
        if not self.enabled:
            return False
        
        if self.exact_match:
            return self.process_name.lower() == process_name.lower()
        else:
            # Pattern matching for non-exact matches
            try:
                pattern = self.process_name.replace('*', '.*').replace('?', '.')
                return bool(re.match(pattern, process_name, re.IGNORECASE))
            except re.error:
                # Fallback to exact match if regex is invalid
                return self.process_name.lower() == process_name.lower()

class ProcessWhitelist:
    """Manages process whitelist for security"""
    
    def __init__(self):
        self.entries: List[WhitelistEntry] = []
        self.enabled = True
        self.whitelist_file: Optional[str] = None
        self.last_modified = 0
        self._initialize_defaults()
    
    def _initialize_defaults(self):
        """Initialize with default safe processes"""
        default_entries = [
            # Development tools
            WhitelistEntry("notepad.exe", "Windows Notepad", "system", self._get_timestamp()),
            WhitelistEntry("code.exe", "Visual Studio Code", "development", self._get_timestamp()),
            WhitelistEntry("devenv.exe", "Visual Studio", "development", self._get_timestamp()),
            WhitelistEntry("windbg.exe", "Windows Debugger", "development", self._get_timestamp()),
            WhitelistEntry("x64dbg.exe", "x64dbg Debugger", "development", self._get_timestamp()),
            WhitelistEntry("ollydbg.exe", "OllyDbg Debugger", "development", self._get_timestamp()),
            
            # Common safe applications
            WhitelistEntry("calc.exe", "Windows Calculator", "system", self._get_timestamp()),
            WhitelistEntry("mspaint.exe", "Microsoft Paint", "system", self._get_timestamp()),
            WhitelistEntry("wordpad.exe", "Windows WordPad", "system", self._get_timestamp()),
            
            # Games (educational purposes)
            WhitelistEntry("minesweeper.exe", "Minesweeper", "game", self._get_timestamp()),
            WhitelistEntry("solitaire.exe", "Solitaire", "game", self._get_timestamp()),
            
            # Test applications
            WhitelistEntry("test*.exe", "Test Applications", "test", self._get_timestamp(), exact_match=False),
            WhitelistEntry("demo*.exe", "Demo Applications", "test", self._get_timestamp(), exact_match=False),
        ]
        
        self.entries = default_entries
    
    def _get_timestamp(self) -> str:
        """Get current timestamp as string"""
        return datetime.now().isoformat()
    
    def load_whitelist(self, whitelist_path: str):
        """Load whitelist from file
        
        Args:
            whitelist_path: Path to whitelist file
        """
        self.whitelist_file = whitelist_path
        
        if not os.path.exists(whitelist_path):
            logger.info(f"Whitelist file not found, creating default: {whitelist_path}")
            self.save_whitelist()
            return
        
        try:
            # Check if file was modified
            file_mtime = os.path.getmtime(whitelist_path)
            if file_mtime <= self.last_modified:
                return  # No changes
            
            with open(whitelist_path, 'r') as f:
                data = json.load(f)
            
            # Load configuration
            self.enabled = data.get('enabled', True)
            
            # Load entries
            entries_data = data.get('entries', [])
            self.entries = []
            
            for entry_data in entries_data:
                entry = WhitelistEntry(
                    process_name=entry_data['process_name'],
                    description=entry_data.get('description', ''),
                    category=entry_data.get('category', 'custom'),
                    added_date=entry_data.get('added_date', self._get_timestamp()),
                    enabled=entry_data.get('enabled', True),
                    exact_match=entry_data.get('exact_match', True)
                )
                self.entries.append(entry)
            
            self.last_modified = file_mtime
            logger.info(f"Loaded {len(self.entries)} whitelist entries from {whitelist_path}")
            
        except Exception as e:
            logger.error(f"Failed to load whitelist from {whitelist_path}: {e}")
            logger.info("Using default whitelist")
    
    def save_whitelist(self, whitelist_path: Optional[str] = None):
        """Save whitelist to file
        
        Args:
            whitelist_path: Path to save whitelist (optional)
        """
        save_path = whitelist_path or self.whitelist_file or "process_whitelist.json"
        
        try:
            data = {
                'enabled': self.enabled,
                'description': 'Process whitelist for MCP Cheat Engine Server',
                'last_updated': self._get_timestamp(),
                'entries': []
            }
            
            for entry in self.entries:
                entry_data = {
                    'process_name': entry.process_name,
                    'description': entry.description,
                    'category': entry.category,
                    'added_date': entry.added_date,
                    'enabled': entry.enabled,
                    'exact_match': entry.exact_match
                }
                data['entries'].append(entry_data)
            
            with open(save_path, 'w') as f:
                json.dump(data, f, indent=2)
            
            logger.info(f"Saved whitelist to {save_path}")
            
        except Exception as e:
            logger.error(f"Failed to save whitelist to {save_path}: {e}")
    
    def is_enabled(self) -> bool:
        """Check if whitelist is enabled"""
        return self.enabled
    
    def is_allowed(self, process_name: str) -> bool:
        """Check if a process is allowed by the whitelist
        
        Args:
            process_name: Name of the process to check
            
        Returns:
            True if allowed, False otherwise
        """
        if not self.enabled:
            return True  # If whitelist is disabled, allow all
        
        # Check against each whitelist entry
        for entry in self.entries:
            if entry.matches(process_name):
                return True
        
        return False
    
    def add_process(self, process_name: str, description: str = "", category: str = "custom") -> bool:
        """Add a process to the whitelist
        
        Args:
            process_name: Name of the process
            description: Description of the process
            category: Category for organization
            
        Returns:
            True if added, False if already exists
        """
        # Check if already exists
        for entry in self.entries:
            if entry.process_name.lower() == process_name.lower() and entry.exact_match:
                return False
        
        entry = WhitelistEntry(
            process_name=process_name,
            description=description or f"Custom entry for {process_name}",
            category=category,
            added_date=self._get_timestamp()
        )
        
        self.entries.append(entry)
        logger.info(f"Added process to whitelist: {process_name}")
        
        # Auto-save if we have a file path
        if self.whitelist_file:
            self.save_whitelist()
        
        return True
    
    def remove_process(self, process_name: str) -> bool:
        """Remove a process from the whitelist
        
        Args:
            process_name: Name of the process to remove
            
        Returns:
            True if removed, False if not found
        """
        original_count = len(self.entries)
        self.entries = [entry for entry in self.entries 
                       if entry.process_name.lower() != process_name.lower()]
        
        removed = len(self.entries) < original_count
        
        if removed:
            logger.info(f"Removed process from whitelist: {process_name}")
            # Auto-save if we have a file path
            if self.whitelist_file:
                self.save_whitelist()
        
        return removed
    
    def enable_process(self, process_name: str) -> bool:
        """Enable a process in the whitelist
        
        Args:
            process_name: Name of the process to enable
            
        Returns:
            True if found and enabled, False otherwise
        """
        for entry in self.entries:
            if entry.process_name.lower() == process_name.lower():
                entry.enabled = True
                logger.info(f"Enabled process in whitelist: {process_name}")
                return True
        
        return False
    
    def disable_process(self, process_name: str) -> bool:
        """Disable a process in the whitelist
        
        Args:
            process_name: Name of the process to disable
            
        Returns:
            True if found and disabled, False otherwise
        """
        for entry in self.entries:
            if entry.process_name.lower() == process_name.lower():
                entry.enabled = False
                logger.info(f"Disabled process in whitelist: {process_name}")
                return True
        
        return False
    
    def get_processes_by_category(self, category: str) -> List[WhitelistEntry]:
        """Get all processes in a specific category
        
        Args:
            category: Category to filter by
            
        Returns:
            List of whitelist entries in the category
        """
        return [entry for entry in self.entries if entry.category == category]
    
    def get_all_categories(self) -> Set[str]:
        """Get all categories in the whitelist"""
        return {entry.category for entry in self.entries}
    
    def get_enabled_processes(self) -> List[str]:
        """Get list of all enabled process names"""
        return [entry.process_name for entry in self.entries if entry.enabled]
    
    def get_whitelist_summary(self) -> Dict[str, Any]:
        """Get summary of whitelist status"""
        enabled_count = sum(1 for entry in self.entries if entry.enabled)
        categories = self.get_all_categories()
        
        return {
            'enabled': self.enabled,
            'total_entries': len(self.entries),
            'enabled_entries': enabled_count,
            'disabled_entries': len(self.entries) - enabled_count,
            'categories': sorted(list(categories)),
            'last_modified': self.last_modified
        }
    
    def import_processes(self, process_list: List[str], category: str = "imported"):
        """Import a list of processes to the whitelist
        
        Args:
            process_list: List of process names to import
            category: Category for the imported processes
        """
        added_count = 0
        
        for process_name in process_list:
            if self.add_process(process_name, f"Imported process", category):
                added_count += 1
        
        logger.info(f"Imported {added_count} processes to whitelist")
        return added_count
    
    def export_processes(self, category: Optional[str] = None) -> List[str]:
        """Export process names from the whitelist
        
        Args:
            category: Optional category filter
            
        Returns:
            List of process names
        """
        if category:
            return [entry.process_name for entry in self.entries 
                   if entry.category == category and entry.enabled]
        else:
            return [entry.process_name for entry in self.entries if entry.enabled]
    
    def validate_process_name(self, process_name: str) -> bool:
        """Validate a process name format
        
        Args:
            process_name: Process name to validate
            
        Returns:
            True if valid, False otherwise
        """
        if not process_name or not isinstance(process_name, str):
            return False
        
        # Check length
        if len(process_name) > 255:
            return False
        
        # Check for valid characters (allowing wildcards for pattern matching)
        valid_chars = re.compile(r'^[a-zA-Z0-9_\-\.\*\?]+\.exe$', re.IGNORECASE)
        return bool(valid_chars.match(process_name))
    
    def cleanup_entries(self):
        """Remove duplicate and invalid entries"""
        seen = set()
        valid_entries = []
        
        for entry in self.entries:
            key = (entry.process_name.lower(), entry.exact_match)
            if key not in seen and self.validate_process_name(entry.process_name):
                seen.add(key)
                valid_entries.append(entry)
        
        removed_count = len(self.entries) - len(valid_entries)
        self.entries = valid_entries
        
        if removed_count > 0:
            logger.info(f"Cleaned up {removed_count} invalid/duplicate whitelist entries")
        
        return removed_count
