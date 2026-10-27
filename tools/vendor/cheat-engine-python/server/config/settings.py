"""
Server Configuration Module
Handles server settings and configuration management
"""

import json
import os
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from pathlib import Path

logger = logging.getLogger(__name__)

@dataclass
class SecurityConfig:
    """Security-related configuration"""
    read_only_mode: bool = True
    enable_audit_log: bool = True
    audit_log_path: str = "audit.log"
    max_memory_read_size: int = 10 * 1024 * 1024  # 10MB
    require_elevation: bool = False
    enable_process_whitelist: bool = True
    whitelist_path: str = "process_whitelist.json"

@dataclass
class AnalysisConfig:
    """Analysis-related configuration"""
    enable_disassembly: bool = True
    enable_symbol_loading: bool = True
    symbol_cache_size: int = 1000
    max_scan_results: int = 10000
    scan_chunk_size: int = 1024 * 1024  # 1MB
    structure_analysis_depth: int = 3
    auto_detect_architecture: bool = True

@dataclass
class PerformanceConfig:
    """Performance-related configuration"""
    memory_cache_size: int = 100 * 1024 * 1024  # 100MB
    cache_timeout: float = 300.0  # 5 minutes
    max_concurrent_scans: int = 2
    scan_timeout: float = 30.0
    background_cleanup_interval: float = 60.0

@dataclass
class LoggingConfig:
    """Logging configuration"""
    log_level: str = "INFO"
    log_to_file: bool = True
    log_file_path: str = "mcp_cheat_engine.log"
    max_log_size: int = 10 * 1024 * 1024  # 10MB
    log_backup_count: int = 5
    enable_debug_logging: bool = False

class ServerConfig:
    """Main server configuration manager"""
    
    def __init__(self):
        self.security = SecurityConfig()
        self.analysis = AnalysisConfig()
        self.performance = PerformanceConfig()
        self.logging = LoggingConfig()
        self.config_file: Optional[str] = None
        self._loaded = False
    
    def load_config(self, config_path: Optional[str] = None):
        """Load configuration from file
        
        Args:
            config_path: Path to configuration file (optional)
        """
        if config_path and os.path.exists(config_path):
            self.config_file = config_path
            try:
                with open(config_path, 'r') as f:
                    config_data = json.load(f)
                
                self._apply_config_data(config_data)
                self._loaded = True
                logger.info(f"Configuration loaded from {config_path}")
                
            except Exception as e:
                logger.error(f"Failed to load config from {config_path}: {e}")
                self._load_defaults()
        else:
            logger.info("Using default configuration")
            self._load_defaults()
        
        # Validate configuration
        self._validate_config()
    
    def _load_defaults(self):
        """Load default configuration values"""
        # Defaults are already set in dataclass definitions
        self._loaded = True
    
    def _apply_config_data(self, config_data: Dict[str, Any]):
        """Apply configuration data from dictionary"""
        
        # Security settings
        if 'security' in config_data:
            sec_config = config_data['security']
            for key, value in sec_config.items():
                if hasattr(self.security, key):
                    setattr(self.security, key, value)
        
        # Analysis settings  
        if 'analysis' in config_data:
            analysis_config = config_data['analysis']
            for key, value in analysis_config.items():
                if hasattr(self.analysis, key):
                    setattr(self.analysis, key, value)
        
        # Performance settings
        if 'performance' in config_data:
            perf_config = config_data['performance']
            for key, value in perf_config.items():
                if hasattr(self.performance, key):
                    setattr(self.performance, key, value)
        
        # Logging settings
        if 'logging' in config_data:
            log_config = config_data['logging']
            for key, value in log_config.items():
                if hasattr(self.logging, key):
                    setattr(self.logging, key, value)
    
    def _validate_config(self):
        """Validate configuration values"""
        
        # Validate security settings
        if self.security.max_memory_read_size <= 0:
            logger.warning("Invalid max_memory_read_size, using default")
            self.security.max_memory_read_size = 10 * 1024 * 1024
        
        if self.security.max_memory_read_size > 1024 * 1024 * 1024:  # 1GB limit
            logger.warning("max_memory_read_size too large, capping at 1GB")
            self.security.max_memory_read_size = 1024 * 1024 * 1024
        
        # Validate analysis settings
        if self.analysis.max_scan_results <= 0:
            self.analysis.max_scan_results = 10000
        
        if self.analysis.scan_chunk_size <= 0:
            self.analysis.scan_chunk_size = 1024 * 1024
        
        # Validate performance settings
        if self.performance.cache_timeout <= 0:
            self.performance.cache_timeout = 300.0
        
        if self.performance.max_concurrent_scans <= 0:
            self.performance.max_concurrent_scans = 1
        
        # Validate logging settings
        valid_log_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if self.logging.log_level.upper() not in valid_log_levels:
            logger.warning(f"Invalid log level {self.logging.log_level}, using INFO")
            self.logging.log_level = "INFO"
    
    def save_config(self, config_path: Optional[str] = None):
        """Save current configuration to file
        
        Args:
            config_path: Path to save configuration (optional, uses loaded path if not specified)
        """
        save_path = config_path or self.config_file or "config.json"
        
        try:
            config_data = {
                'security': asdict(self.security),
                'analysis': asdict(self.analysis),
                'performance': asdict(self.performance),
                'logging': asdict(self.logging)
            }
            
            with open(save_path, 'w') as f:
                json.dump(config_data, f, indent=2)
            
            logger.info(f"Configuration saved to {save_path}")
            
        except Exception as e:
            logger.error(f"Failed to save config to {save_path}: {e}")
    
    def get_whitelist_path(self) -> str:
        """Get the process whitelist file path"""
        if os.path.isabs(self.security.whitelist_path):
            return self.security.whitelist_path
        else:
            # Relative to config file directory or current directory
            if self.config_file:
                config_dir = os.path.dirname(self.config_file)
                return os.path.join(config_dir, self.security.whitelist_path)
            else:
                return self.security.whitelist_path
    
    def get_audit_log_path(self) -> str:
        """Get the audit log file path"""
        if os.path.isabs(self.security.audit_log_path):
            return self.security.audit_log_path
        else:
            # Relative to config file directory or current directory
            if self.config_file:
                config_dir = os.path.dirname(self.config_file)
                return os.path.join(config_dir, self.security.audit_log_path)
            else:
                return self.security.audit_log_path
    
    def get_log_file_path(self) -> str:
        """Get the main log file path"""
        if os.path.isabs(self.logging.log_file_path):
            return self.logging.log_file_path
        else:
            # Relative to config file directory or current directory  
            if self.config_file:
                config_dir = os.path.dirname(self.config_file)
                return os.path.join(config_dir, self.logging.log_file_path)
            else:
                return self.logging.log_file_path
    
    def is_read_only_mode(self) -> bool:
        """Check if server is in read-only mode"""
        return self.security.read_only_mode
    
    def is_audit_enabled(self) -> bool:
        """Check if audit logging is enabled"""
        return self.security.enable_audit_log
    
    def get_max_memory_read_size(self) -> int:
        """Get maximum allowed memory read size"""
        return self.security.max_memory_read_size
    
    def is_process_whitelist_enabled(self) -> bool:
        """Check if process whitelist is enabled"""
        return self.security.enable_process_whitelist
    
    def create_default_config_file(self, path: str = "config.json"):
        """Create a default configuration file
        
        Args:
            path: Path where to create the config file
        """
        try:
            # Create default configuration
            default_config = {
                "security": {
                    "read_only_mode": True,
                    "enable_audit_log": True,
                    "audit_log_path": "audit.log",
                    "max_memory_read_size": 10485760,
                    "require_elevation": False,
                    "enable_process_whitelist": True,
                    "whitelist_path": "process_whitelist.json"
                },
                "analysis": {
                    "enable_disassembly": True,
                    "enable_symbol_loading": True,
                    "symbol_cache_size": 1000,
                    "max_scan_results": 10000,
                    "scan_chunk_size": 1048576,
                    "structure_analysis_depth": 3,
                    "auto_detect_architecture": True
                },
                "performance": {
                    "memory_cache_size": 104857600,
                    "cache_timeout": 300.0,
                    "max_concurrent_scans": 2,
                    "scan_timeout": 30.0,
                    "background_cleanup_interval": 60.0
                },
                "logging": {
                    "log_level": "INFO",
                    "log_to_file": True,
                    "log_file_path": "mcp_cheat_engine.log",
                    "max_log_size": 10485760,
                    "log_backup_count": 5,
                    "enable_debug_logging": False
                }
            }
            
            with open(path, 'w') as f:
                json.dump(default_config, f, indent=2)
            
            logger.info(f"Default configuration created at {path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to create default config at {path}: {e}")
            return False
    
    def update_setting(self, section: str, key: str, value: Any):
        """Update a specific configuration setting
        
        Args:
            section: Configuration section ('security', 'analysis', 'performance', 'logging')
            key: Setting key
            value: New value
        """
        try:
            if section == 'security' and hasattr(self.security, key):
                setattr(self.security, key, value)
            elif section == 'analysis' and hasattr(self.analysis, key):
                setattr(self.analysis, key, value)
            elif section == 'performance' and hasattr(self.performance, key):
                setattr(self.performance, key, value)
            elif section == 'logging' and hasattr(self.logging, key):
                setattr(self.logging, key, value)
            else:
                raise ValueError(f"Invalid section '{section}' or key '{key}'")
            
            # Re-validate after update
            self._validate_config()
            logger.info(f"Updated {section}.{key} = {value}")
            
        except Exception as e:
            logger.error(f"Failed to update setting {section}.{key}: {e}")
            raise
    
    def get_setting(self, section: str, key: str) -> Any:
        """Get a specific configuration setting
        
        Args:
            section: Configuration section
            key: Setting key
            
        Returns:
            Setting value
        """
        if section == 'security' and hasattr(self.security, key):
            return getattr(self.security, key)
        elif section == 'analysis' and hasattr(self.analysis, key):
            return getattr(self.analysis, key)
        elif section == 'performance' and hasattr(self.performance, key):
            return getattr(self.performance, key)
        elif section == 'logging' and hasattr(self.logging, key):
            return getattr(self.logging, key)
        else:
            raise ValueError(f"Invalid section '{section}' or key '{key}'")
    
    def get_all_settings(self) -> Dict[str, Dict[str, Any]]:
        """Get all configuration settings as a dictionary"""
        return {
            'security': asdict(self.security),
            'analysis': asdict(self.analysis), 
            'performance': asdict(self.performance),
            'logging': asdict(self.logging)
        }
