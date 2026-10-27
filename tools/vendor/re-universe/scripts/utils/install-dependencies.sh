#!/bin/bash

# Install Dependencies for BSim Production Platform
# Installs all required tools for production deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get >/dev/null 2>&1; then
            OS="debian"
        elif command -v yum >/dev/null 2>&1; then
            OS="redhat"
        elif command -v pacman >/dev/null 2>&1; then
            OS="arch"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
    else
        OS="unknown"
    fi
}

# Install dependencies based on OS
install_dependencies() {
    print_header "Installing BSim Platform Dependencies"

    case $OS in
        "debian")
            print_warning "Installing dependencies with apt..."
            sudo apt update
            sudo apt install -y \
                docker.io \
                docker-compose \
                jq \
                bc \
                curl \
                wget \
                openssl \
                postgresql-client \
                netcat \
                mailutils \
                git \
                make \
                gcc \
                build-essential

            # Add user to docker group
            sudo usermod -aG docker $USER
            print_success "Dependencies installed for Debian/Ubuntu"
            ;;

        "redhat")
            print_warning "Installing dependencies with yum/dnf..."
            sudo yum update -y || sudo dnf update -y
            sudo yum install -y \
                docker \
                docker-compose \
                jq \
                bc \
                curl \
                wget \
                openssl \
                postgresql \
                nc \
                mailx \
                git \
                make \
                gcc \
                || \
            sudo dnf install -y \
                docker \
                docker-compose \
                jq \
                bc \
                curl \
                wget \
                openssl \
                postgresql \
                nc \
                mailx \
                git \
                make \
                gcc

            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            print_success "Dependencies installed for RHEL/CentOS/Fedora"
            ;;

        "arch")
            print_warning "Installing dependencies with pacman..."
            sudo pacman -Syu --noconfirm \
                docker \
                docker-compose \
                jq \
                bc \
                curl \
                wget \
                openssl \
                postgresql-libs \
                gnu-netcat \
                git \
                make \
                gcc

            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            print_success "Dependencies installed for Arch Linux"
            ;;

        "macos")
            print_warning "Installing dependencies with Homebrew..."
            if ! command -v brew >/dev/null 2>&1; then
                print_error "Homebrew not found. Installing..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi

            brew install \
                docker \
                docker-compose \
                jq \
                bc \
                curl \
                wget \
                openssl \
                postgresql \
                netcat \
                git \
                make \
                gcc

            print_success "Dependencies installed for macOS"
            print_warning "Note: Start Docker Desktop application manually"
            ;;

        "windows")
            print_error "Windows detected. Please install:"
            echo "1. Docker Desktop for Windows"
            echo "2. Git for Windows"
            echo "3. WSL2 with Ubuntu (recommended)"
            echo "4. Run this script in WSL2 Ubuntu"
            exit 1
            ;;

        *)
            print_error "Unsupported OS: $OSTYPE"
            print_warning "Please install manually:"
            echo "- docker, docker-compose"
            echo "- jq, bc, curl, wget, openssl"
            echo "- postgresql-client, netcat"
            echo "- git, make, gcc"
            exit 1
            ;;
    esac
}

# Verify installations
verify_dependencies() {
    print_header "Verifying Dependencies"

    local deps=("docker" "docker-compose" "jq" "bc" "curl" "openssl" "git" "make" "gcc")
    local missing=()

    for dep in "${deps[@]}"; do
        if command -v "$dep" >/dev/null 2>&1; then
            print_success "$dep is available"
        else
            print_error "$dep is missing"
            missing+=("$dep")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing dependencies: ${missing[*]}"
        exit 1
    fi

    # Test Docker
    if docker ps >/dev/null 2>&1; then
        print_success "Docker is accessible"
    else
        print_warning "Docker requires restart or user group changes"
        print_warning "Run: sudo systemctl restart docker"
        print_warning "Then: newgrp docker"
    fi

    print_success "All dependencies verified"
}

# Main execution
main() {
    if [[ "$1" == "--help" ]]; then
        echo "Usage: $0 [--verify-only]"
        echo ""
        echo "Install all dependencies for BSim production platform"
        echo ""
        echo "Options:"
        echo "  --verify-only    Only verify existing installations"
        echo "  --help          Show this help"
        exit 0
    fi

    detect_os
    print_header "BSim Platform Dependency Installer"
    print_warning "Detected OS: $OS"

    if [[ "$1" == "--verify-only" ]]; then
        verify_dependencies
    else
        install_dependencies
        verify_dependencies

        print_header "🎉 Installation Complete!"
        print_success "BSim platform dependencies are ready"
        echo ""
        print_warning "Next steps:"
        echo "1. Restart your terminal or run: newgrp docker"
        echo "2. Test installation: ./test-bsim-setup.sh"
        echo "3. Start production: ./generate-prod-credentials.sh && ./deploy-production.sh"
    fi
}

main "$@"