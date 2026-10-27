#!/bin/bash

# Deploy Web Interface Improvements to d2docs.xebyte.com
# Enhanced comparison panel with lazy loading and detailed data

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate web improvements
validate_improvements() {
    print_header "🔍 Validating Web Interface Improvements"

    if [[ ! -f "web/index.html" ]]; then
        print_error "Web interface file not found: web/index.html"
        exit 1
    fi

    # Check for key improvement markers
    local markers=(
        "_detailsLoaded"
        "loadDetailedFunctionData"
        "compare-loading"
        "generateMockDetailedData"
        "include_details=true"
    )

    for marker in "${markers[@]}"; do
        if grep -q "$marker" web/index.html; then
            print_success "Found improvement: $marker"
        else
            print_error "Missing improvement: $marker"
            exit 1
        fi
    done

    print_success "All improvements validated"
}

# Backup current deployment
backup_current() {
    print_header "💾 Creating Backup"

    local backup_dir="web/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"

    # If there's a way to get current production version, backup it
    if command -v rsync > /dev/null 2>&1; then
        print_warning "Creating local backup..."
        cp web/index.html "$backup_dir/index.html.backup"
        print_success "Backup created: $backup_dir"
    else
        print_warning "rsync not available, skipping remote backup"
    fi
}

# Deploy to production (requires server access)
deploy_to_production() {
    print_header "🚀 Deploying to d2docs.xebyte.com"

    print_warning "This script cannot directly deploy to d2docs.xebyte.com"
    print_warning "You need to manually copy the updated files to your server"

    echo ""
    echo -e "${BOLD}Manual Deployment Steps:${NC}"
    echo "1. Copy the updated web/index.html to your server:"
    echo "   scp web/index.html user@d2docs.xebyte.com:/path/to/web/root/"
    echo ""
    echo "2. Update your API to support new endpoints:"
    echo "   - GET /api/functions/details/{canonicalId}"
    echo "   - Enhanced /api/functions/cross-version/ with include_details parameter"
    echo ""
    echo "3. Test the improvements:"
    echo "   - Visit https://d2docs.xebyte.com/"
    echo "   - Click any function cell to test comparison panel"
    echo "   - Look for loading spinner and detailed data"

    # Generate deployment package
    local deploy_package="web-improvements-$(date +%Y%m%d_%H%M%S).tar.gz"
    print_warning "Creating deployment package: $deploy_package"

    tar -czf "$deploy_package" \
        web/index.html \
        README.md \
        CHANGELOG.md

    print_success "Deployment package created: $deploy_package"
    echo ""
    echo -e "${BLUE}Package contents:${NC}"
    echo "  📄 Enhanced web/index.html with comparison improvements"
    echo "  📚 Documentation files"
}

# Show improvement summary
show_improvements() {
    print_header "✨ Web Interface Improvements Summary"

    echo -e "${BLUE}🎯 Enhanced Comparison Panel:${NC}"
    echo "  ✅ Lazy loading for detailed function data"
    echo "  ✅ Loading states with animated spinner"
    echo "  ✅ Graceful degradation for missing data"
    echo "  ✅ Enhanced API parameter support"
    echo "  ✅ Mock data generation for demonstration"
    echo ""

    echo -e "${BLUE}🔗 New Data Connections:${NC}"
    echo "  ✅ sizes, instructions, callees, callers"
    echo "  ✅ strings, constants, globals, tags"
    echo "  ✅ mnemonic_hashes, rvas, candidates"
    echo "  ✅ _detailsLoaded tracking flag"
    echo ""

    echo -e "${BLUE}⚙️ API Enhancements:${NC}"
    echo "  🆕 GET /functions/details/{canonicalId}"
    echo "  📈 Enhanced cross-version endpoint with include_details"
    echo "  🔄 Backward compatibility maintained"
    echo ""

    echo -e "${BLUE}🎨 Visual Improvements:${NC}"
    echo "  🔄 Loading spinner with rotation animation"
    echo "  ℹ️ Informative notices for missing data"
    echo "  📱 Responsive design maintained"
}

# Test local implementation
test_local() {
    print_header "🧪 Testing Local Implementation"

    # Check if test server is running
    if curl -s http://localhost:8001 > /dev/null; then
        print_success "Local test server accessible at http://localhost:8001"
        echo ""
        echo -e "${BLUE}Test the improvements:${NC}"
        echo "1. Open http://localhost:8001 in browser"
        echo "2. Load a function dataset"
        echo "3. Click any function cell to open comparison panel"
        echo "4. Look for loading spinner and detailed sections"
    else
        print_warning "Local test server not running"
        echo "Start with: cd web && python3 -m http.server 8001"
    fi
}

# Main execution
main() {
    print_header "🌐 BSim Web Interface Deployment"

    if [[ "$1" == "--help" ]]; then
        echo "Usage: $0 [validate|test|deploy|help]"
        echo ""
        echo "Deploy enhanced comparison panel improvements:"
        echo ""
        echo "Commands:"
        echo "  validate    Validate improvements are present"
        echo "  test        Test local implementation"
        echo "  deploy      Create deployment package"
        echo "  help        Show this help"
        exit 0
    fi

    case "${1:-deploy}" in
        "validate")
            validate_improvements
            ;;
        "test")
            validate_improvements
            test_local
            ;;
        "deploy")
            validate_improvements
            backup_current
            deploy_to_production
            show_improvements
            ;;
        *)
            validate_improvements
            backup_current
            deploy_to_production
            show_improvements
            ;;
    esac

    print_success "🎉 Web interface deployment process completed!"
}

# Run main function with all arguments
main "$@"