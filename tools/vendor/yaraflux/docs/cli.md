# CLI Usage Guide

The YaraFlux CLI provides a comprehensive interface for managing YARA rules and performing scans.

## Global Options

```
--url URL             YaraFlux server URL (default: http://localhost:8000)
--username USER       Username for authentication
--password PASS      Password for authentication
--token TOKEN        JWT token for authentication
--timeout SECONDS    Request timeout (default: 30s)
--output json|pretty  Output format
--debug              Enable debug logging
```

## Authentication

Login and obtain a JWT token:
```bash
yaraflux auth login --username USER --password PASS
```

## YARA Rules Management

### List Rules
```bash
yaraflux rules list [--source custom|community]
```

### Get Rule Details
```bash
yaraflux rules get NAME [--source custom|community] [--raw]
```

### Create New Rule
```bash
# From file
yaraflux rules create NAME --file path/to/rule.yar [--source custom|community]

# From content
yaraflux rules create NAME --content 'rule example { condition: true }' [--source custom|community]
```

### Update Rule
```bash
yaraflux rules update NAME --file path/to/rule.yar [--source custom|community]
```

### Delete Rule
```bash
yaraflux rules delete NAME [--source custom|community]
```

### Validate Rule
```bash
yaraflux rules validate --file path/to/rule.yar
```

### Import Rules
```bash
yaraflux rules import --url GITHUB_URL [--branch BRANCH]
```

## Scanning

### Scan URL
```bash
yaraflux scan url URL [--rules RULE1,RULE2] [--timeout SECONDS]
```

### Get Scan Result
```bash
yaraflux scan result SCAN_ID
```

## MCP Integration

### List MCP Tools
```bash
yaraflux mcp tools
```

### Invoke MCP Tool
```bash
yaraflux mcp invoke TOOL --params '{"param1": "value1"}'
```

## Examples

### Working with Rules

1. Create a basic YARA rule:
```bash
yaraflux rules create test_malware --content '
rule test_malware {
    meta:
        description = "Test rule for malware detection"
        author = "YaraFlux"
    strings:
        $suspicious = "malware" nocase
    condition:
        $suspicious
}'
```

2. List all custom rules:
```bash
yaraflux rules list --source custom
```

3. Validate a rule file:
```bash
yaraflux rules validate --file malware_detection.yar
```

### Scanning Files

1. Scan a file from URL:
```bash
yaraflux scan url https://example.com/suspicious.exe --rules test_malware
```

2. Check scan results:
```bash
yaraflux scan result abc123-scan-id
```

## Environment Variables

The CLI supports configuration via environment variables:

```bash
export YARAFLUX_URL="http://localhost:8000"
export YARAFLUX_USERNAME="admin"
export YARAFLUX_PASSWORD="password"
export YARAFLUX_TOKEN="jwt-token"
```

## Output Formats

### Pretty (Default)
```bash
yaraflux rules list --output pretty
```

### JSON
```bash
yaraflux rules list --output json
```

## Error Handling

The CLI provides descriptive error messages and appropriate exit codes:

- Authentication errors (401)
- Permission errors (403)
- Not found errors (404)
- Validation errors (400)
- Server errors (500)

Example error output:
```
Error: Failed to create rule - Invalid rule syntax at line 3
```

## Scripting

The JSON output format makes it easy to use the CLI in scripts:

```bash
# Get rule names
rules=$(yaraflux rules list --output json | jq -r '.[].name')

# Scan multiple URLs
while read -r url; do
    yaraflux scan url "$url" --rules "$rules"
done < urls.txt
