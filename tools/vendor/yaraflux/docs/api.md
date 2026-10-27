# API Reference

YaraFlux provides both a REST API and MCP (Model Context Protocol) integration for programmatic access.

## REST API

Base URL: `http://localhost:8000`

### Authentication

#### Login
```http
POST /auth/token
Content-Type: application/x-www-form-urlencoded

username=admin&password=password
```

Response:
```json
{
    "access_token": "eyJ0eXAi...",
    "token_type": "bearer"
}
```

All subsequent requests must include the Authorization header:
```http
Authorization: Bearer eyJ0eXAi...
```

### YARA Rules

#### List Rules
```http
GET /rules?source=custom
```

Response:
```json
[
    {
        "name": "test_malware.yar",
        "source": "custom",
        "author": "YaraFlux",
        "description": "Test rule for malware detection",
        "created": "2025-03-07T17:08:15.593061",
        "modified": "2025-03-07T17:08:15.593061",
        "tags": [],
        "is_compiled": true
    }
]
```

#### Get Rule
```http
GET /rules/{name}?source=custom
```

Response:
```json
{
    "name": "test_malware",
    "source": "custom",
    "content": "rule test_malware {...}",
    "metadata": {}
}
```

#### Create Rule
```http
POST /rules
Content-Type: application/json

{
    "name": "new_rule",
    "content": "rule new_rule { condition: true }",
    "source": "custom"
}
```

Response:
```json
{
    "success": true,
    "message": "Rule new_rule added successfully",
    "metadata": {...}
}
```

#### Update Rule
```http
PUT /rules/{name}
Content-Type: application/json

{
    "content": "rule updated_rule { condition: true }",
    "source": "custom"
}
```

#### Delete Rule
```http
DELETE /rules/{name}?source=custom
```

#### Validate Rule
```http
POST /rules/validate
Content-Type: application/json

{
    "content": "rule test { condition: true }"
}
```

### Scanning

#### Scan URL
```http
POST /scan/url
Content-Type: application/json

{
    "url": "https://example.com/file.txt",
    "rule_names": ["test_rule"],
    "timeout": 30
}
```

Response:
```json
{
    "success": true,
    "scan_id": "abc123-scan-id",
    "file_name": "file.txt",
    "file_size": 1234,
    "file_hash": "sha256hash",
    "scan_time": 0.5,
    "timeout_reached": false,
    "matches": [
        {
            "rule": "test_rule",
            "namespace": "default",
            "tags": [],
            "meta": {},
            "strings": []
        }
    ],
    "match_count": 1
}
```

#### Get Scan Result
```http
GET /scan/result/{scan_id}
```

## MCP Integration

YaraFlux exposes its functionality through MCP tools and resources.

### Tools

#### list_yara_rules
List available YARA rules.

```json
{
    "source": "custom"  // optional
}
```

#### get_yara_rule
Get a YARA rule's content.

```json
{
    "rule_name": "test_rule",
    "source": "custom"
}
```

#### validate_yara_rule
Validate a YARA rule.

```json
{
    "content": "rule test { condition: true }"
}
```

#### add_yara_rule
Add a new YARA rule.

```json
{
    "name": "new_rule",
    "content": "rule new_rule { condition: true }",
    "source": "custom"
}
```

#### update_yara_rule
Update an existing YARA rule.

```json
{
    "name": "existing_rule",
    "content": "rule existing_rule { condition: true }",
    "source": "custom"
}
```

#### delete_yara_rule
Delete a YARA rule.

```json
{
    "name": "rule_to_delete",
    "source": "custom"
}
```

#### scan_url
Scan a file from a URL.

```json
{
    "url": "https://example.com/file.txt",
    "rule_names": ["test_rule"],
    "sources": ["custom"],
    "timeout": 30
}
```

#### scan_data
Scan in-memory data.

```json
{
    "data": "base64_encoded_data",
    "filename": "test.txt",
    "encoding": "base64",
    "rule_names": ["test_rule"],
    "sources": ["custom"],
    "timeout": 30
}
```

#### get_scan_result
Get a scan result.

```json
{
    "scan_id": "abc123-scan-id"
}
```

### Error Handling

All endpoints return standard HTTP status codes:

- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

Error Response Format:
```json
{
    "detail": "Error description"
}
```

### Rate Limiting

- API requests are rate limited to protect server resources
- Limits are configurable in server settings
- Rate limit headers are included in responses:
  ```http
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 99
  X-RateLimit-Reset: 1583851200
  ```

### Versioning

The API uses semantic versioning. The current version is included in responses:
```http
X-API-Version: 0.1.0
