# Installation Guide

## Prerequisites

- Python 3.11 or higher
- uv package manager (recommended) or pip
- Docker (optional, for containerized deployment)

## Method 1: Local Installation

### 1. Clone the Repository

```bash
git clone https://github.com/ThreatFlux/YaraFlux.git
cd YaraFlux
```

### 2. Install Dependencies

Using uv (recommended):
```bash
make install        # Basic installation
make dev-setup     # Development installation with additional tools
```

Using pip:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .                # Basic installation
pip install -e ".[dev]"        # Development installation
```

For a reproducible environment matching the Docker image and CI security scan,
install from the hash-pinned locks instead:
```bash
pip install --require-hashes -r requirements-lock.txt      # Runtime set
pip install --require-hashes -r requirements-dev-lock.txt  # Runtime + dev set
pip install --no-deps -e .
```

If you change dependencies in `pyproject.toml` or `requirements.txt`, run
`make lock-requirements` and commit the regenerated lock files — CI fails when
they drift.

## Method 2: Docker Installation

### 1. Build the Image

```bash
make docker-build
```

### 2. Run the Container

```bash
make docker-run
```

Or manually with custom configuration:
```bash
docker run -p 8000:8000 \
  -e JWT_SECRET_KEY=your_jwt_secret_key \
  -e ADMIN_PASSWORD=your_admin_password \
  threatflux/yaraflux-mcp-server:latest
```

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
JWT_SECRET_KEY=your_jwt_secret_key
ADMIN_PASSWORD=your_admin_password
DEBUG=true  # Optional, for development
```

### Development Tools

For development, additional tools are available:
```bash
make dev-setup     # Installs development dependencies
make format        # Formats code with black and isort
make lint          # Runs linters
make test          # Runs tests
make coverage      # Generates test coverage report
```

## Verifying Installation

1. Start the server:
```bash
make run
```

2. Test the installation:
```bash
# Create a test YARA rule
yaraflux rules create test_rule --content 'rule test { condition: true }'

# List rules
yaraflux rules list

# Scan a file
yaraflux scan url http://example.com/file.txt
```

## Troubleshooting

### Common Issues

1. **Command not found: yaraflux**
   - Ensure you're in an activated virtual environment
   - Verify installation with `pip list | grep yaraflux`

2. **ImportError: No module named 'yara'**
   - Install system dependencies: `apt-get install yara`
   - Reinstall yara-python: `pip install --force-reinstall yara-python`

3. **Permission denied when starting server**
   - Ensure proper permissions for the port (default: 8000)
   - Try running with sudo or use a different port

### Getting Help

- Check the logs: `tail -f yaraflux.log`
- Run with debug logging: `DEBUG=true make run`
- File an issue on GitHub if problems persist
