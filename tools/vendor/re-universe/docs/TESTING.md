# Automated Testing Framework

## Overview

The Ghidra RE Platform includes a comprehensive automated testing framework designed to validate functionality across all supported platforms and ensure production readiness.

## Test Suites

### 🧪 Unit Test Suites

#### `test-suite.ps1` / `test-suite.sh`
**Purpose**: Comprehensive validation of all platform components
**Runtime**: ~5 minutes
**Coverage**: 
- Prerequisites validation (Docker, Docker Compose)
- Script syntax validation (PowerShell and Bash)
- Configuration management testing
- Directory structure validation
- Docker configuration validation
- Backup system testing
- VS Code integration validation
- Documentation quality checks

**Usage**:
```powershell
# Windows
.\test-suite.ps1                    # Full test suite
.\test-suite.ps1 -SkipDocker       # Skip Docker tests
.\test-suite.ps1 -CI               # CI mode (stricter error handling)

# Linux/macOS  
./test-suite.sh                    # Full test suite
```

### 🔄 Integration Test Suites

#### `integration-test.ps1` / `integration-test.sh`
**Purpose**: End-to-end platform workflow testing
**Runtime**: ~10 minutes
**Coverage**:
- Complete platform lifecycle (setup → start → test → backup → restore)
- Service connectivity validation
- Data persistence verification
- Backup/restore cycle validation
- Platform restart testing

**Usage**:
```powershell
# Windows
.\integration-test.ps1              # Full integration test
.\integration-test.ps1 -SkipDocker  # Skip Docker operations
.\integration-test.ps1 -KeepArtifacts # Don't cleanup test data

# Linux/macOS
./integration-test.sh               # Full integration test
```

## GitHub Actions Workflows

### 🔄 Main Testing Pipeline (`.github/workflows/test.yml`)

**Triggers**:
- Push to `main` or `develop` branches
- Pull requests to `main`
- Daily scheduled runs (6 AM UTC)

**Jobs**:
1. **test-windows**: Windows PowerShell validation
2. **test-linux**: Ubuntu Bash validation  
3. **test-macos**: macOS Bash validation
4. **integration-test**: Full platform workflow test
5. **security-scan**: Trivy vulnerability scanning
6. **documentation-test**: Markdown validation and completeness
7. **release-validation**: Production readiness check
8. **test-summary**: Aggregate results reporting

### 📊 Performance Testing Pipeline (`.github/workflows/performance.yml`)

**Triggers**:
- Weekly scheduled runs (Sunday 3 AM UTC)
- Manual workflow dispatch with parameters

**Features**:
- Configurable test duration (1-60 minutes)
- Load levels: light, medium, heavy
- Resource monitoring (CPU, memory, I/O)
- Performance regression detection
- Memory leak detection

## Local Testing Commands

### Quick Validation
```bash
# Test all platforms locally
.\test-suite.ps1 -SkipDocker        # Windows
./test-suite.sh                     # Linux/macOS

# Test specific components
.\config.ps1 -Action validate       # Configuration
.\test-connectivity.ps1             # Platform connectivity
```

### Full Integration Testing
```bash
# Complete workflow test
.\integration-test.ps1              # Windows  
./integration-test.sh               # Linux/macOS

# Manual testing workflow
.\setup.ps1                         # 1. Setup
.\start.ps1                         # 2. Start platform
.\test-connectivity.ps1             # 3. Verify connectivity
.\backup.ps1 -BackupName "test"     # 4. Create backup
.\restore.ps1 -BackupFile "..."     # 5. Restore backup
.\cleanup.ps1 -DryRun               # 6. Test cleanup
```

## CI/CD Integration

### Pull Request Validation
Every pull request automatically runs:
- ✅ Cross-platform syntax validation
- ✅ Configuration management tests
- ✅ Docker configuration validation
- ✅ Documentation completeness checks
- ✅ Security vulnerability scanning

### Continuous Integration Features
- **Artifact Upload**: Failed test logs and outputs preserved
- **Matrix Testing**: Windows, Linux, macOS validation
- **Dependency Management**: Automatic tool installation
- **Timeout Protection**: Prevents hanging builds
- **Parallel Execution**: Multiple test jobs run simultaneously

### Release Pipeline Integration
When tests pass on `main` branch:
- ✅ Release validation job confirms production readiness
- 🚀 Automatic release candidate detection
- 📋 Comprehensive test results summary
- 🔄 Performance baseline establishment

## Test Coverage Matrix

| Component | Unit Tests | Integration | Platform Coverage |
|-----------|------------|-------------|------------------|
| Scripts | ✅ | ✅ | Windows, Linux, macOS |
| Configuration | ✅ | ✅ | All platforms |
| Docker Setup | ✅ | ✅ | Linux primary |
| Backup System | ✅ | ✅ | All platforms |
| VS Code Integration | ✅ | ⚪ | All platforms |
| Documentation | ✅ | ⚪ | Platform agnostic |
| Security | ✅ | ⚪ | Trivy scanning |

## Performance Monitoring

### Automated Performance Tests
- **Weekly Execution**: Every Sunday at 3 AM UTC
- **Resource Monitoring**: CPU, memory, I/O statistics
- **Load Testing**: Configurable intensity levels
- **Regression Detection**: Performance baseline tracking
- **Artifact Collection**: Detailed performance logs

### Manual Performance Testing
```bash
# Trigger performance test with custom parameters
# Via GitHub Actions → Actions → Performance & Load Testing → Run workflow
# Duration: 1-60 minutes
# Load Level: light/medium/heavy
```

## Troubleshooting Test Failures

### Common Issues

#### Docker Not Available
```bash
# Linux/macOS: Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Windows: Install Docker Desktop
# Download from https://www.docker.com/products/docker-desktop
```

#### Script Permission Issues  
```bash
# Linux/macOS: Fix permissions
chmod +x *.sh

# Windows: Set execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Test Environment Conflicts
```bash
# Clean environment before testing
.\cleanup.ps1 -Force              # Windows
./cleanup.sh --force              # Linux/macOS

# Reset configuration
.\config.ps1 -Action reset        # Windows
./config.sh -Action reset         # Linux/macOS
```

## Contributing Test Improvements

When adding new tests:
1. **Cross-Platform**: Create both PowerShell and Bash versions
2. **Documentation**: Update this file with new test descriptions
3. **CI Integration**: Add new tests to GitHub Actions workflows
4. **Error Handling**: Include proper error messages and cleanup
5. **Artifact Collection**: Preserve logs and outputs for debugging

## Test Artifacts

### Local Test Outputs
- `*.log`: Test execution logs
- `backups/`: Test backup files (cleaned up automatically)
- `sync-logs/`: ret-sync operation logs

### CI/CD Artifacts
- **windows-test-logs**: Windows platform test outputs
- **linux-test-logs**: Linux platform test outputs  
- **macos-test-logs**: macOS platform test outputs
- **integration-test-results**: Full integration test artifacts
- **performance-test-results**: Performance monitoring data

All artifacts are automatically uploaded on test failures and preserved for 30 days for debugging purposes.
