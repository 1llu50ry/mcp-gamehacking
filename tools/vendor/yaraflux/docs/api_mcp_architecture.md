# YaraFlux: Separated API and MCP Architecture

This document describes the separation of YaraFlux into two dedicated containers:
1. **API Container**: Provides a FastAPI backend with all YARA functionality
2. **MCP Client Container**: Implements the Model Context Protocol interface, forwarding requests to the API

## Architecture Overview

```
+------------------------------------------+
|              AI Assistant                |
+--------------------+---------------------+
                    |
                    | Model Context Protocol
                    |
+--------------------v---------------------+
|          MCP Client Container            |
|                                          |
|  +----------------+    +---------------+ |
|  | MCP Server     |    | HTTP Client   | |
|  +-------+--------+    +-------+-------+ |
|          |                     |         |
+----------+---------------------+---------+
           |                     |
           | Tool Requests       | HTTP API Calls
           |                     |
+----------v---------------------v---------+
|            API Container                 |
|                                          |
|  +----------------+    +---------------+ |
|  | FastAPI Server |    | YARA Service  | |
|  +-------+--------+    +-------+-------+ |
|          |                     |         |
|  +-------v--------+    +-------v-------+ |
|  | Auth Service   |    | Storage Layer | |
|  +----------------+    +---------------+ |
|                                          |
+------------------------------------------+
            |                 |
            v                 v
     +-------------+    +-------------+
     | YARA Engine |    | File Storage|
     +-------------+    +-------------+
```

## Container Design

### API Container

The API Container exposes a RESTful API with the following features:
- JWT authentication for secure access
- Full YARA rule management
- File upload and scanning
- Storage management
- Detailed results and analytics

This container runs independently and can be used by any client that can make HTTP requests.

### MCP Client Container

The MCP Client Container:
- Implements the Model Context Protocol
- Acts as a thin client to the API Container
- Translates MCP tool calls into API requests
- Passes responses back to the AI assistant
- No direct YARA or storage functionality

## Implementation Steps

1. **API Container**:
   - Use the existing FastAPI implementation
   - Expose all YARA and file functionality via endpoints
   - Ensure proper documentation and error handling
   - Store configuration as environment variables
   - Make all endpoints accessible via REST API

2. **MCP Client Container**:
   - Create a lightweight MCP server
   - Implement tool wrappers that call the API
   - Handle authentication to the API
   - Configure connection details via environment variables
   - Forward all operations to the API container

## Communication Flow

1. **AI to MCP Client**:
   - AI assistant calls MCP tool (e.g., "scan_data")
   - MCP client processes parameters

2. **MCP Client to API**:
   - MCP client translates tool call to HTTP request
   - Makes authenticated API call to API container

3. **API to Storage & YARA**:
   - API executes the requested operation
   - Performs file/YARA operations as needed
   - Generates response with results

4. **Response Flow**:
   - API returns HTTP response to MCP client
   - MCP client formats response for MCP protocol
   - AI assistant receives results

## Benefits

- **Modularity**: Each container has a single responsibility
- **Scalability**: API container can scale independently of MCP clients
- **Maintainability**: Easier to update each component separately
- **Versatility**: API can be used by multiple clients (web UI, CLI, MCP)
- **Security**: Better isolation between components

## Docker Compose Configuration

A Docker Compose file can be used to start both containers together with proper networking:

```yaml
version: '3'
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      - JWT_SECRET_KEY=your-secret-key
      - ADMIN_PASSWORD=your-admin-password
      - DEBUG=true
    volumes:
      - yara_data:/app/data
    ports:
      - "8000:8000"

  mcp:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    environment:
      - API_URL=http://api:8000
      - API_USERNAME=admin
      - API_PASSWORD=your-admin-password
    depends_on:
      - api

volumes:
  yara_data:
```

This architecture provides a more robust and maintainable design for the YaraFlux system, allowing it to grow and adapt to different usage patterns.
