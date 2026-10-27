# YaraFlux Examples

This document provides practical examples and complete workflows for common YaraFlux use cases.

## Basic Workflows

### 1. Simple Malware Detection

Create and test a basic malware detection rule:

```bash
# Create the malware detection rule
yaraflux rules create basic_malware --content '
rule basic_malware {
    meta:
        description = "Basic malware detection"
        author = "YaraFlux"
        date = "2025-03-07"
    strings:
        $cmd = "cmd.exe /c" nocase
        $ps = "powershell.exe -enc" nocase
        $url = /https?:\/\/[^\s\/$.?#].[^\s]*/ nocase
    condition:
        any of them
}'

# Create a test file
echo 'cmd.exe /c "ping malicious.com"' > test_malware.txt

# Scan the test file
yaraflux scan url file://test_malware.txt --rules basic_malware
```

### 2. File Type Detection

Identify specific file types using header signatures:

```bash
# Create file type detection rules
yaraflux rules create file_types --content '
rule detect_pdf {
    meta:
        description = "Detect PDF files"
    strings:
        $header = { 25 50 44 46 } // %PDF
    condition:
        $header at 0
}

rule detect_png {
    meta:
        description = "Detect PNG files"
    strings:
        $header = { 89 50 4E 47 0D 0A 1A 0A }
    condition:
        $header at 0
}'

# Scan multiple files
yaraflux scan url https://example.com/unknown.file --rules file_types
```

## Advanced Use Cases

### 1. Cryptocurrency Miner Detection

```bash
# Create the crypto miner detection rule
yaraflux rules create crypto_miner --content '
rule crypto_miner {
    meta:
        description = "Detect cryptocurrency mining indicators"
        author = "YaraFlux"
    strings:
        $pool1 = "stratum+tcp://" nocase
        $pool2 = "pool.minergate.com" nocase
        $wallet = /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/ // Bitcoin address
        $libs = "libcuda" nocase
        $process = "xmrig" nocase
    condition:
        2 of them
}'

# Test with sample data
echo 'stratum+tcp://pool.minergate.com:3333' > miner_config.txt
yaraflux scan url file://miner_config.txt --rules crypto_miner
```

### 2. Multiple Rule Sets with Dependencies

```bash
# Create shared patterns
yaraflux rules create shared_patterns --content '
private rule FileHeaders {
    strings:
        $mz = { 4D 5A }
        $elf = { 7F 45 4C 46 }
    condition:
        $mz at 0 or $elf at 0
}'

# Create main detection rule
yaraflux rules create exec_scanner --content '
rule exec_scanner {
    meta:
        description = "Scan executable files"
    condition:
        FileHeaders and
        filesize < 10MB
}'

# Scan files
yaraflux scan url https://example.com/suspicious.exe --rules exec_scanner
```

## Batch Processing

### 1. Scan Multiple URLs

```bash
#!/bin/bash
# scan_urls.sh

# Create URLs file
cat > urls.txt << EOF
https://example.com/file1.exe
https://example.com/file2.dll
https://example.com/file3.pdf
EOF

# Scan each URL
while read -r url; do
    yaraflux scan url "$url" --rules "exec_scanner,crypto_miner"
done < urls.txt
```

### 2. Rule Import and Management

```bash
# Import community rules
yaraflux rules import --url https://github.com/threatflux/yara-rules --branch main

# List imported rules
yaraflux rules list --source community

# Create rule set combining custom and community rules
yaraflux rules create combined_check --content '
include "community/malware.yar"

rule custom_check {
    meta:
        description = "Custom check with community rules"
    condition:
        community_malware_rule and
        filesize < 5MB
}'
```

## MCP Integration Examples

### 1. Using MCP Tools Programmatically

```python
from yarafluxclient import YaraFluxClient

# Initialize client
client = YaraFluxClient("http://localhost:8000")

# List available MCP tools
tools = client.get_mcp_tools()
print(tools)

# Create rule using MCP
params = {
    "name": "test_rule",
    "content": 'rule test { condition: true }',
    "source": "custom"
}
result = client.invoke_mcp_tool("add_yara_rule", params)
print(result)
```

### 2. Batch Scanning with MCP

```python
import base64
from yarafluxclient import YaraFluxClient

def scan_files(files, rules):
    client = YaraFluxClient("http://localhost:8000")
    results = []
    
    for file_path in files:
        with open(file_path, 'rb') as f:
            data = base64.b64encode(f.read()).decode()
        
        params = {
            "data": data,
            "filename": file_path,
            "encoding": "base64",
            "rule_names": rules
        }
        
        result = client.invoke_mcp_tool("scan_data", params)
        results.append(result)
    
    return results

# Usage
files = ["test1.exe", "test2.dll"]
rules = ["exec_scanner", "crypto_miner"]
results = scan_files(files, rules)
```

## Real-World Scenarios

### 1. Malware Triage

```bash
# Create comprehensive malware detection ruleset
yaraflux rules create malware_triage --content '
rule malware_indicators {
    meta:
        description = "Common malware indicators"
        author = "YaraFlux"
        severity = "high"
    
    strings:
        // Process manipulation
        $proc1 = "CreateRemoteThread" nocase
        $proc2 = "VirtualAllocEx" nocase
        
        // Network activity
        $net1 = "InternetOpenUrl" nocase
        $net2 = "URLDownloadToFile" nocase
        
        // File operations
        $file1 = "WriteProcessMemory" nocase
        $file2 = "CreateFileMapping" nocase
        
        // Registry manipulation
        $reg1 = "RegCreateKeyEx" nocase
        $reg2 = "RegSetValueEx" nocase
        
        // Command execution
        $cmd1 = "WScript.Shell" nocase
        $cmd2 = "ShellExecute" nocase
    
    condition:
        (2 of ($proc*)) or
        (2 of ($net*)) or
        (2 of ($file*)) or
        (2 of ($reg*)) or
        (2 of ($cmd*))
}'

# Scan suspicious files
yaraflux scan url https://malware.example.com/sample.exe --rules malware_triage
```

### 2. Continuous Monitoring

```bash
#!/bin/bash
# monitor.sh

WATCH_DIR="/path/to/monitor"
RULES="malware_triage,exec_scanner,crypto_miner"
LOG_FILE="yaraflux_monitor.log"

inotifywait -m -e create -e modify "$WATCH_DIR" |
while read -r directory events filename; do
    file_path="$directory$filename"
    echo "[$(date)] Scanning: $file_path" >> "$LOG_FILE"
    
    yaraflux scan url "file://$file_path" --rules "$RULES" >> "$LOG_FILE"
done
```

## Integration Examples

### 1. CI/CD Pipeline Integration

```yaml
# .gitlab-ci.yml
stages:
  - security

yara_scan:
  stage: security
  script:
    - |
      yaraflux rules create ci_check --content '
      rule ci_security_check {
          meta:
              description = "CI/CD Security Checks"
          strings:
              $secret1 = /(\"|\')?[0-9a-f]{32}(\"|\')?/
              $secret2 = /(\"|\')?[0-9a-f]{40}(\"|\')?/
              $aws = /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/
          condition:
              any of them
      }'
    - for file in $(git diff --name-only HEAD~1); do
        yaraflux scan url "file://$file" --rules ci_check;
      done
```

### 2. Incident Response Integration

```python
# incident_response.py
from yarafluxclient import YaraFluxClient
import sys
import json

def analyze_artifact(file_path):
    client = YaraFluxClient("http://localhost:8000")
    
    # Scan with multiple rule sets
    rules = ["malware_triage", "crypto_miner", "exec_scanner"]
    
    with open(file_path, 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    
    params = {
        "data": data,
        "filename": file_path,
        "encoding": "base64",
        "rule_names": rules
    }
    
    result = client.invoke_mcp_tool("scan_data", params)
    
    # Generate incident report
    report = {
        "artifact": file_path,
        "scan_time": result["scan_time"],
        "matches": result["matches"],
        "indicators": len(result["matches"]),
        "severity": "high" if result["match_count"] > 2 else "medium"
    }
    
    return report

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python incident_response.py <artifact_path>")
        sys.exit(1)
    
    report = analyze_artifact(sys.argv[1])
    print(json.dumps(report, indent=2))
