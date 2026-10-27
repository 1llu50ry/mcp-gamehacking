#!/usr/bin/env python3

import os
import sys
import argparse
import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional

from mcp.server.fastmcp import FastMCP
from mcp.types import Tool

# Import our modules
from process.manager import ProcessManager
from process.launcher import ApplicationLauncher
from utils.validators import validate_address, validate_size
from utils.formatters import format_process_info
from config.settings import ServerConfig
from config.whitelist import ProcessWhitelist
from cheatengine.table_parser import CheatTableParser
from cheatengine.ce_bridge import CheatEngineBridge
import glob

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import automation tools for integration
try:
    import sys
    parent_dir = Path(__file__).parent.parent
    if str(parent_dir) not in sys.path:
        sys.path.insert(0, str(parent_dir))
    from automation_tools import register_automation_tools
    from gui_automation.tools.mcp_tools import ALL_PYAUTOGUI_TOOLS, PyAutoGUIToolHandler
    from window_automation.tools.mcp_tools import ALL_PYWINAUTO_TOOLS, PyWinAutoToolHandler
    AUTOMATION_AVAILABLE = True
    PYAUTOGUI_AVAILABLE = True
    PYWINAUTO_AVAILABLE = True
    logger.info("Automation tools, PyAutoGUI, and PyWinAuto modules loaded successfully")
except ImportError as e:
    AUTOMATION_AVAILABLE = False
    PYAUTOGUI_AVAILABLE = False
    PYWINAUTO_AVAILABLE = False
    logger.warning(f"Automation tools not available: {e}")
except ImportError as e:
    logger.warning(f"Automation tools not available: {e}")
    AUTOMATION_AVAILABLE = False

# Parse command line arguments
parser = argparse.ArgumentParser(description="MCP Cheat Engine Server")
parser.add_argument(
    "--config", 
    default="config.json", 
    help="Configuration file path"
)
parser.add_argument("--debug", action="store_true", help="Enable debug mode")
parser.add_argument("--read-only", action="store_true", help="Enable read-only mode")
args = parser.parse_args()

# Initialize server
mcp = FastMCP("cheat-engine-server")

# Global state
server_config = ServerConfig()
process_manager = ProcessManager()
process_whitelist = ProcessWhitelist()

# Initialize application launcher
app_launcher = None

# Initialize PyAutoGUI handler
pyautogui_handler = None
if PYAUTOGUI_AVAILABLE:
    try:
        pyautogui_handler = PyAutoGUIToolHandler()
        logger.info("PyAutoGUI handler initialized successfully")
    except Exception as e:
        logger.warning(f"Failed to initialize PyAutoGUI handler: {e}")
        PYAUTOGUI_AVAILABLE = False

# Initialize PyWinAuto handler
pywinauto_handler = None
if PYWINAUTO_AVAILABLE:
    try:
        pywinauto_handler = PyWinAutoToolHandler()
        logger.info("PyWinAuto handler initialized successfully")
    except Exception as e:
        logger.warning(f"Failed to initialize PyWinAuto handler: {e}")
        PYWINAUTO_AVAILABLE = False

# Current attached process
current_process = None

# Initialize cheat table parser
cheat_table_parser = CheatTableParser()

# Initialize Cheat Engine bridge
cheat_engine_bridge = CheatEngineBridge()

# Default cheat tables directory
DEFAULT_CHEAT_TABLES_DIR = r"C:\Users\benam\Documents\My Cheat Tables"


@mcp.tool()
def list_processes() -> str:
    """Enumerate running processes available for attachment"""
    try:
        logger.info("Listing available processes")
        processes = process_manager.list_processes()
        
        # Filter by whitelist if configured
        if process_whitelist.is_enabled():
            processes = [p for p in processes if process_whitelist.is_allowed(p['name'])]
        
        if not processes:
            return "No processes available or accessible"
        
        return format_process_info(processes)
    
    except Exception as e:
        logger.error(f"Error listing processes: {e}")
        return f"Error listing processes: {str(e)}"


@mcp.tool()
def attach_to_process(identifier: str, access_level: str = "read") -> str:
    """Attach debugger to specified process
    
    Args:
        identifier: Process name or PID
        access_level: "read" for read-only access, "debug" for full debug access
    """
    global current_process
    
    try:
        logger.info(f"Attempting to attach to process: {identifier}")
        
        # Validate access level
        if access_level not in ["read", "debug"]:
            return "Error: access_level must be 'read' or 'debug'"
        
        # Force read-only mode if server is configured for it
        if args.read_only and access_level == "debug":
            access_level = "read"
            logger.warning("Forced read-only mode, downgrading access level")
        
        # Check whitelist
        if process_whitelist.is_enabled():
            if isinstance(identifier, str) and not identifier.isdigit():
                if not process_whitelist.is_allowed(identifier):
                    return f"Error: Process '{identifier}' not in whitelist"
        
        # Attempt attachment
        process_info = process_manager.attach_process(identifier, access_level)
        current_process = process_info
        
        logger.info(f"Successfully attached to process {process_info['pid']} ({process_info['name']})")
        
        return f"Successfully attached to process:\n{format_process_info([process_info])}"
    
    except Exception as e:
        logger.error(f"Error attaching to process: {e}")
        return f"Error attaching to process: {str(e)}"


@mcp.tool()
def get_process_info() -> str:
    """Get detailed information about currently attached process"""
    try:
        if not current_process:
            return "No process currently attached"
        
        logger.info(f"Getting process info for PID {current_process['pid']}")
        
        # Get detailed process information
        detailed_info = process_manager.get_detailed_info(current_process['pid'])
        
        return format_process_info([detailed_info], detailed=True)
    
    except Exception as e:
        logger.error(f"Error getting process info: {e}")
        return f"Error getting process info: {str(e)}"


@mcp.tool()
def detach_process() -> str:
    """Safely detach from current process"""
    global current_process
    
    try:
        if not current_process:
            return "No process currently attached"
        
        logger.info(f"Detaching from process {current_process['pid']}")
        
        process_manager.detach_process()
        current_process = None
        
        return "Successfully detached from process"
    
    except Exception as e:
        logger.error(f"Error detaching from process: {e}")
        return f"Error detaching from process: {str(e)}"


# ==========================================
# APPLICATION LAUNCHER TOOLS
# ==========================================

@mcp.tool()
def get_whitelisted_applications() -> str:
    """Get list of applications that can be launched"""
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        applications = app_launcher.get_whitelisted_applications()
        
        if not applications:
            return "No whitelisted applications found"
        
        result = "Whitelisted Applications:\\n"
        result += "=" * 40 + "\\n"
        
        # Group by category
        categories = {}
        for app in applications:
            category = app['category']
            if category not in categories:
                categories[category] = []
            categories[category].append(app)
        
        for category, apps in sorted(categories.items()):
            result += f"\\n{category.upper()}:\\n"
            for app in apps:
                result += f"  • {app['process_name']} - {app['description']}\\n"
                if app['executable_path']:
                    result += f"    Path: {app['executable_path']}\\n"
                else:
                    result += f"    Path: Not found or pattern match\\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error getting whitelisted applications: {e}")
        return f"Error getting whitelisted applications: {str(e)}"


@mcp.tool()
def launch_application(process_name: str, arguments: str = "", working_directory: str = "") -> str:
    """Launch a whitelisted application
    
    Args:
        process_name: Name of the process to launch (e.g., notepad.exe)
        arguments: Optional command line arguments (space-separated)
        working_directory: Optional working directory (empty for default)
    """
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        # Parse arguments
        arg_list = arguments.split() if arguments.strip() else None
        work_dir = working_directory.strip() if working_directory.strip() else None
        
        logger.info(f"Launching application: {process_name}")
        
        success, message, pid = app_launcher.launch_application(
            process_name, arg_list, work_dir
        )
        
        if success:
            logger.info(f"Successfully launched {process_name} with PID {pid}")
            return f"SUCCESS: {message}"
        else:
            logger.error(f"Failed to launch {process_name}: {message}")
            return f"ERROR: {message}"
            
    except Exception as e:
        logger.error(f"Error launching application: {e}")
        return f"Error launching application: {str(e)}"


@mcp.tool()
def terminate_application(pid: int, force: bool = False) -> str:
    """Terminate a running application
    
    Args:
        pid: Process ID to terminate
        force: Whether to force kill (True) or graceful terminate (False)
    """
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        logger.info(f"Terminating application PID {pid}, force={force}")
        
        success, message = app_launcher.terminate_application(pid, force)
        
        if success:
            logger.info(f"Successfully terminated PID {pid}")
            return f"SUCCESS: {message}"
        else:
            logger.error(f"Failed to terminate PID {pid}: {message}")
            return f"ERROR: {message}"
            
    except Exception as e:
        logger.error(f"Error terminating application: {e}")
        return f"Error terminating application: {str(e)}"


@mcp.tool()
def get_launched_applications() -> str:
    """Get list of applications launched in this session"""
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        applications = app_launcher.get_launched_applications()
        
        if not applications:
            return "No applications launched in this session"
        
        result = "Launched Applications:\\n"
        result += "=" * 40 + "\\n"
        
        for app in applications:
            result += f"\\nPID: {app['pid']}\\n"
            result += f"Name: {app['process_name']}\\n"
            result += f"Status: {app['status']}\\n"
            result += f"Launch Time: {app['launch_time']}\\n"
            result += f"Command: {' '.join(app['command_line'])}\\n"
            result += f"Working Dir: {app['working_directory']}\\n"
            result += "-" * 30 + "\\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error getting launched applications: {e}")
        return f"Error getting launched applications: {str(e)}"


@mcp.tool()
def get_application_info(pid: int) -> str:
    """Get detailed information about a specific launched application
    
    Args:
        pid: Process ID to get information for
    """
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        app_info = app_launcher.get_application_by_pid(pid)
        
        if not app_info:
            return f"No information found for PID {pid} (not launched by this session)"
        
        result = f"Application Information for PID {pid}:\\n"
        result += "=" * 40 + "\\n"
        result += f"Process Name: {app_info['process_name']}\\n"
        result += f"Executable Path: {app_info['exe_path']}\\n"
        result += f"Status: {app_info['status']}\\n"
        result += f"Launch Time: {app_info['launch_time']}\\n"
        result += f"Command Line: {' '.join(app_info['command_line'])}\\n"
        result += f"Working Directory: {app_info['working_directory']}\\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error getting application info: {e}")
        return f"Error getting application info: {str(e)}"


@mcp.tool()
def cleanup_terminated_applications() -> str:
    """Remove terminated applications from tracking"""
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        removed_count = app_launcher.cleanup_terminated_applications()
        
        if removed_count > 0:
            return f"Cleaned up {removed_count} terminated application(s)"
        else:
            return "No terminated applications to clean up"
            
    except Exception as e:
        logger.error(f"Error cleaning up applications: {e}")
        return f"Error cleaning up applications: {str(e)}"


@mcp.tool()
def terminate_all_launched_applications(force: bool = False) -> str:
    """Terminate all applications launched in this session
    
    Args:
        force: Whether to force kill all applications
    """
    global app_launcher
    
    try:
        if not app_launcher:
            return "Application launcher not initialized"
        
        logger.info(f"Terminating all launched applications, force={force}")
        
        results = app_launcher.terminate_all_launched_applications(force)
        
        result = f"Bulk Termination Results:\\n"
        result += f"Terminated: {results['terminated']}\\n"
        result += f"Failed: {results['failed']}\\n"
        result += f"\\nDetails:\\n"
        for message in results['messages']:
            result += f"  • {message}\\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error terminating all applications: {e}")
        return f"Error terminating all applications: {str(e)}"


# ==========================================
# END APPLICATION LAUNCHER TOOLS
# ==========================================


# ==========================================
# CHEAT TABLE FILESYSTEM TOOLS
# ==========================================

@mcp.tool()
def list_cheat_tables(directory_path: str = "") -> str:
    """List all .CT (Cheat Table) files in the specified directory
    
    Args:
        directory_path: Directory to search for .CT files (defaults to My Cheat Tables)
        
    Returns:
        Formatted list of available cheat table files
    """
    try:
        # Use default directory if not specified
        search_dir = directory_path.strip() if directory_path.strip() else DEFAULT_CHEAT_TABLES_DIR
        
        logger.info(f"Listing cheat tables in directory: {search_dir}")
        
        # Check if directory exists
        if not Path(search_dir).exists():
            return f"Directory not found: {search_dir}"
        
        # Search for .CT files
        ct_files = set()  # Use set to avoid duplicates
        for pattern in ["*.CT", "*.ct"]:
            ct_files.update(glob.glob(os.path.join(search_dir, pattern)))
        
        ct_files = list(ct_files)  # Convert back to list
        
        if not ct_files:
            return f"No cheat table (.CT) files found in: {search_dir}"
        
        # Format the results
        result = f"Cheat Table Files in '{search_dir}':\n"
        result += "=" * 50 + "\n\n"
        
        for i, file_path in enumerate(sorted(ct_files), 1):
            file_name = os.path.basename(file_path)
            file_size = os.path.getsize(file_path)
            mod_time = os.path.getmtime(file_path)
            mod_date = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mod_time))
            
            result += f"{i}. {file_name}\n"
            result += f"   Path: {file_path}\n"
            result += f"   Size: {file_size:,} bytes\n"
            result += f"   Modified: {mod_date}\n\n"
        
        result += f"Total: {len(ct_files)} cheat table file(s)"
        return result
        
    except Exception as e:
        logger.error(f"Error listing cheat tables: {e}")
        return f"Error listing cheat tables: {str(e)}"

@mcp.tool()
def load_cheat_table(file_path: str) -> str:
    """Load and parse a .CT (Cheat Table) file to extract address information
    
    Args:
        file_path: Full path to the .CT file to load
        
    Returns:
        Formatted address list from the cheat table
    """
    try:
        logger.info(f"Loading cheat table: {file_path}")
        
        # Check if file exists
        if not Path(file_path).exists():
            return f"Cheat table file not found: {file_path}"
        
        # Parse the cheat table
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list:
            return f"Failed to parse cheat table: {file_path}"
        
        if not address_list.entries:
            return f"No entries found in cheat table: {file_path}"
        
        # Format the results
        result = f"Cheat Table: {os.path.basename(file_path)}\n"
        result += "=" * 50 + "\n"
        result += f"Title: {address_list.title}\n"
        result += f"Target Process: {address_list.target_process}\n"
        result += f"Total Entries: {len(address_list.entries)}\n\n"
        
        result += "Address List:\n"
        result += "-" * 30 + "\n"
        
        for i, entry in enumerate(address_list.entries, 1):
            result += f"{i}. {entry.description}\n"
            if entry.address is not None:
                result += f"   Address: 0x{entry.address:X}\n"
            else:
                result += f"   Address: Not set\n"
            result += f"   Type: {entry.variable_type}\n"
            if entry.value is not None:
                result += f"   Value: {entry.value}\n"
            result += f"   Enabled: {entry.enabled}\n"
            if entry.offsets:
                result += f"   Offsets: {entry.offsets}\n"
            result += "\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error loading cheat table: {e}")
        return f"Error loading cheat table: {str(e)}"

@mcp.tool()
def extract_cheat_table_addresses(file_path: str, address_format: str = "detailed") -> str:
    """Extract and format addresses from a cheat table file
    
    Args:
        file_path: Full path to the .CT file to process
        address_format: Output format ('detailed', 'csv', 'simple', 'table')
        
    Returns:
        Formatted address information in requested format
    """
    try:
        logger.info(f"Extracting addresses from cheat table: {file_path}")
        
        # Parse the cheat table
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list or not address_list.entries:
            return f"No addresses found in cheat table: {file_path}"
        
        # Format according to requested format
        if address_format.lower() == "csv":
            result = "Description,Address,Type,Offset,Signed,Hex\n"
            for entry in address_list.entries:
                address_str = str(entry.address) if entry.address else "Not set"
                offset_str = entry.offsets[0] if entry.offsets else "-"
                signed_str = getattr(entry, 'show_signed', False)
                hex_str = getattr(entry, 'show_hex', False)
                result += f'"{entry.description}",{address_str},{entry.variable_type},{offset_str},{signed_str},{hex_str}\n'
        
        elif address_format.lower() == "simple":
            result = f"Addresses from {os.path.basename(file_path)}:\n"
            for entry in address_list.entries:
                address_str = str(entry.address) if entry.address else "Not set"
                result += f"{address_str} - {entry.description}\n"
        
        elif address_format.lower() == "table":
            result = f"# {os.path.basename(file_path)} Cheat Engine Address Table\n\n"
            result += "| ID | Description | Variable Type | Address | Offset | Signed | Hex |\n"
            result += "|----|-------------|---------------|---------|--------|--------|----- |\n"
            
            for entry in address_list.entries:
                entry_id = entry.id or "-"
                description = entry.description or "Unknown"
                var_type = entry.variable_type or "4 Bytes"
                address_str = str(entry.address) if entry.address else "Not set"
                offset_str = hex(entry.offsets[0]) if entry.offsets else "-"
                signed_str = "Yes" if getattr(entry, 'show_signed', False) else "No"
                hex_str = "Yes" if getattr(entry, 'show_hex', False) else "No"
                
                result += f"| {entry_id} | {description} | {var_type} | {address_str} | {offset_str} | {signed_str} | {hex_str} |\n"
            
            result += f"\n## Summary\n"
            result += f"- **Total Entries**: {len(address_list.entries)} addresses\n"
            
            # Count by module
            module_counts = {}
            for entry in address_list.entries:
                if entry.address and isinstance(entry.address, str) and '.dll' in entry.address:
                    module = entry.address.split('+')[0] if '+' in entry.address else entry.address
                    module_counts[module] = module_counts.get(module, 0) + 1
            
            for module, count in module_counts.items():
                result += f"- **{module} addresses**: {count} entries\n"
            
            # Count by variable type
            type_counts = {}
            for entry in address_list.entries:
                var_type = entry.variable_type or "4 Bytes"
                type_counts[var_type] = type_counts.get(var_type, 0) + 1
            
            type_list = ", ".join([f"{vtype} ({count})" for vtype, count in type_counts.items()])
            result += f"- **Variable Types**: {type_list}\n"
            
            # Count pointer addresses
            pointer_count = sum(1 for entry in address_list.entries if entry.offsets)
            result += f"- **Pointer Addresses** (with offsets): {pointer_count} entries\n"
        
        else:  # detailed format
            result = f"Complete Address List from {os.path.basename(file_path)}:\n"
            result += "=" * 60 + "\n\n"
            
            for i, entry in enumerate(address_list.entries, 1):
                result += f"{i:2d}. Description: {entry.description}\n"
                result += f"    Address:     {entry.address}\n"
                result += f"    Type:        {entry.variable_type}\n"
                if entry.offsets:
                    offset_strs = [hex(offset) for offset in entry.offsets]
                    result += f"    Offsets:     {', '.join(offset_strs)}\n"
                if hasattr(entry, 'show_signed'):
                    result += f"    Signed:      {'Yes' if entry.show_signed else 'No'}\n"
                if hasattr(entry, 'show_hex'):
                    result += f"    Hex:         {'Yes' if entry.show_hex else 'No'}\n"
                if entry.value is not None:
                    result += f"    Value:       {entry.value}\n"
                result += f"    Enabled:     {entry.enabled}\n"
                result += "\n"
            
            result += f"Total Addresses: {len(address_list.entries)}"
        
        return result
        
    except Exception as e:
        logger.error(f"Error extracting cheat table addresses: {e}")
        return f"Error extracting cheat table addresses: {str(e)}"

@mcp.tool()
def browse_cheat_tables_directory(directory_path: str = "") -> str:
    """Browse and get detailed information about cheat tables directory
    
    Args:
        directory_path: Directory to browse (defaults to My Cheat Tables)
        
    Returns:
        Directory structure and file information
    """
    try:
        # Use default directory if not specified
        search_dir = directory_path.strip() if directory_path.strip() else DEFAULT_CHEAT_TABLES_DIR
        
        logger.info(f"Browsing cheat tables directory: {search_dir}")
        
        # Check if directory exists
        if not Path(search_dir).exists():
            return f"Directory not found: {search_dir}"
        
        result = f"Cheat Tables Directory: {search_dir}\n"
        result += "=" * 50 + "\n\n"
        
        # Get directory stats
        try:
            dir_size = sum(f.stat().st_size for f in Path(search_dir).rglob('*') if f.is_file())
            result += f"Directory Size: {dir_size:,} bytes\n\n"
        except:
            result += "Directory Size: Unable to calculate\n\n"
        
        # List all files with details
        all_files = []
        for file_path in Path(search_dir).iterdir():
            if file_path.is_file():
                all_files.append(file_path)
        
        if not all_files:
            result += "No files found in directory.\n"
            return result
        
        # Sort files by modification time (newest first)
        all_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        
        ct_files = [f for f in all_files if f.suffix.lower() in ['.ct']]
        other_files = [f for f in all_files if f.suffix.lower() not in ['.ct']]
        
        # Cheat Table files
        if ct_files:
            result += f"Cheat Table Files ({len(ct_files)}):\n"
            result += "-" * 30 + "\n"
            for i, file_path in enumerate(ct_files, 1):
                stat = file_path.stat()
                mod_date = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime))
                result += f"{i:2d}. {file_path.name}\n"
                result += f"    Size: {stat.st_size:,} bytes\n"
                result += f"    Modified: {mod_date}\n"
                result += f"    Full Path: {file_path}\n\n"
        
        # Other files
        if other_files:
            result += f"\nOther Files ({len(other_files)}):\n"
            result += "-" * 20 + "\n"
            for file_path in other_files[:10]:  # Limit to first 10
                result += f"  {file_path.name} ({file_path.suffix})\n"
            if len(other_files) > 10:
                result += f"  ... and {len(other_files) - 10} more files\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error browsing cheat tables directory: {e}")
        return f"Error browsing cheat tables directory: {str(e)}"

@mcp.tool()
def extract_cheat_table_structures(file_path: str) -> str:
    """Extract structure definitions from a cheat table file
    
    Args:
        file_path: Full path to the .CT file to process
        
    Returns:
        Formatted structure information
    """
    try:
        logger.info(f"Extracting structures from cheat table: {file_path}")
        
        # Parse the cheat table using compatibility method
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list or not address_list.structures:
            return f"No structures found in cheat table: {file_path}"
        
        result = f"Structures from {os.path.basename(file_path)}:\n"
        result += "=" * 60 + "\n\n"
        
        for i, structure in enumerate(address_list.structures, 1):
            result += f"{i}. Structure: {structure.name}\n"
            result += f"   Auto Fill: {structure.auto_fill}\n"
            result += f"   Auto Create: {structure.auto_create}\n"
            result += f"   Default Hex: {structure.default_hex}\n"
            result += f"   Auto Destroy: {structure.auto_destroy}\n"
            result += f"   Elements: {len(structure.elements)}\n\n"
            
            if structure.elements:
                result += "   Element Details:\n"
                result += "   " + "-" * 50 + "\n"
                for elem in structure.elements:
                    result += f"   Offset {elem.offset:04X}: {elem.description}\n"
                    result += f"      Type: {elem.vartype} ({elem.bytesize} bytes)\n"
                    result += f"      Display: {elem.display_method}\n"
                    if elem.child_struct:
                        result += f"      Child Struct: {elem.child_struct}\n"
                    result += "\n"
            result += "\n"
        
        result += f"Total Structures: {len(address_list.structures)}"
        return result
        
    except Exception as e:
        logger.error(f"Error extracting cheat table structures: {e}")
        return f"Error extracting cheat table structures: {str(e)}"

@mcp.tool()
def extract_cheat_table_lua_script(file_path: str) -> str:
    """Extract Lua script from a cheat table file
    
    Args:
        file_path: Full path to the .CT file to process
        
    Returns:
        Lua script content
    """
    try:
        logger.info(f"Extracting Lua script from cheat table: {file_path}")
        
        # Parse the cheat table
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list or not address_list.lua_script:
            return f"No Lua script found in cheat table: {file_path}"
        
        result = f"Lua Script from {os.path.basename(file_path)}:\n"
        result += "=" * 60 + "\n\n"
        result += address_list.lua_script
        result += f"\n\n--- Script Length: {len(address_list.lua_script)} characters ---"
        
        return result
        
    except Exception as e:
        logger.error(f"Error extracting Lua script: {e}")
        return f"Error extracting Lua script: {str(e)}"

@mcp.tool()
def extract_cheat_table_disassembler_comments(file_path: str, address_filter: str = "") -> str:
    """Extract disassembler comments from a cheat table file
    
    Args:
        file_path: Full path to the .CT file to process
        address_filter: Optional address pattern to filter comments (e.g., "D2GAME.dll")
        
    Returns:
        Formatted disassembler comments
    """
    try:
        logger.info(f"Extracting disassembler comments from cheat table: {file_path}")
        
        # Parse the cheat table
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list or not address_list.disassembler_comments:
            return f"No disassembler comments found in cheat table: {file_path}"
        
        # Filter comments if requested
        comments = address_list.disassembler_comments
        if address_filter:
            comments = [c for c in comments if address_filter.lower() in c.address.lower()]
        
        if not comments:
            return f"No comments found matching filter '{address_filter}' in {file_path}"
        
        result = f"Disassembler Comments from {os.path.basename(file_path)}:\n"
        if address_filter:
            result += f"Filtered by: {address_filter}\n"
        result += "=" * 60 + "\n\n"
        
        for i, comment in enumerate(comments, 1):
            result += f"{i:3d}. Address: {comment.address}\n"
            result += f"     Comment: {comment.comment}\n\n"
        
        result += f"Total Comments: {len(comments)}"
        if address_filter:
            result += f" (filtered from {len(address_list.disassembler_comments)} total)"
        
        return result
        
    except Exception as e:
        logger.error(f"Error extracting disassembler comments: {e}")
        return f"Error extracting disassembler comments: {str(e)}"

@mcp.tool()
def extract_unitplayer_structure(file_path: str) -> str:
    """Extract the UnitPlayer structure definition from a cheat table
    
    Args:
        file_path: Full path to the .CT file to process
        
    Returns:
        Detailed UnitPlayer structure information
    """
    try:
        logger.info(f"Extracting UnitPlayer structure from: {file_path}")
        
        # Parse the cheat table
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list or not address_list.structures:
            return f"No structures found in cheat table: {file_path}"
        
        # Find UnitPlayer structure
        unitplayer = None
        for structure in address_list.structures:
            if structure.name.lower() == "unitplayer":
                unitplayer = structure
                break
        
        if not unitplayer:
            available = [s.name for s in address_list.structures]
            return f"UnitPlayer structure not found. Available structures: {', '.join(available)}"
        
        result = f"UnitPlayer Structure from {os.path.basename(file_path)}:\n"
        result += "=" * 60 + "\n\n"
        result += f"Structure Name: {unitplayer.name}\n"
        result += f"Auto Fill: {unitplayer.auto_fill}\n"
        result += f"Auto Create: {unitplayer.auto_create}\n"
        result += f"Default Hex: {unitplayer.default_hex}\n"
        result += f"Auto Destroy: {unitplayer.auto_destroy}\n"
        result += f"Total Elements: {len(unitplayer.elements)}\n\n"
        
        result += "Structure Layout:\n"
        result += "-" * 50 + "\n"
        result += "| Offset | Size | Type          | Description          |\n"
        result += "|--------|------|---------------|----------------------|\n"
        
        for elem in unitplayer.elements:
            offset_hex = f"0x{elem.offset:04X}"
            size_str = f"{elem.bytesize}B"
            type_str = elem.vartype[:12] + "..." if len(elem.vartype) > 15 else elem.vartype
            desc_str = elem.description[:18] + "..." if len(elem.description) > 21 else elem.description
            
            result += f"| {offset_hex:6} | {size_str:4} | {type_str:13} | {desc_str:20} |\n"
        
        result += "\nDetailed Element Information:\n"
        result += "-" * 40 + "\n"
        
        for i, elem in enumerate(unitplayer.elements[:10], 1):  # Show first 10 for readability
            result += f"{i:2d}. Offset 0x{elem.offset:04X}: {elem.description}\n"
            result += f"    Type: {elem.vartype} ({elem.bytesize} bytes)\n"
            result += f"    Display: {elem.display_method}\n"
            if elem.child_struct:
                result += f"    Child Structure: {elem.child_struct}\n"
            result += "\n"
        
        if len(unitplayer.elements) > 10:
            result += f"... and {len(unitplayer.elements) - 10} more elements\n"
        
        return result
        
    except Exception as e:
        logger.error(f"Error extracting UnitPlayer structure: {e}")
        return f"Error extracting UnitPlayer structure: {str(e)}"

@mcp.tool()
def comprehensive_cheat_table_analysis(file_path: str) -> str:
    """Perform comprehensive analysis of all cheat table components
    
    Args:
        file_path: Full path to the .CT file to process
        
    Returns:
        Complete analysis of addresses, structures, Lua script, and comments
    """
    try:
        logger.info(f"Performing comprehensive analysis of: {file_path}")
        
        # Parse the cheat table using compatibility method
        address_list = cheat_table_parser.parse_file_to_addresslist(file_path)
        
        if not address_list:
            return f"Failed to parse cheat table: {file_path}"
        
        result = f"Comprehensive Analysis: {os.path.basename(file_path)}\n"
        result += "=" * 70 + "\n\n"
        
        # Summary section
        result += "SUMMARY:\n"
        result += f"  Addresses: {len(address_list.entries)}\n"
        result += f"  Structures: {len(address_list.structures)}\n"
        result += f"  Lua Script: {'Yes' if address_list.lua_script else 'No'}\n"
        result += f"  Disassembler Comments: {len(address_list.disassembler_comments)}\n\n"
        
        # Address analysis
        if address_list.entries:
            module_counts = {}
            type_counts = {}
            for entry in address_list.entries:
                # Count by module
                if entry.address and isinstance(entry.address, str) and '.dll' in entry.address:
                    module = entry.address.split('+')[0] if '+' in entry.address else entry.address
                    module_counts[module] = module_counts.get(module, 0) + 1
                
                # Count by type
                var_type = entry.variable_type or "4 Bytes"
                type_counts[var_type] = type_counts.get(var_type, 0) + 1
            
            result += "ADDRESS ANALYSIS:\n"
            for module, count in module_counts.items():
                result += f"  {module}: {count} addresses\n"
            result += f"  Variable Types: {dict(type_counts)}\n\n"
        
        # Structure analysis
        if address_list.structures:
            result += "STRUCTURE ANALYSIS:\n"
            for struct in address_list.structures:
                result += f"  {struct.name}: {len(struct.elements)} elements\n"
            result += "\n"
        
        # Lua script analysis
        if address_list.lua_script:
            script_lines = address_list.lua_script.count('\n') + 1
            script_chars = len(address_list.lua_script)
            result += "LUA SCRIPT ANALYSIS:\n"
            result += f"  Length: {script_chars} characters, {script_lines} lines\n"
            
            # Basic content analysis
            if 'function' in address_list.lua_script.lower():
                func_count = address_list.lua_script.lower().count('function')
                result += f"  Functions: ~{func_count} detected\n"
            result += "\n"
        
        # Comments analysis
        if address_list.disassembler_comments:
            dll_comments = {}
            for comment in address_list.disassembler_comments:
                if '.dll' in comment.address:
                    dll = comment.address.split('.dll')[0] + '.dll'
                    dll_comments[dll] = dll_comments.get(dll, 0) + 1
            
            result += "DISASSEMBLER COMMENTS ANALYSIS:\n"
            for dll, count in dll_comments.items():
                result += f"  {dll}: {count} comments\n"
            result += "\n"
        
        result += "Use specific extraction tools for detailed analysis of each component."
        
        return result
        
    except Exception as e:
        logger.error(f"Error performing comprehensive analysis: {e}")
        return f"Error performing comprehensive analysis: {str(e)}"
    """Quick loader for the Diablo II cheat table (convenience function)
    
    Returns:
        Complete address list from Diablo II.CT in table format
    """
    diablo2_path = os.path.join(DEFAULT_CHEAT_TABLES_DIR, "Diablo II.CT")
    
    if not Path(diablo2_path).exists():
        return f"Diablo II.CT not found at: {diablo2_path}"
    
    return extract_cheat_table_addresses(diablo2_path, "table")

@mcp.tool()
def create_cheat_table_backup(file_path: str) -> str:
    """Create a backup of a cheat table file
    
    Args:
        file_path: Full path to the .CT file to backup
        
    Returns:
        Information about the backup operation
    """
    try:
        parser = CheatTableParser()
        backup_path = parser.create_backup(file_path)
        
        return f"✅ Backup successfully created:\nOriginal: {file_path}\nBackup: {backup_path}"
        
    except Exception as e:
        logger.error(f"Error creating backup: {e}")
        return f"❌ Error creating backup: {str(e)}"

@mcp.tool()
def add_address_to_cheat_table(file_path: str, description: str, address: str, 
                             variable_type: str = "4 Bytes", offsets: str = "", 
                             enabled: bool = False, create_backup: bool = True) -> str:
    """Add a new address entry to a cheat table
    
    Args:
        file_path: Full path to the .CT file to modify
        description: Description for the new address entry
        address: Address in hex format (e.g., "D2GAME.dll+1107B8" or "0x12345678")
        variable_type: Type of variable (e.g., "4 Bytes", "2 Bytes", "Byte", "Float", "Double")
        offsets: Optional offsets as comma-separated hex values (e.g., "0x48c,0x10")
        enabled: Whether the entry should be enabled by default
        create_backup: Whether to create a backup before modifying
        
    Returns:
        Result of the operation
    """
    try:
        from cheatengine.table_parser import CheatEntry
        
        # Parse offsets if provided
        offset_list = []
        if offsets.strip():
            offset_parts = [o.strip() for o in offsets.split(',')]
            for offset_str in offset_parts:
                if offset_str.startswith('0x'):
                    offset_list.append(int(offset_str, 16))
                else:
                    offset_list.append(int(offset_str))
        
        # Parse address if it's a hex value
        address_value = None
        address_string = None
        
        if address.startswith('0x'):
            address_value = int(address, 16)
        elif '+' in address:
            # This is a module+offset address like "D2GAME.dll+1107B8"
            address_string = address
        else:
            # Try to parse as regular hex without 0x prefix
            try:
                address_value = int(address, 16)
            except ValueError:
                # Treat as string address
                address_string = address
        
        # Generate unique ID
        import uuid
        entry_id = str(uuid.uuid4())[:8]
        
        # Create new entry
        new_entry = CheatEntry(
            id=entry_id,
            description=description,
            address=address_value,
            address_string=address_string,
            offsets=offset_list,
            variable_type=variable_type,
            enabled=enabled
        )
        
        parser = CheatTableParser()
        success = parser.add_address_to_cheat_table(file_path, new_entry, create_backup)
        
        if success:
            backup_msg = " (backup created)" if create_backup else ""
            return f"✅ Successfully added address to cheat table{backup_msg}:\n" \
                   f"Description: {description}\n" \
                   f"Address: {address}\n" \
                   f"Type: {variable_type}\n" \
                   f"Offsets: {offsets if offsets else 'None'}\n" \
                   f"Enabled: {enabled}\n" \
                   f"Entry ID: {entry_id}"
        else:
            return "❌ Failed to add address to cheat table"
            
    except Exception as e:
        logger.error(f"Error adding address to cheat table: {e}")
        return f"❌ Error adding address to cheat table: {str(e)}"

@mcp.tool()
def modify_address_in_cheat_table(file_path: str, entry_id: str, description: str = "", 
                                address: str = "", variable_type: str = "", 
                                offsets: str = "", enabled: bool = None, 
                                create_backup: bool = True) -> str:
    """Modify an existing address entry in a cheat table
    
    Args:
        file_path: Full path to the .CT file to modify
        entry_id: ID of the entry to modify
        description: New description (leave empty to keep current)
        address: New address (leave empty to keep current)
        variable_type: New variable type (leave empty to keep current)
        offsets: New offsets as comma-separated hex values (leave empty to keep current)
        enabled: New enabled state (None to keep current)
        create_backup: Whether to create a backup before modifying
        
    Returns:
        Result of the operation
    """
    try:
        from cheatengine.table_parser import CheatEntry
        
        parser = CheatTableParser()
        
        # Load existing table to get current entry
        address_list = parser.parse_file_to_addresslist(file_path)
        if not address_list:
            return f"❌ Could not load cheat table: {file_path}"
        
        # Find existing entry
        existing_entry = None
        for entry in address_list.entries:
            if entry.id == entry_id:
                existing_entry = entry
                break
        
        if not existing_entry:
            return f"❌ Entry with ID {entry_id} not found"
        
        # Create updated entry with new values
        updated_entry = CheatEntry(
            id=entry_id,
            description=description if description else existing_entry.description,
            address=existing_entry.address,
            offsets=existing_entry.offsets.copy() if existing_entry.offsets else [],
            variable_type=variable_type if variable_type else existing_entry.variable_type,
            enabled=enabled if enabled is not None else existing_entry.enabled,
            value=existing_entry.value,
            hotkey=existing_entry.hotkey,
            script=existing_entry.script,
            group_header=existing_entry.group_header
        )
        
        # Update address if provided
        if address:
            if address.startswith('0x'):
                updated_entry.address = int(address, 16)
            else:
                updated_entry.address = None  # Module-relative address
        
        # Update offsets if provided
        if offsets:
            offset_list = []
            offset_parts = [o.strip() for o in offsets.split(',')]
            for offset_str in offset_parts:
                if offset_str.startswith('0x'):
                    offset_list.append(int(offset_str, 16))
                else:
                    offset_list.append(int(offset_str))
            updated_entry.offsets = offset_list
        
        success = parser.modify_address_in_table(file_path, entry_id, updated_entry, create_backup)
        
        if success:
            backup_msg = " (backup created)" if create_backup else ""
            return f"✅ Successfully modified address in cheat table{backup_msg}:\n" \
                   f"Entry ID: {entry_id}\n" \
                   f"Description: {updated_entry.description}\n" \
                   f"Variable Type: {updated_entry.variable_type}\n" \
                   f"Enabled: {updated_entry.enabled}"
        else:
            return "❌ Failed to modify address in cheat table"
            
    except Exception as e:
        logger.error(f"Error modifying address in cheat table: {e}")
        return f"❌ Error modifying address in cheat table: {str(e)}"

@mcp.tool()
def remove_address_from_cheat_table(file_path: str, entry_id: str, create_backup: bool = True) -> str:
    """Remove an address entry from a cheat table
    
    Args:
        file_path: Full path to the .CT file to modify
        entry_id: ID of the entry to remove
        create_backup: Whether to create a backup before modifying
        
    Returns:
        Result of the operation
    """
    try:
        parser = CheatTableParser()
        success = parser.remove_address_from_table(file_path, entry_id, create_backup)
        
        if success:
            backup_msg = " (backup created)" if create_backup else ""
            return f"✅ Successfully removed address from cheat table{backup_msg}:\nEntry ID: {entry_id}"
        else:
            return f"❌ Failed to remove address from cheat table (entry {entry_id} not found)"
            
    except Exception as e:
        logger.error(f"Error removing address from cheat table: {e}")
        return f"❌ Error removing address from cheat table: {str(e)}"

@mcp.tool()
def create_new_cheat_table(file_path: str, title: str = "New Cheat Table", target_process: str = "") -> str:
    """Create a new empty cheat table file
    
    Args:
        file_path: Full path where to create the new .CT file
        title: Title for the cheat table
        target_process: Target process name for the cheat table
        
    Returns:
        Result of the operation
    """
    try:
        parser = CheatTableParser()
        success = parser.create_new_table(file_path, title, target_process)
        
        if success:
            return f"✅ Successfully created new cheat table:\n" \
                   f"File: {file_path}\n" \
                   f"Title: {title}\n" \
                   f"Target Process: {target_process if target_process else 'None'}"
        else:
            return "❌ Failed to create new cheat table"
            
    except Exception as e:
        logger.error(f"Error creating new cheat table: {e}")
        return f"❌ Error creating new cheat table: {str(e)}"

@mcp.tool()
def write_cheat_table_to_file(source_file_path: str, destination_file_path: str, create_backup: bool = True) -> str:
    """Copy/write a cheat table to a new location
    
    Args:
        source_file_path: Path to the source .CT file
        destination_file_path: Path where to write the copy
        create_backup: Whether to create a backup if destination exists
        
    Returns:
        Result of the operation
    """
    try:
        parser = CheatTableParser()
        
        # Load source table
        address_list = parser.parse_file_to_addresslist(source_file_path)
        if not address_list:
            return f"❌ Could not load source cheat table: {source_file_path}"
        
        # Create backup if destination exists and backup is requested
        if create_backup and Path(destination_file_path).exists():
            parser.create_backup(destination_file_path)
        
        # Write to destination
        success = parser.write_table_to_file(destination_file_path, address_list)
        
        if success:
            backup_msg = " (backup of destination created)" if create_backup and Path(destination_file_path).exists() else ""
            return f"✅ Successfully copied cheat table{backup_msg}:\n" \
                   f"From: {source_file_path}\n" \
                   f"To: {destination_file_path}\n" \
                   f"Entries: {len(address_list.entries)}"
        else:
            return "❌ Failed to write cheat table to destination"
            
    except Exception as e:
        logger.error(f"Error writing cheat table to file: {e}")
        return f"❌ Error writing cheat table to file: {str(e)}"

# ==========================================
# END CHEAT TABLE FILESYSTEM TOOLS
# ==========================================


def main():
    """Main server entry point"""
    try:
        # Initialize server configuration
        if args.debug:
            logging.getLogger().setLevel(logging.DEBUG)
            logger.debug("Debug mode enabled")
        
        if args.read_only:
            logger.info("Read-only mode enabled")
        
        # Load configuration
        server_config.load_config(args.config)
        
        # Initialize whitelist
        process_whitelist.load_whitelist(server_config.get_whitelist_path())
        
        # Initialize application launcher
        global app_launcher
        app_launcher = ApplicationLauncher(process_whitelist)
        
        # Set session file for persistence (optional)
        session_file = os.path.join(os.path.dirname(server_config.get_whitelist_path()), 'launcher_session.json')
        app_launcher.set_session_file(session_file)
        logger.info("Application launcher initialized")
        
        # Register automation tools if available
        if AUTOMATION_AVAILABLE:
            try:
                automation_tools = register_automation_tools(mcp)
                logger.info(f"Registered {len(automation_tools)} automation tools")
            except Exception as e:
                logger.error(f"Failed to register automation tools: {e}")
        
        logger.info("MCP Cheat Engine Server starting...")
        
        # Run the MCP server
        mcp.run()
        
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    except Exception as e:
        logger.error(f"Server error: {e}")
        sys.exit(1)
    finally:
        # Cleanup
        if current_process:
            try:
                process_manager.detach_process()
                logger.info("Cleaned up process attachment")
            except:
                pass


if __name__ == "__main__":
    main()
def read_file(path: str) -> str:
    """Read file contents"""
    path_obj = Path(path)

    if not path_obj.exists():
        return f"File not found: {path}"

    if not path_obj.is_file():
        return f"Path is not a file: {path}"

    try:
        with path_obj.open("r", encoding="utf-8") as f:
            content = f.read()

        return f"Contents of {path}:\n{content}"

    except UnicodeDecodeError:
        return f"File is not text or uses unsupported encoding: {path}"
    except PermissionError:
        return f"Permission denied reading: {path}"
    except Exception as e:
        return f"Error reading file: {str(e)}"


@mcp.tool()
def get_file_info(path: str) -> str:
    """Get information about a file"""
    path_obj = Path(path)

    if not path_obj.exists():
        return f"Path not found: {path}"

    try:
        stat_info = path_obj.stat()
        file_type = "directory" if path_obj.is_dir() else "file"

        info = [
            f"Path: {path}",
            f"Type: {file_type}",
            f"Size: {stat_info.st_size} bytes",
            f"Modified: {stat_info.st_mtime}",
            f"Created: {stat_info.st_ctime}",
        ]

        info_text = "\n".join(info)
        return f"File Info:\n{info_text}"

    except PermissionError:
        return f"Permission denied accessing: {path}"
    except Exception as e:
        return f"Error getting file info: {str(e)}"


# ==========================================
# PYAUTOGUI TOOL HANDLERS
# ==========================================

# Screen capture & analysis tools
@mcp.tool()
def pyautogui_screenshot(region: Optional[List[int]] = None, save_path: Optional[str] = None) -> str:
    """Take a screenshot of the entire screen or a specific region"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_screenshot({
            "region": region,
            "save_path": save_path
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Screenshot captured successfully:\n- Size: {data['width']}x{data['height']}\n- Region: {data.get('region', 'Full screen')}\n- Saved: {data.get('save_path', 'Not saved')}\n- Cache key: {data['cache_key']}"
        else:
            return f"Screenshot failed: {result['error']}"
    except Exception as e:
        return f"Screenshot error: {str(e)}"

@mcp.tool()
def pyautogui_get_pixel_color(x: int, y: int) -> str:
    """Get the RGB color value of a pixel at specific screen coordinates"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_pixel_color({"x": x, "y": y}))
        
        if result["success"]:
            data = result["data"]
            return f"Pixel color at ({data['x']}, {data['y']}):\n- RGB: {data['rgb']}\n- Hex: {data['hex']}"
        else:
            return f"Get pixel color failed: {result['error']}"
    except Exception as e:
        return f"Get pixel color error: {str(e)}"

@mcp.tool()
def pyautogui_find_image(image_path: str, confidence: float = 0.8, region: Optional[List[int]] = None) -> str:
    """Find an image on the screen using template matching"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_find_image({
            "image_path": image_path,
            "confidence": confidence,
            "region": region
        }))
        
        if result["success"]:
            data = result["data"]
            match = data["match"]
            if match["found"]:
                return f"Image found:\n- Location: ({match['x']}, {match['y']})\n- Size: {match['width']}x{match['height']}\n- Center: ({match['center_x']}, {match['center_y']})\n- Confidence: {data['search_confidence']}"
            else:
                return f"Image not found (confidence: {data['search_confidence']})"
        else:
            return f"Image search failed: {result['error']}"
    except Exception as e:
        return f"Image search error: {str(e)}"

@mcp.tool()
def pyautogui_find_all_images(image_path: str, confidence: float = 0.8, region: Optional[List[int]] = None) -> str:
    """Find all instances of an image on the screen"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_find_all_images({
            "image_path": image_path,
            "confidence": confidence,
            "region": region
        }))
        
        if result["success"]:
            data = result["data"]
            matches = data["matches"]
            if matches:
                output = [f"Found {len(matches)} instances:"]
                for i, match in enumerate(matches[:5], 1):  # Show first 5
                    output.append(f"  {i}. ({match['x']}, {match['y']}) - {match['width']}x{match['height']}")
                if len(matches) > 5:
                    output.append(f"  ... and {len(matches) - 5} more")
                return "\n".join(output)
            else:
                return f"No instances found (confidence: {data['search_confidence']})"
        else:
            return f"Find all images failed: {result['error']}"
    except Exception as e:
        return f"Find all images error: {str(e)}"

# Mouse control tools
@mcp.tool()
def pyautogui_get_mouse_position() -> str:
    """Get the current mouse cursor position"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_mouse_position({}))
        
        if result["success"]:
            data = result["data"]
            return f"Mouse position: ({data['x']}, {data['y']})"
        else:
            return f"Get mouse position failed: {result['error']}"
    except Exception as e:
        return f"Get mouse position error: {str(e)}"

@mcp.tool()
def pyautogui_move_mouse(x: int, y: int, duration: float = 0.5, relative: bool = False) -> str:
    """Move the mouse cursor to specific coordinates"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_move_mouse({
            "x": x,
            "y": y,
            "duration": duration,
            "relative": relative
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Mouse moved to ({data['target_x']}, {data['target_y']}) in {data['duration']}s"
        else:
            return f"Move mouse failed: {result['error']}"
    except Exception as e:
        return f"Move mouse error: {str(e)}"

@mcp.tool()
def pyautogui_click_mouse(x: Optional[int] = None, y: Optional[int] = None, button: str = "left", clicks: int = 1, interval: float = 0.0) -> str:
    """Click the mouse at specific coordinates or current position"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_click_mouse({
            "x": x,
            "y": y,
            "button": button,
            "clicks": clicks,
            "interval": interval
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Mouse clicked at {data['position']} - Button: {data['button']}, Clicks: {data['clicks']}"
        else:
            return f"Mouse click failed: {result['error']}"
    except Exception as e:
        return f"Mouse click error: {str(e)}"

@mcp.tool()
def pyautogui_drag_mouse(start_x: int, start_y: int, end_x: int, end_y: int, duration: float = 1.0, button: str = "left") -> str:
    """Drag the mouse from start coordinates to end coordinates"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_drag_mouse({
            "start_x": start_x,
            "start_y": start_y,
            "end_x": end_x,
            "end_y": end_y,
            "duration": duration,
            "button": button
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Mouse dragged from {data['start_position']} to {data['end_position']} - Distance: {data['distance']:.1f}px"
        else:
            return f"Mouse drag failed: {result['error']}"
    except Exception as e:
        return f"Mouse drag error: {str(e)}"

@mcp.tool()
def pyautogui_scroll_mouse(clicks: int, x: Optional[int] = None, y: Optional[int] = None) -> str:
    """Scroll the mouse wheel at specific coordinates or current position"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_scroll_mouse({
            "clicks": clicks,
            "x": x,
            "y": y
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Mouse scrolled {data['direction']} {abs(data['clicks'])} clicks at {data['position']}"
        else:
            return f"Mouse scroll failed: {result['error']}"
    except Exception as e:
        return f"Mouse scroll error: {str(e)}"

# Keyboard automation tools
@mcp.tool()
def pyautogui_type_text(text: str, interval: float = 0.0) -> str:
    """Type text with optional interval between characters"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_type_text({
            "text": text,
            "interval": interval
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Typed text: '{data['text'][:50]}{'...' if len(data['text']) > 50 else ''}' ({data['length']} chars)"
        else:
            return f"Type text failed: {result['error']}"
    except Exception as e:
        return f"Type text error: {str(e)}"

@mcp.tool()
def pyautogui_press_key(key: str, presses: int = 1, interval: float = 0.0) -> str:
    """Press a specific key one or more times"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_press_key({
            "key": key,
            "presses": presses,
            "interval": interval
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Pressed key '{data['key']}' {data['presses']} time(s)"
        else:
            return f"Press key failed: {result['error']}"
    except Exception as e:
        return f"Press key error: {str(e)}"

@mcp.tool()
def pyautogui_key_combination(keys: List[str]) -> str:
    """Press a combination of keys simultaneously (hotkeys)"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_key_combination({
            "keys": keys
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Pressed key combination: {data['combination']}"
        else:
            return f"Key combination failed: {result['error']}"
    except Exception as e:
        return f"Key combination error: {str(e)}"

@mcp.tool()
def pyautogui_hold_key(key: str, duration: float = 1.0) -> str:
    """Hold a key down for a specified duration"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_hold_key({
            "key": key,
            "duration": duration
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Held key '{data['key']}' for {data['duration']} seconds"
        else:
            return f"Hold key failed: {result['error']}"
    except Exception as e:
        return f"Hold key error: {str(e)}"

# Utility & configuration tools
@mcp.tool()
def pyautogui_get_screen_info() -> str:
    """Get detailed information about the screen (resolution, size)"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_screen_info({}))
        
        if result["success"]:
            data = result["data"]
            return f"Screen info:\n- Resolution: {data['width']}x{data['height']}\n- Primary monitor: {data['primary_monitor']}\n- Monitor count: {data['monitor_count']}"
        else:
            return f"Get screen info failed: {result['error']}"
    except Exception as e:
        return f"Get screen info error: {str(e)}"

@mcp.tool()
def pyautogui_is_on_screen(x: int, y: int) -> str:
    """Check if given coordinates are within screen bounds"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_is_on_screen({
            "x": x,
            "y": y
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Coordinates ({data['x']}, {data['y']}) are {'on' if data['on_screen'] else 'off'} screen"
        else:
            return f"Check coordinates failed: {result['error']}"
    except Exception as e:
        return f"Check coordinates error: {str(e)}"

@mcp.tool()
def pyautogui_set_pause(pause_duration: float) -> str:
    """Set the pause duration between PyAutoGUI actions"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_set_pause({
            "pause_duration": pause_duration
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Pause duration changed from {data['old_pause']} to {data['new_pause']} seconds"
        else:
            return f"Set pause failed: {result['error']}"
    except Exception as e:
        return f"Set pause error: {str(e)}"

@mcp.tool()
def pyautogui_set_failsafe(enabled: bool) -> str:
    """Enable or disable PyAutoGUI failsafe (emergency stop by moving mouse to corner)"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_set_failsafe({
            "enabled": enabled
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Failsafe {'enabled' if data['new_failsafe'] else 'disabled'} (was {'enabled' if data['old_failsafe'] else 'disabled'})"
        else:
            return f"Set failsafe failed: {result['error']}"
    except Exception as e:
        return f"Set failsafe error: {str(e)}"

@mcp.tool()
def pyautogui_get_available_keys() -> str:
    """Get a list of all available keyboard keys that can be used with PyAutoGUI"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_get_available_keys({}))
        
        if result["success"]:
            data = result["data"]
            categories = data["categories"]
            output = [f"Available keys ({data['total_count']} total):"]
            
            for category, keys in categories.items():
                if keys:
                    output.append(f"\n{category.replace('_', ' ').title()}:")
                    output.append(f"  {', '.join(keys[:10])}")
                    if len(keys) > 10:
                        output.append(f"  ... and {len(keys) - 10} more")
            
            return "\n".join(output)
        else:
            return f"Get available keys failed: {result['error']}"
    except Exception as e:
        return f"Get available keys error: {str(e)}"

# Advanced feature tools
@mcp.tool()
def pyautogui_create_image_template(name: str, x: int, y: int, width: int, height: int) -> str:
    """Create an image template from a screen region for future recognition"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_create_template({
            "name": name,
            "x": x,
            "y": y,
            "width": width,
            "height": height
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Template '{data['template_name']}' created from region {data['region']} - Size: {data['width']}x{data['height']}"
        else:
            return f"Create template failed: {result['error']}"
    except Exception as e:
        return f"Create template error: {str(e)}"

@mcp.tool()
def pyautogui_find_template(template_name: str, confidence: float = 0.8) -> str:
    """Find a previously created image template on the screen"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_find_template({
            "template_name": template_name,
            "confidence": confidence
        }))
        
        if result["success"]:
            data = result["data"]
            match = data["match"]
            if match["found"]:
                return f"Template '{data['template_name']}' found at ({match['x']}, {match['y']}) - Center: ({match['center_x']}, {match['center_y']})"
            else:
                return f"Template '{data['template_name']}' not found"
        else:
            return f"Find template failed: {result['error']}"
    except Exception as e:
        return f"Find template error: {str(e)}"

# Batch operation tools
@mcp.tool()
def pyautogui_batch_clicks(click_sequence: List[Dict[str, Any]]) -> str:
    """Perform multiple click operations in sequence"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_batch_clicks({
            "click_sequence": click_sequence
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Batch clicks completed: {data['total_clicks']} operations executed successfully"
        else:
            return f"Batch clicks failed: {result['error']}"
    except Exception as e:
        return f"Batch clicks error: {str(e)}"

@mcp.tool()
def pyautogui_batch_keys(key_sequence: List[Dict[str, Any]]) -> str:
    """Perform multiple keyboard operations in sequence"""
    if not PYAUTOGUI_AVAILABLE or not pyautogui_handler:
        return "Error: PyAutoGUI is not available"
    
    try:
        result = asyncio.run(pyautogui_handler.handle_batch_keys({
            "key_sequence": key_sequence
        }))
        
        if result["success"]:
            data = result["data"]
            return f"Batch keys completed: {data['total_operations']} operations executed successfully"
        else:
            return f"Batch keys failed: {result['error']}"
    except Exception as e:
        return f"Batch keys error: {str(e)}"


# ==========================================
# END PYAUTOGUI TOOL HANDLERS
# ==========================================


# ==========================================
# PYWINAUTO TOOL HANDLERS
# ==========================================

# Application management tools
@mcp.tool()
def pywinauto_connect_application(process_id: Optional[int] = None, path: Optional[str] = None, backend: str = "uia") -> str:
    """Connect to an existing Windows application using PyWinAuto"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_connect_application({
            "process_id": process_id,
            "path": path,
            "backend": backend
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error connecting to application: {str(e)}"


@mcp.tool()
def pywinauto_launch_application(path: str, arguments: str = "", work_dir: Optional[str] = None, backend: str = "uia", timeout: float = 10.0) -> str:
    """Launch and connect to a Windows application using PyWinAuto"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_launch_application({
            "path": path,
            "arguments": arguments,
            "work_dir": work_dir,
            "backend": backend,
            "timeout": timeout
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error launching application: {str(e)}"


@mcp.tool()
def pywinauto_close_application(process_id: int, force: bool = False) -> str:
    """Close a connected Windows application"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_close_application({
            "process_id": process_id,
            "force": force
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error closing application: {str(e)}"


# Window and element discovery tools
@mcp.tool()
def pywinauto_find_windows(title: Optional[str] = None, class_name: Optional[str] = None, process_id: Optional[int] = None, backend: str = "uia") -> str:
    """Find Windows desktop windows by various criteria"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_find_windows({
            "title": title,
            "class_name": class_name,
            "process_id": process_id,
            "backend": backend
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error finding windows: {str(e)}"


@mcp.tool()
def pywinauto_find_element(process_id: int, window_title: Optional[str] = None, automation_id: Optional[str] = None, 
                          name: Optional[str] = None, class_name: Optional[str] = None, 
                          control_type: Optional[str] = None, index: int = 0) -> str:
    """Find UI elements within a Windows application"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_find_element({
            "process_id": process_id,
            "window_title": window_title,
            "automation_id": automation_id,
            "name": name,
            "class_name": class_name,
            "control_type": control_type,
            "index": index
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error finding element: {str(e)}"


@mcp.tool()
def pywinauto_get_window_hierarchy(process_id: int, window_title: Optional[str] = None, max_depth: int = 3) -> str:
    """Get the UI element hierarchy tree for a window"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        result = asyncio.run(pywinauto_handler.handle_get_window_hierarchy({
            "process_id": process_id,
            "window_title": window_title,
            "max_depth": max_depth
        }))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error getting window hierarchy: {str(e)}"


# UI interaction tools
@mcp.tool()
def pywinauto_click_element(process_id: int, window_title: Optional[str] = None, automation_id: Optional[str] = None,
                           name: Optional[str] = None, class_name: Optional[str] = None, 
                           control_type: Optional[str] = None, button: str = "left", double: bool = False) -> str:
    """Click on a UI element in a Windows application"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        # Build element criteria from provided parameters
        arguments = {"process_id": process_id, "button": button, "double": double}
        if window_title:
            arguments["window_title"] = window_title
        if automation_id:
            arguments["automation_id"] = automation_id
        if name:
            arguments["name"] = name
        if class_name:
            arguments["class_name"] = class_name
        if control_type:
            arguments["control_type"] = control_type
        
        result = asyncio.run(pywinauto_handler.handle_click_element(arguments))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error clicking element: {str(e)}"


@mcp.tool()
def pywinauto_type_text(process_id: int, text: str, window_title: Optional[str] = None, 
                       automation_id: Optional[str] = None, name: Optional[str] = None, 
                       class_name: Optional[str] = None, control_type: Optional[str] = None, 
                       clear_first: bool = True) -> str:
    """Type text into a UI element in a Windows application"""
    if not PYWINAUTO_AVAILABLE or not pywinauto_handler:
        return "Error: PyWinAuto is not available"
    
    try:
        # Build element criteria from provided parameters
        arguments = {"process_id": process_id, "text": text, "clear_first": clear_first}
        if window_title:
            arguments["window_title"] = window_title
        if automation_id:
            arguments["automation_id"] = automation_id
        if name:
            arguments["name"] = name
        if class_name:
            arguments["class_name"] = class_name
        if control_type:
            arguments["control_type"] = control_type
        
        result = asyncio.run(pywinauto_handler.handle_type_text(arguments))
        
        if result["success"]:
            return result["content"][0].text
        else:
            return f"Error: {result['error']}"
    except Exception as e:
        return f"Error typing text: {str(e)}"


# ==========================================
# END PYWINAUTO TOOL HANDLERS
# ==========================================

# ==========================================
# CHEAT ENGINE VERSION DETECTION TOOLS
# ==========================================

@mcp.tool()
def get_cheat_engine_version() -> str:
    """Get Cheat Engine version information directly from the system
    
    Returns detailed information about the installed Cheat Engine version,
    including file version, installation path, and detection method used.
    
    Returns:
        Comprehensive version information as a formatted string
    """
    try:
        version_info = cheat_engine_bridge.get_cheat_engine_version_info()
        
        if not version_info:
            return "❌ Cheat Engine not found on this system"
        
        # Format the version information nicely
        result = []
        result.append("🔍 Cheat Engine Version Information")
        result.append("=" * 40)
        
        # Basic version info
        if version_info.get('version'):
            result.append(f"📋 Version: {version_info['version']}")
        
        if version_info.get('installation_path'):
            result.append(f"📁 Installation Path: {version_info['installation_path']}")
        
        if version_info.get('executable_path'):
            result.append(f"🎯 Executable: {version_info['executable_path']}")
        
        # Detection methods that succeeded
        detection_methods = version_info.get('detection_methods', [])
        if detection_methods:
            successful_methods = [method.get('method', 'unknown') for method in detection_methods if method.get('status') == 'success']
            if successful_methods:
                result.append(f"✅ Detection Methods: {', '.join(successful_methods)}")
        
        # Running process info
        if version_info.get('running_process'):
            proc_info = version_info['running_process']
            result.append(f"🔄 Running Process: PID {proc_info.get('pid', 'N/A')}")
        
        # Registry information
        if version_info.get('registry_info'):
            reg_info = version_info['registry_info']
            if reg_info.get('version'):
                result.append(f"📝 Registry Version: {reg_info['version']}")
            if reg_info.get('install_date'):
                result.append(f"📅 Install Date: {reg_info['install_date']}")
        
        # File version details
        if version_info.get('file_version_info'):
            file_info = version_info['file_version_info']
            if file_info.get('file_description'):
                result.append(f"📄 Description: {file_info['file_description']}")
            if file_info.get('company_name'):
                result.append(f"🏢 Company: {file_info['company_name']}")
        
        return "\n".join(result)
        
    except Exception as e:
        logger.error(f"Error getting Cheat Engine version: {e}")
        return f"❌ Error retrieving version information: {str(e)}"

@mcp.tool()
def get_cheat_engine_basic_version() -> str:
    """Get just the basic Cheat Engine version string
    
    A simplified version that returns only the version number,
    equivalent to the original getCEVersion functionality.
    
    Returns:
        Version string (e.g., "7.5") or error message
    """
    try:
        # Use the already detected version from installation
        if cheat_engine_bridge.ce_installation.available:
            version = cheat_engine_bridge.ce_installation.version
            if version and version != "Unknown":
                return version
        
        # If no version from installation, try to get from executable
        if cheat_engine_bridge.ce_installation.executable:
            version = cheat_engine_bridge._get_ce_version(Path(cheat_engine_bridge.ce_installation.executable))
            if version and version != "Unknown":
                return version
        
        return "Cheat Engine version not detected"
            
    except Exception as e:
        logger.error(f"Error getting basic CE version: {e}")
        return f"Error: {str(e)}"

# ==========================================
# END CHEAT ENGINE VERSION DETECTION TOOLS
# ==========================================


# Main execution
if __name__ == "__main__":
    # Debug output if enabled
    if args.debug:
        print("Starting File Manager MCP Server...", file=sys.stderr)
        print(f"Workspace: {args.workspace}", file=sys.stderr)

    # Run the server
    mcp.run()
