.PHONY: all clean install dev-setup test lint format build docker-build docker-run docker-test docker-coverage mypy security-check coverage run import-rules lock lock-requirements sync check-deps get-version bump-version

# Default target
all: clean install test lint

# Python settings
UV = uv
PYTHON_VERSION = 3.13
VENV = .venv

# Docker settings
IMAGE_NAME = threatflux/yaraflux-mcp-server
VERSION = $(shell cat src/yaraflux_mcp_server/__init__.py | grep __version__ | sed -e "s/__version__ = \"\(.*\)\"/\1/")
DOCKER_TAG = $(IMAGE_NAME):$(VERSION)
CONTAINER_NAME = yaraflux-mcp-test-container
HEALTH_CHECK_TIMEOUT = 30

# Version management
VERSION = $(shell cat src/yaraflux_mcp_server/__init__.py | grep __version__ | sed -e "s/__version__ = \"\(.*\)\"/\1/")
MAJOR = $(shell echo $(VERSION) | cut -d. -f1)
MINOR = $(shell echo $(VERSION) | cut -d. -f2)
PATCH = $(shell echo $(VERSION) | cut -d. -f3)
NEW_PATCH = $(shell expr $(PATCH) + 1)
NEW_VERSION = $(MAJOR).$(MINOR).$(NEW_PATCH)

# System detection
OS = $(shell uname -s)
ifeq ($(OS),Linux)
    PACKAGE_MANAGER = $(shell command -v apt-get >/dev/null 2>&1 && echo "apt" || (command -v yum >/dev/null 2>&1 && echo "yum" || echo "unknown"))
endif

# Check dependencies
check-deps:
	@echo "Checking system dependencies..."
	@if [ "$(OS)" = "Linux" ]; then \
		if [ "$(PACKAGE_MANAGER)" = "apt" ]; then \
			if ! dpkg -l | grep -q "python$(PYTHON_VERSION)-dev"; then \
				echo "Python $(PYTHON_VERSION) development package is missing. Installing..."; \
				sudo apt-get update && sudo apt-get install -y python$(PYTHON_VERSION)-dev; \
			else \
				echo "Python $(PYTHON_VERSION) development package is already installed."; \
			fi; \
			if ! dpkg -l | grep -q "build-essential"; then \
				echo "build-essential is missing. Installing..."; \
				sudo apt-get update && sudo apt-get install -y build-essential; \
			fi; \
			if ! dpkg -l | grep -q "libssl-dev"; then \
				echo "libssl-dev is missing. Installing..."; \
				sudo apt-get update && sudo apt-get install -y libssl-dev; \
			fi; \
			if ! dpkg -l | grep -q "libyara-dev"; then \
				echo "libyara-dev is missing. Installing..."; \
				sudo apt-get update && sudo apt-get install -y libyara-dev; \
			fi; \
		elif [ "$(PACKAGE_MANAGER)" = "yum" ]; then \
			if ! rpm -qa | grep -q "python$(PYTHON_VERSION)-devel"; then \
				echo "Python $(PYTHON_VERSION) development package is missing. Installing..."; \
				sudo yum install -y python$(PYTHON_VERSION)-devel; \
			else \
				echo "Python $(PYTHON_VERSION) development package is already installed."; \
			fi; \
			if ! rpm -qa | grep -q "gcc"; then \
				echo "gcc is missing. Installing..."; \
				sudo yum install -y gcc; \
			fi; \
			if ! rpm -qa | grep -q "openssl-devel"; then \
				echo "openssl-devel is missing. Installing..."; \
				sudo yum install -y openssl-devel; \
			fi; \
			if ! rpm -qa | grep -q "yara-devel"; then \
				echo "yara-devel is missing. Trying to install..."; \
				sudo yum install -y yara-devel || echo "Warning: yara-devel not available. May need to build from source."; \
			fi; \
		else \
			echo "Unknown package manager. Please install Python $(PYTHON_VERSION) development package manually."; \
		fi; \
	elif [ "$(OS)" = "Darwin" ]; then \
		if ! command -v brew >/dev/null 2>&1; then \
			echo "Homebrew is not installed. Please install it from https://brew.sh/"; \
			exit 1; \
		fi; \
		if ! brew list python@$(PYTHON_VERSION) >/dev/null 2>&1; then \
			echo "Python $(PYTHON_VERSION) is missing. Installing..."; \
			brew install python@$(PYTHON_VERSION); \
		fi; \
		if ! brew list yara >/dev/null 2>&1; then \
			echo "Yara is missing. Installing..."; \
			brew install yara; \
		fi; \
		if ! brew list openssl >/dev/null 2>&1; then \
			echo "OpenSSL is missing. Installing..."; \
			brew install openssl; \
		fi; \
	else \
		echo "Unsupported OS. Please ensure you have Python $(PYTHON_VERSION) development packages installed."; \
	fi
	@echo "System dependency check complete."

# Installation
install: check-deps
	@echo "Creating virtual environment and installing dependencies..."
	@if command -v $(UV) >/dev/null 2>&1; then \
		echo "uv is already installed."; \
	else \
		echo "Installing uv..."; \
		if [ "$(OS)" = "Darwin" ] || [ "$(OS)" = "Linux" ]; then \
			curl -LsSf https://astral.sh/uv/install.sh | sh; \
		elif [ "$(OS)" = "Windows_NT" ]; then \
			powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"; \
		else \
			pip install uv; \
		fi; \
	fi
# ci.yml runs `make install` and then `make dev-setup`, and dev-setup declares
# install as a prerequisite -- so this target runs twice per job. uv >=0.12
# hard-errors on a second `uv venv` ("A virtual environment already exists"),
# which is what turned ci.yml red. --allow-existing reuses the venv in place:
# it keeps the packages the first pass installed (unlike --clear/UV_VENV_CLEAR,
# which would wipe them) and it still repairs a partial or broken .venv, which
# a plain `[ -d .venv ]` guard would silently hand to `uv pip install` to fail on.
	$(UV) venv --python $(PYTHON_VERSION) --allow-existing

	# Set environment variables for compilation if needed
	@if [ "$(OS)" = "Darwin" ] && brew --prefix openssl >/dev/null 2>&1; then \
		OPENSSL_DIR=$$(brew --prefix openssl) \
		$(UV) pip install -e .; \
	else \
		$(UV) pip install -e .; \
	fi
	@echo "Installation complete."

# Development setup
dev-setup: install
	@echo "Installing development dependencies..."
	$(UV) pip install -e ".[dev]"
	@echo "Ensuring PyJWT is installed..."
	$(UV) pip install PyJWT coverage
	$(UV) run pre-commit install
	@echo "Development setup complete."

# Generate lockfile for reproducible builds
lock: lock-requirements
	@echo "Generating lock file..."
	$(UV) lock
	@echo "Lock file generated."

# Regenerate the hash-pinned requirement locks consumed by the Docker build
# and the dependency vulnerability scan (.github/workflows/safety_scan.yml).
# requirements.txt is passed as a constraints file so its operational pins
# (bcrypt==4.3.0: passlib 1.7.4's bcrypt backend breaks on bcrypt>=5) carry
# into the locks without duplicating them. Output is byte-deterministic for a
# given uv version and lock state; CI's drift check pins uv, so use the same
# version it does (see safety_scan.yml) if the check complains.
lock-requirements:
	@command -v $(UV) >/dev/null 2>&1 || { \
		echo "error: '$(UV)' was not found on PATH."; \
		echo "  'make lock-requirements' compiles the locks with uv and cannot run without it."; \
		echo "  Install uv, then re-run. To match CI byte-for-byte, use the version"; \
		echo "  pinned by the lock-drift job in .github/workflows/safety_scan.yml:"; \
		echo "      pip install uv==<pinned-version>"; \
		echo "  or, for a standalone install:  curl -LsSf https://astral.sh/uv/install.sh | sh"; \
		exit 1; \
	}
	@echo "Regenerating hash-pinned requirement locks from pyproject.toml..."
	$(UV) pip compile pyproject.toml -c requirements.txt --universal --generate-hashes \
		--python-version $(PYTHON_VERSION) --custom-compile-command "make lock-requirements" \
		-o requirements-lock.txt
	$(UV) pip compile pyproject.toml -c requirements.txt --all-extras --universal --generate-hashes \
		--python-version $(PYTHON_VERSION) --custom-compile-command "make lock-requirements" \
		-o requirements-dev-lock.txt
	@echo "Requirement locks regenerated."

# Sync dependencies from lockfile
sync:
	@echo "Syncing dependencies from lock file..."
	$(UV) sync
	@echo "Dependencies synced."

# Testing
test:
	@echo "Checking test dependencies..."
	$(UV) pip install PyJWT >/dev/null 2>&1 || true
	@echo "Running tests..."
	$(UV) run pytest -v tests/

coverage:
	@echo "Checking test dependencies..."
	$(UV) pip install PyJWT >/dev/null 2>&1 || true
	@echo "Generating coverage report..."
	rm -f .coverage htmlcov/* || true
	# Use the .coveragerc file directly instead of command-line args
	$(UV) run pytest -v tests/
	$(UV) run coverage report
	$(UV) run coverage html
	$(UV) run coverage xml
	@echo "Coverage report generated in htmlcov/"

# Code quality
lint:
	@echo "Running linters..."
	$(UV) run pylint --rcfile=.pylintrc src/yaraflux_mcp_server --fail-under=9
	@echo "Linting complete."

format:
	@echo "Formatting code..."
	$(UV) run black src tests
	$(UV) run isort src tests
	@echo "Formatting complete."

mypy:
	@echo "Running type checker..."
	$(UV) run mypy --config-file=mypy.ini src/yaraflux_mcp_server
	@echo "Type checking complete."

security-check:
	@echo "Running security checks..."
	$(UV) run bandit -r src/yaraflux_mcp_server -c bandit.yaml
	@echo "Security checks complete."

# Cleaning
clean:
	@echo "Cleaning up..."
	rm -rf $(VENV) *.egg-info dist build __pycache__ .pytest_cache .coverage htmlcov
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	@echo "Cleanup complete."

# Docker
docker-build:
	@echo "Building Docker image $(DOCKER_TAG)..."
	docker build -t $(DOCKER_TAG) .
	docker tag $(DOCKER_TAG) $(IMAGE_NAME):latest
	@echo "Docker build complete."

docker-run:
	@echo "Running Docker container..."
	docker run -p 8000:8000 \
	-e JWT_SECRET_KEY=your_jwt_secret_key \
	-e ADMIN_PASSWORD=your_admin_password \
	$(DOCKER_TAG)

# Docker test with health check
docker-coverage:
	@echo "Running tests, coverage, format, lint and type checks in Docker..."
	docker build --target test -t $(IMAGE_NAME):test .
	docker run -e JWT_SECRET_KEY=your_jwt_secret_key \
	-e ADMIN_PASSWORD=your_admin_password \
	--rm $(IMAGE_NAME):test -c "cd /app && \
 	uv pip install PyJWT coverage black pylint mypy pytest pytest-cov pytest-mock && \
 	uv lock && \
 	uv run black /app/src/ /app/tests/ && \
 	uv run isort /app/src/ /app/tests/ && \
 	uv run pylint --rcfile=/app/.pylintrc /app/src/yaraflux_mcp_server --fail-under=9 && \
 	uv run pytest -v /app/tests/ && \
 	uv run coverage report && \
 	uv run coverage html && \
 	uv run coverage xml"


# Docker test with health check
docker-test:
	@echo "Testing Docker container health status..."
	docker stop $(CONTAINER_NAME) >/dev/null 2>&1 || true
	docker rm $(CONTAINER_NAME) >/dev/null 2>&1 || true

	@echo "Starting test container in detached mode..."
	docker run -d --name $(CONTAINER_NAME) \
		-e JWT_SECRET_KEY=test_jwt_key \
		-e ADMIN_PASSWORD=test_admin_password \
		$(DOCKER_TAG)

	@echo "Waiting $(HEALTH_CHECK_TIMEOUT) seconds for container to initialize..."
	sleep $(HEALTH_CHECK_TIMEOUT)

	@echo "Checking container health status..."
	@if docker inspect --format='{{.State.Health.Status}}' $(CONTAINER_NAME) 2>/dev/null | grep -q healthy; then \
		echo "✅ Container health check passed: Status is healthy"; \
	elif docker inspect --format='{{.State.Health.Status}}' $(CONTAINER_NAME) 2>/dev/null | grep -q starting; then \
		echo "⚠️ Container is still starting up, might need more time"; \
		exit 1; \
	elif docker inspect --format='{{.State.Health.Status}}' $(CONTAINER_NAME) 2>/dev/null | grep -q unhealthy; then \
		echo "❌ Container health check failed: Status is unhealthy"; \
		docker logs $(CONTAINER_NAME); \
		docker stop $(CONTAINER_NAME); \
		docker rm $(CONTAINER_NAME); \
		exit 1; \
	else \
		echo "❓ Container health check not configured or not available"; \
		echo "Checking if container is running..."; \
		if docker ps | grep -q $(CONTAINER_NAME); then \
			echo "✅ Container is running, but no health check defined"; \
			echo "Checking application status via HTTP request..."; \
			if docker exec $(CONTAINER_NAME) wget -q -O- http://localhost:8000/health 2>/dev/null | grep -q -i "ok\|healthy\|up"; then \
				echo "✅ Application is responding to health endpoint"; \
			else \
				echo "❌ Application is not responding to health endpoint"; \
				docker logs $(CONTAINER_NAME); \
				docker stop $(CONTAINER_NAME); \
				docker rm $(CONTAINER_NAME); \
				exit 1; \
			fi; \
		else \
			echo "❌ Container is not running"; \
			docker logs $(CONTAINER_NAME); \
			docker rm $(CONTAINER_NAME); \
			exit 1; \
		fi; \
	fi

	@echo "Stopping and removing test container..."
	docker stop $(CONTAINER_NAME)
	docker rm $(CONTAINER_NAME)

	@echo "✅ Docker test completed successfully"

# Development
run:
	@echo "Running development server..."
	$(UV) run -m uvicorn yaraflux_mcp_server.app:app --reload --host 0.0.0.0 --port 8000

import-rules:
	@echo "Importing ThreatFlux YARA rules..."
	$(UV) run python -m yaraflux_mcp_server import-rules
	@echo "Rules import complete."

# Version management commands
get-version:
	@echo "Current version from __init__.py: $(VERSION)"
	@echo "Version components: MAJOR=$(MAJOR), MINOR=$(MINOR), PATCH=$(PATCH)"
	@echo "New patch version: $(NEW_PATCH)"

	@if [ -f "pyproject.toml" ]; then \
		TOML_VERSION=$$(awk '/^\[project\]/,/^\[/ {if($$1=="version" && $$2=="=") {gsub(/"/, "", $$3); print $$3; exit}}' pyproject.toml); \
		echo "Version in pyproject.toml: $$TOML_VERSION"; \
	else \
		echo "pyproject.toml not found"; \
	fi

	@echo "Next version will be: $(NEW_VERSION)"

bump-version:
	@echo "Bumping version from $(VERSION) to $(NEW_VERSION)"

	@if [ -f "pyproject.toml" ]; then \
		sed -i.bak '/^\[project\]/,/^[[]/ s/^version = "[0-9]*\.[0-9]*\.[0-9]*"/version = "$(NEW_VERSION)"/' pyproject.toml && rm -f pyproject.toml.bak; \
		echo "Updated pyproject.toml"; \
	fi

	@if [ -f "src/yaraflux_mcp_server/__init__.py" ]; then \
		sed -i.bak 's/__version__ = "[0-9]*\.[0-9]*\.[0-9]*"/__version__ = "$(NEW_VERSION)"/' src/yaraflux_mcp_server/__init__.py && rm -f src/yaraflux_mcp_server/__init__.py.bak; \
		echo "Updated __init__.py"; \
	fi

	@if [ -f "Dockerfile" ]; then \
		sed -i.bak 's/version="[0-9]*\.[0-9]*\.[0-9]*"/version="$(NEW_VERSION)"/' Dockerfile && rm -f Dockerfile.bak; \
		echo "Updated Dockerfile"; \
	fi

	@echo "Version bump complete. New version: $(NEW_VERSION)"
	@echo "To commit this change, run:"
	@echo "  git add pyproject.toml src/yaraflux_mcp_server/__init__.py Dockerfile"
	@echo "  git commit -m \"chore: bump version to $(NEW_VERSION)\""
	@echo "  git tag -a \"v$(NEW_VERSION)\" -m \"Version $(NEW_VERSION)\""

# Build package
build:
	@echo "Building Python package..."
	$(UV) build
	@echo "Package built successfully. See dist/ directory."

help:
	@echo "YaraFlux MCP Server Makefile"
	@echo ""
	@echo "Available targets:"
	@echo " all : Clean, install, test, and lint"
	@echo " clean : Clean up build artifacts and caches"
	@echo " check-deps : Check and install system dependencies"
	@echo " install : Install dependencies in a virtual environment"
	@echo " dev-setup : Set up development environment"
	@echo " lock : Generate lock files for reproducible builds"
	@echo " lock-requirements : Regenerate hash-pinned locks for Docker build and security scan"
	@echo " sync : Sync dependencies from lock file"
	@echo " test : Run tests"
	@echo " coverage : Generate test coverage report"
	@echo " lint : Run linters"
	@echo " format : Format code using Black and isort"
	@echo " mypy : Run type checker"
	@echo " security-check : Run security checks"
	@echo " docker-build : Build Docker image"
	@echo " docker-run : Run Docker container"
	@echo " docker-test : Test Docker container health status"
	@echo " docker-coverage : Run tests, coverage, format, lint and type checks in Docker"
