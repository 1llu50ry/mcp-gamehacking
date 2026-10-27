"""
Lua Interface Module
Handles Cheat Engine Lua script integration and execution
"""

import logging
import re
import subprocess
import tempfile
import os
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class LuaScript:
    """Represents a Lua script from Cheat Engine"""
    name: str
    content: str
    variables: List[str]
    functions: List[str]
    dependencies: List[str]
    safe_to_execute: bool = False

class LuaInterface:
    """Interface for Cheat Engine Lua script analysis and limited execution"""
    
    def __init__(self):
        self.lua_available = self._check_lua_availability()
        self.safe_functions = self._get_safe_functions()
        self.dangerous_patterns = self._get_dangerous_patterns()
    
    def _check_lua_availability(self) -> bool:
        """Check if Lua interpreter is available"""
        try:
            result = subprocess.run(['lua', '-v'], capture_output=True, text=True, timeout=5)
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            logger.info("Lua interpreter not available - script execution disabled")
            return False
    
    def _get_safe_functions(self) -> set:
        """Get list of safe Lua functions that can be executed"""
        return {
            # Basic Lua functions
            'print', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs',
            'next', 'select', 'unpack', 'rawget', 'rawset', 'rawlen',
            'getmetatable', 'setmetatable',
            
            # Math functions
            'math.abs', 'math.acos', 'math.asin', 'math.atan', 'math.atan2',
            'math.ceil', 'math.cos', 'math.cosh', 'math.deg', 'math.exp',
            'math.floor', 'math.fmod', 'math.frexp', 'math.huge', 'math.ldexp',
            'math.log', 'math.log10', 'math.max', 'math.min', 'math.modf',
            'math.pi', 'math.pow', 'math.rad', 'math.random', 'math.randomseed',
            'math.sin', 'math.sinh', 'math.sqrt', 'math.tan', 'math.tanh',
            
            # String functions
            'string.byte', 'string.char', 'string.dump', 'string.find',
            'string.format', 'string.gmatch', 'string.gsub', 'string.len',
            'string.lower', 'string.match', 'string.rep', 'string.reverse',
            'string.sub', 'string.upper',
            
            # Table functions
            'table.concat', 'table.insert', 'table.maxn', 'table.remove',
            'table.sort', 'table.unpack'
        }
    
    def _get_dangerous_patterns(self) -> List[str]:
        """Get patterns that indicate dangerous operations"""
        return [
            # File operations
            r'\bio\b', r'\bfile\b', r'dofile', r'loadfile',
            
            # Process/system operations
            r'\bos\.\w+', r'\bexecute\b', r'\bsystem\b',
            
            # Loading/requiring modules
            r'\brequire\b', r'\bloadstring\b', r'\bload\b',
            
            # Memory operations (CE specific)
            r'\breadBytes\b', r'\bwriteBytes\b', r'\bgetAddress\b',
            r'\bgetAddressList\b', r'\bmemoryrecord\b',
            
            # Process manipulation
            r'\bopenProcess\b', r'\bcloseHandle\b', r'\bVirtualAlloc\b',
            
            # Registry operations
            r'\bregistry\b', r'\breg_\w+',
            
            # Network operations
            r'\bsocket\b', r'\bhttp\b', r'\bftp\b',
            
            # DLL operations
            r'\bloadLibrary\b', r'\bgetProcAddress\b', r'\bcall\b'
        ]
    
    def analyze_script(self, script_content: str, script_name: str = "unknown") -> LuaScript:
        """Analyze a Lua script for safety and extract information
        
        Args:
            script_content: The Lua script content
            script_name: Name of the script
            
        Returns:
            LuaScript object with analysis results
        """
        try:
            # Extract variables
            variables = self._extract_variables(script_content)
            
            # Extract functions
            functions = self._extract_functions(script_content)
            
            # Extract dependencies/requires
            dependencies = self._extract_dependencies(script_content)
            
            # Check safety
            safe_to_execute = self._check_script_safety(script_content)
            
            return LuaScript(
                name=script_name,
                content=script_content,
                variables=variables,
                functions=functions,
                dependencies=dependencies,
                safe_to_execute=safe_to_execute
            )
            
        except Exception as e:
            logger.error(f"Error analyzing script {script_name}: {e}")
            return LuaScript(
                name=script_name,
                content=script_content,
                variables=[],
                functions=[],
                dependencies=[],
                safe_to_execute=False
            )
    
    def _extract_variables(self, script_content: str) -> List[str]:
        """Extract variable declarations from script"""
        variables = []
        
        # Look for local variable declarations
        local_pattern = r'\blocal\s+([a-zA-Z_]\w*)'
        matches = re.finditer(local_pattern, script_content)
        for match in matches:
            variables.append(match.group(1))
        
        # Look for global variable assignments
        global_pattern = r'^([a-zA-Z_]\w*)\s*='
        matches = re.finditer(global_pattern, script_content, re.MULTILINE)
        for match in matches:
            var_name = match.group(1)
            if var_name not in ['if', 'for', 'while', 'function', 'local', 'return']:
                variables.append(var_name)
        
        return list(set(variables))  # Remove duplicates
    
    def _extract_functions(self, script_content: str) -> List[str]:
        """Extract function definitions from script"""
        functions = []
        
        # Look for function definitions
        function_pattern = r'\bfunction\s+([a-zA-Z_]\w*)\s*\('
        matches = re.finditer(function_pattern, script_content)
        for match in matches:
            functions.append(match.group(1))
        
        # Look for anonymous function assignments
        anon_pattern = r'([a-zA-Z_]\w*)\s*=\s*function\s*\('
        matches = re.finditer(anon_pattern, script_content)
        for match in matches:
            functions.append(match.group(1))
        
        return functions
    
    def _extract_dependencies(self, script_content: str) -> List[str]:
        """Extract require statements and dependencies"""
        dependencies = []
        
        # Look for require statements
        require_pattern = r'\brequire\s*\(\s*["\']([^"\']+)["\']\s*\)'
        matches = re.finditer(require_pattern, script_content)
        for match in matches:
            dependencies.append(match.group(1))
        
        return dependencies
    
    def _check_script_safety(self, script_content: str) -> bool:
        """Check if script is safe to execute"""
        
        # Check for dangerous patterns
        for pattern in self.dangerous_patterns:
            if re.search(pattern, script_content, re.IGNORECASE):
                logger.warning(f"Dangerous pattern found: {pattern}")
                return False
        
        # Check for suspicious function calls
        suspicious_calls = [
            'os.execute', 'os.remove', 'os.rename', 'os.exit',
            'io.open', 'io.close', 'io.read', 'io.write',
            'debug.debug', 'debug.getfenv', 'debug.setfenv'
        ]
        
        for call in suspicious_calls:
            if call in script_content:
                logger.warning(f"Suspicious function call found: {call}")
                return False
        
        return True
    
    def execute_safe_script(self, script: LuaScript, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a safe Lua script in a sandboxed environment
        
        Args:
            script: LuaScript object to execute
            context: Optional context variables to provide to script
            
        Returns:
            Dictionary with execution results
        """
        if not self.lua_available:
            return {
                'success': False,
                'error': 'Lua interpreter not available',
                'output': '',
                'variables': {}
            }
        
        if not script.safe_to_execute:
            return {
                'success': False,
                'error': 'Script marked as unsafe for execution',
                'output': '',
                'variables': {}
            }
        
        try:
            # Create sandboxed script
            sandboxed_script = self._create_sandboxed_script(script.content, context)
            
            # Execute in temporary file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.lua', delete=False) as f:
                f.write(sandboxed_script)
                temp_file = f.name
            
            try:
                # Execute with timeout
                result = subprocess.run(
                    ['lua', temp_file],
                    capture_output=True,
                    text=True,
                    timeout=10  # 10 second timeout
                )
                
                return {
                    'success': result.returncode == 0,
                    'error': result.stderr if result.returncode != 0 else '',
                    'output': result.stdout,
                    'variables': self._extract_output_variables(result.stdout)
                }
                
            finally:
                # Clean up temp file
                try:
                    os.unlink(temp_file)
                except OSError:
                    pass
                    
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'Script execution timed out',
                'output': '',
                'variables': {}
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Execution error: {e}',
                'output': '',
                'variables': {}
            }
    
    def _create_sandboxed_script(self, script_content: str, context: Dict[str, Any] = None) -> str:
        """Create a sandboxed version of the script"""
        
        sandbox_header = """
-- Sandboxed Lua execution environment
-- Disable dangerous functions
os = nil
io = nil
debug = nil
dofile = nil
loadfile = nil
loadstring = nil
load = nil

-- Provide safe context variables
"""
        
        # Add context variables if provided
        context_vars = ""
        if context:
            for key, value in context.items():
                if isinstance(value, str):
                    context_vars += f'{key} = "{value}"\n'
                elif isinstance(value, (int, float)):
                    context_vars += f'{key} = {value}\n'
                elif isinstance(value, bool):
                    context_vars += f'{key} = {str(value).lower()}\n'
        
        return sandbox_header + context_vars + "\n-- Original script:\n" + script_content
    
    def _extract_output_variables(self, output: str) -> Dict[str, Any]:
        """Extract variables from script output"""
        variables = {}
        
        # Look for variable = value patterns in output
        var_pattern = r'^(\w+)\s*=\s*(.+)$'
        
        for line in output.split('\n'):
            match = re.match(var_pattern, line.strip())
            if match:
                var_name = match.group(1)
                var_value = match.group(2).strip()
                
                # Try to parse the value
                try:
                    if var_value.startswith('"') and var_value.endswith('"'):
                        variables[var_name] = var_value[1:-1]  # String
                    elif var_value in ['true', 'false']:
                        variables[var_name] = var_value == 'true'  # Boolean
                    elif '.' in var_value:
                        variables[var_name] = float(var_value)  # Float
                    else:
                        variables[var_name] = int(var_value)  # Integer
                except ValueError:
                    variables[var_name] = var_value  # Keep as string
        
        return variables
    
    def convert_ce_script_to_mcp(self, script: LuaScript) -> Dict[str, Any]:
        """Convert a CE Lua script to MCP-compatible operations
        
        Args:
            script: LuaScript object to convert
            
        Returns:
            Dictionary with MCP-compatible operations
        """
        operations = []
        
        # Analyze script content for memory operations
        memory_reads = self._extract_memory_reads(script.content)
        memory_writes = self._extract_memory_writes(script.content)
        address_calculations = self._extract_address_calculations(script.content)
        
        # Convert to MCP operations
        for read_op in memory_reads:
            operations.append({
                'type': 'read_memory',
                'address': read_op.get('address'),
                'size': read_op.get('size', 4),
                'data_type': read_op.get('type', 'uint32')
            })
        
        # Note: Write operations are not included for safety
        
        return {
            'script_name': script.name,
            'safe_operations': operations,
            'variables': script.variables,
            'functions': script.functions,
            'original_safe': script.safe_to_execute
        }
    
    def _extract_memory_reads(self, script_content: str) -> List[Dict[str, Any]]:
        """Extract memory read operations from script"""
        reads = []
        
        # Look for common CE memory read patterns
        patterns = [
            r'readBytes\(([^,]+),\s*(\d+)\)',
            r'readInteger\(([^)]+)\)',
            r'readFloat\(([^)]+)\)',
            r'readString\(([^,]+),\s*(\d+)\)'
        ]
        
        for pattern in patterns:
            matches = re.finditer(pattern, script_content)
            for match in matches:
                reads.append({
                    'address': match.group(1).strip(),
                    'size': int(match.group(2)) if len(match.groups()) > 1 else 4,
                    'type': 'bytes' if 'Bytes' in pattern else 'integer'
                })
        
        return reads
    
    def _extract_memory_writes(self, script_content: str) -> List[Dict[str, Any]]:
        """Extract memory write operations from script"""
        writes = []
        
        # Look for write operations (for analysis only - not executed)
        patterns = [
            r'writeBytes\(([^,]+),\s*([^)]+)\)',
            r'writeInteger\(([^,]+),\s*([^)]+)\)',
            r'writeFloat\(([^,]+),\s*([^)]+)\)'
        ]
        
        for pattern in patterns:
            matches = re.finditer(pattern, script_content)
            for match in matches:
                writes.append({
                    'address': match.group(1).strip(),
                    'value': match.group(2).strip(),
                    'type': 'bytes' if 'Bytes' in pattern else 'integer'
                })
        
        return writes
    
    def _extract_address_calculations(self, script_content: str) -> List[Dict[str, Any]]:
        """Extract address calculation patterns"""
        calculations = []
        
        # Look for pointer arithmetic patterns
        pointer_patterns = [
            r'getAddress\(([^)]+)\)',
            r'(\w+)\s*\+\s*0x([0-9A-Fa-f]+)',
            r'\[\[([^\]]+)\]\s*\+\s*0x([0-9A-Fa-f]+)\]'
        ]
        
        for pattern in pointer_patterns:
            matches = re.finditer(pattern, script_content)
            for match in matches:
                calculations.append({
                    'expression': match.group(0),
                    'base': match.group(1) if len(match.groups()) > 0 else None,
                    'offset': match.group(2) if len(match.groups()) > 1 else None
                })
        
        return calculations
    
    def get_script_summary(self, script: LuaScript) -> Dict[str, Any]:
        """Get a summary of the script analysis"""
        return {
            'name': script.name,
            'safe_to_execute': script.safe_to_execute,
            'variable_count': len(script.variables),
            'function_count': len(script.functions),
            'dependency_count': len(script.dependencies),
            'content_length': len(script.content),
            'variables': script.variables[:10],  # First 10 variables
            'functions': script.functions,
            'dependencies': script.dependencies
        }
