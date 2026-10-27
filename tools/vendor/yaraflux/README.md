# YaraFlux MCP Server
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/ThreatFlux/YaraFlux)](https://github.com/ThreatFlux/YaraFlux/releases)
[![CI](https://github.com/ThreatFlux/YaraFlux/workflows/CI/badge.svg)](https://github.com/ThreatFlux/YaraFlux/actions)
[![codecov](https://codecov.io/gh/ThreatFlux/YaraFlux/branch/main/graph/badge.svg)](https://codecov.io/gh/ThreatFlux/YaraFlux)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/8f7728ae613540938411196abe4359f6)](https://app.codacy.com/gh/ThreatFlux/YaraFlux/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/python-3.13-blue)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104.1-009688)](https://fastapi.tiangolo.com/)
[![MCP](https://img.shields.io/badge/MCP-Integrated-blueviolet)](https://docs.anthropic.com/claude/docs/model-context-protocol)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

A Model Context Protocol (MCP) server for YARA scanning, providing LLMs with capabilities to analyze files with YARA rules.

## 📋 Overview

YaraFlux MCP Server enables AI assistants to perform YARA rule-based threat analysis through the standardized Model Context Protocol interface. The server integrates YARA scanning with modern AI assistants, supporting comprehensive rule management, secure scanning, and detailed result analysis through a modular architecture.

## 🧩 Architecture Overview

```
+------------------------------------------+
|              AI Assistant                |
+--------------------+---------------------+
                    |
                    | Model Context Protocol
                    |
+--------------------v---------------------+
|              YaraFlux MCP Server         |
|                                          |
|  +----------------+    +---------------+ |
|  | MCP Server     |    | Tool Registry | |
|  +-------+--------+    +-------+-------+ |
|          |                     |         |
|  +-------v--------+    +-------v-------+ |
|  | YARA Service   |    | Storage Layer | |
|  +----------------+    +---------------+ |
|                                          |
+------------------------------------------+
          |                   |
 +-----------------+  +---------------+
 | YARA Engine     |  | Storage       |
 | - Rule Compiling|  | - Local FS    |
 | - File Scanning |  | - MinIO/S3    |
 +-----------------+  +---------------+
```

YaraFlux follows a modular architecture that separates concerns between:
- **MCP Integration Layer**: Handles communication with AI assistants
- **Tool Implementation Layer**: Implements YARA scanning and management functionality
- **Storage Abstraction Layer**: Provides flexible storage options
- **YARA Engine Integration**: Leverages YARA for scanning and rule management

For detailed architecture diagrams, see the [Architecture Documentation](docs/architecture_diagram.md).

## ✨ Features

- 🔄 **Modular Architecture**
  - Clean separation of MCP integration, tool implementation, and storage
  - Standardized parameter parsing and error handling
  - Flexible storage backend with local and S3/MinIO options

- 🤖 **MCP Integration**
  - 19 integrated MCP tools for comprehensive functionality
  - Optimized for Claude Desktop integration
  - Direct file analysis from within conversations
  - Compatible with latest MCP protocol specification

- 🔍 **YARA Scanning**
  - URL and file content scanning
  - Detailed match information with context
  - Scan result storage and retrieval
  - Performance-optimized scanning engine

- 📝 **Rule Management**
  - Create, read, update, delete YARA rules
  - Rule validation with detailed error reporting
  - Import rules from ThreatFlux repository
  - Categorization by source (custom vs. community)

- 📊 **File Analysis**
  - Hexadecimal view for binary analysis
  - String extraction with configurable parameters
  - File metadata and hash information
  - Secure file upload and storage

- 🔐 **Security Features**
  - JWT authentication for API access
  - Non-root container execution
  - Secure storage isolation
  - Configurable access controls

## 🚀 Quick Start
### Using Docker Image

```bash
# Pull the latest Docker image
docker pull threatflux/yaraflux-mcp-server:latest
# Run the container
docker run -p 8000:8000 \
  -e JWT_SECRET_KEY=your-secret-key \
  -e ADMIN_PASSWORD=your-admin-password \
  -e DEBUG=true \
  threatflux/yaraflux-mcp-server:latest
### Using Docker building from source

```bash
# Clone the repository
git clone https://github.com/ThreatFlux/YaraFlux.git
cd YaraFlux/

# Build the Docker image
docker build -t yaraflux-mcp-server:latest .

# Run the container
docker run -p 8000:8000 \
  -e JWT_SECRET_KEY=your-secret-key \
  -e ADMIN_PASSWORD=your-admin-password \
  -e DEBUG=true \
  yaraflux-mcp-server:latest
```

### Installation from Source

```bash
# Clone the repository
git clone https://github.com/ThreatFlux/YaraFlux.git
cd YaraFlux/

# Install dependencies (requires Python 3.13+)
make install

# Run the server
make run
```

### Dependency Locking

Docker images and the CI vulnerability scan install from `requirements-lock.txt`
and `requirements-dev-lock.txt` — hash-pinned locks compiled from
`pyproject.toml` (constrained by `requirements.txt`). `pyproject.toml` is the
single source of truth for dependencies: runtime ones under `dependencies`,
development ones under the `dev` extra (`pip install -e ".[dev]"`). After
changing dependencies there or in `requirements.txt`, regenerate the locks:

```bash
make lock-requirements
```

Commit the updated lock files with your change; CI fails if they drift from
`pyproject.toml`.

## 🧩 Claude Desktop Integration

YaraFlux is designed for seamless integration with Claude Desktop through the Model Context Protocol.

1. Build the Docker image:
```bash
docker build -t yaraflux-mcp-server:latest .
```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "yaraflux-mcp-server": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--env",
        "JWT_SECRET_KEY=your-secret-key",
        "--env",
        "ADMIN_PASSWORD=your-admin-password",
        "--env",
        "DEBUG=true",
        "--env",
        "PYTHONUNBUFFERED=1",
        "threatflux/yaraflux-mcp-server:latest"
      ],
      "disabled": false,
      "autoApprove": [
        "scan_url",
        "scan_data",
        "list_yara_rules",
        "get_yara_rule"
      ]
    }
  }
}
```

3. Restart Claude Desktop to activate the server.

## 🛠️ Available MCP Tools

YaraFlux exposes 19 integrated MCP tools:

### Rule Management Tools
- **list_yara_rules**: List available YARA rules with filtering options
- **get_yara_rule**: Get a specific YARA rule's content and metadata
- **validate_yara_rule**: Validate YARA rule syntax with detailed error reporting
- **add_yara_rule**: Create a new YARA rule
- **update_yara_rule**: Update an existing YARA rule
- **delete_yara_rule**: Delete a YARA rule
- **import_threatflux_rules**: Import rules from ThreatFlux GitHub repository

### Scanning Tools
- **scan_url**: Scan content from a URL with specified YARA rules
- **scan_data**: Scan provided data (base64 encoded) with specified rules
- **get_scan_result**: Retrieve detailed results from a previous scan

### File Management Tools
- **upload_file**: Upload a file for analysis or scanning
- **get_file_info**: Get metadata about an uploaded file
- **list_files**: List uploaded files with pagination and sorting
- **delete_file**: Delete an uploaded file
- **extract_strings**: Extract ASCII/Unicode strings from a file
- **get_hex_view**: Get hexadecimal view of file content
- **download_file**: Download an uploaded file

### Storage Management Tools
- **get_storage_info**: Get storage usage statistics
- **clean_storage**: Remove old files to free up storage space

## 📚 Documentation

Comprehensive documentation is available in the [docs/](docs/) directory:

- [Architecture Diagrams](docs/architecture_diagram.md) - Visual representation of system architecture
- [Code Analysis](docs/code_analysis.md) - Detailed code structure and recommendations
- [Installation Guide](docs/installation.md) - Detailed setup instructions
- [CLI Usage Guide](docs/cli.md) - Command-line interface documentation
- [API Reference](docs/api.md) - REST API endpoints and usage
- [YARA Rules Guide](docs/yara_rules.md) - Creating and managing YARA rules
- [MCP Integration](docs/mcp.md) - Model Context Protocol integration details
- [File Management](docs/file_management.md) - File handling capabilities
- [Examples](docs/examples.md) - Real-world usage examples

## 🗂️ Project Structure

```
yaraflux_mcp_server/
├── src/
│   └── yaraflux_mcp_server/
│       ├── app.py                 # FastAPI application
│       ├── auth.py                # JWT authentication and user management
│       ├── config.py              # Configuration settings loader
│       ├── models.py              # Pydantic models for requests/responses
│       ├── mcp_server.py          # MCP server implementation
│       ├── utils/                 # Utility functions package
│       │   ├── __init__.py        # Package initialization
│       │   ├── error_handling.py  # Standardized error handling
│       │   ├── param_parsing.py   # Parameter parsing utilities
│       │   └── wrapper_generator.py # Tool wrapper generation
│       ├── mcp_tools/             # Modular MCP tools package
│       │   ├── __init__.py        # Package initialization
│       │   ├── base.py            # Base tool registration utilities
│       │   ├── file_tools.py      # File management tools
│       │   ├── rule_tools.py      # YARA rule management tools
│       │   ├── scan_tools.py      # Scanning tools
│       │   └── storage_tools.py   # Storage management tools
│       ├── storage/               # Storage implementation package
│       │   ├── __init__.py        # Package initialization
│       │   ├── base.py            # Base storage interface
│       │   ├── factory.py         # Storage client factory
│       │   ├── local.py           # Local filesystem storage
│       │   └── minio.py           # MinIO/S3 storage
│       ├── routers/               # API route definitions
│       │   ├── __init__.py        # Package initialization
│       │   ├── auth.py            # Authentication API routes
│       │   ├── files.py           # File management API routes
│       │   ├── rules.py           # YARA rule management API routes
│       │   └── scan.py            # YARA scanning API routes
│       ├── yara_service.py        # YARA rule management and scanning
│       ├── __init__.py            # Package initialization
│       └── __main__.py            # CLI entry point
├── docs/                          # Documentation
├── tests/                         # Test suite
├── Dockerfile                     # Docker configuration
├── entrypoint.sh                  # Container entrypoint script
├── Makefile                       # Build automation
├── pyproject.toml                 # Project metadata, runtime deps, and the `dev` extra
├── requirements.txt               # Core dependency floors (also constrains the locks)
├── requirements-lock.txt          # Hash-pinned runtime lock (Docker build + security scan)
└── requirements-dev-lock.txt      # Hash-pinned runtime + dev lock (test image + security scan)
```

## 🧪 Development

### Local Development

```bash
# Set up development environment
make dev-setup

# Run tests
make test

# Code quality checks
make lint
make format
make security-check

# Generate test coverage report
make coverage

# Run development server
make run
```

### CI/CD Workflows

This project uses GitHub Actions for continuous integration and deployment:

- **CI Tests**: Runs on every push and pull request to main and develop branches
  - Runs tests, formatting, linting, and type checking
  - Builds and tests Docker images
  - Uploads test coverage reports to Codecov

- **Version Auto-increment**: Automatically increments version on pushes to main branch
  - Updates version in pyproject.toml, setup.py, and Dockerfile
  - Creates git tag for new version

- **Publish Release**: Triggered after successful version auto-increment
  - Builds Docker images for multiple stages
  - Generates release notes from git commits
  - Creates GitHub release with artifacts
  - Publishes Docker images to Docker Hub

These workflows ensure code quality and automate the release process.

### Status Checks

The following status checks run on pull requests:

- ✅ **Format Verification**: Ensures code follows Black and isort formatting standards
- ✅ **Lint Verification**: Validates code quality and compliance with coding standards
- ✅ **Test Execution**: Runs the full test suite to verify functionality
- ✅ **Coverage Report**: Ensures sufficient test coverage of the codebase

## 🌐 API Documentation

Interactive API documentation available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

For detailed API documentation, see [API Reference](docs/api.md).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💖 Donate or Ask for Features

- [Patreon](https://patreon.com/vtriple)
- [PayPal](https://paypal.me/ThreatFlux)
