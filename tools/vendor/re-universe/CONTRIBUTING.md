# Contributing to Reverse Engineering Analysis Platform

Thank you for your interest in contributing to our reverse engineering platform! This document provides guidelines for contributing to the project.

## 🤝 How to Contribute

### 1. Fork and Clone
```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/your-username/re-universe.git
cd re-universe
```

### 2. Set Up Development Environment
```bash
# Copy environment template
cp .env.example .env

# Make scripts executable (Linux/macOS)
chmod +x *.sh

# Test the setup
./test-connectivity.sh  # Linux/macOS
.\test-connectivity.ps1  # Windows
```

### 3. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

## 🎯 Types of Contributions

### **Bug Fixes**
- Fix issues in existing scripts
- Improve error handling
- Address platform-specific problems

### **New Features**
- Additional backup strategies
- New analysis tool integrations
- Enhanced monitoring capabilities

### **Documentation**
- Improve README sections
- Add troubleshooting guides
- Create video tutorials

### **Testing**
- Add test cases
- Cross-platform validation
- Performance benchmarking

## 📝 Development Guidelines

### **Code Style**

#### PowerShell Scripts
```powershell
# Use consistent parameter naming
param(
    [string]$BackupName,
    [string]$BackupPath = "./backups"
)

# Use Write-Host with colors for user feedback
Write-Host "Operation completed" -ForegroundColor Green

# Handle errors properly
try {
    # Operation code
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}
```

#### Bash Scripts
```bash
# Use consistent parameter parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        -BackupName|--backup-name)
            BACKUP_NAME="$2"
            shift 2
            ;;
    esac
done

# Use colored output
echo -e "\033[32mSUCCESS: Operation completed\033[0m"

# Handle errors with traps
set -e
trap cleanup EXIT
```

### **Cross-Platform Requirements**
- All new scripts must have both PowerShell (.ps1) and Bash (.sh) versions
- Test on Windows, Linux, and macOS
- Use platform-agnostic paths and commands where possible

### **Testing Requirements**
- Test all scripts in both Windows and WSL/Linux environments
- Ensure backup/restore cycles work correctly
- Validate error handling scenarios

## 🧪 Testing Checklist

Before submitting a pull request:

- [ ] **Windows Testing**: Scripts work in PowerShell
- [ ] **Linux Testing**: Scripts work in Bash (tested in WSL Ubuntu)
- [ ] **macOS Testing**: Scripts work in Bash (if available)
- [ ] **Docker Testing**: Containers start/stop correctly
- [ ] **Backup Testing**: Backup/restore cycle completes successfully
- [ ] **Error Handling**: Scripts handle errors gracefully
- [ ] **Documentation**: README and comments are updated
- [ ] **Configuration**: .env.example includes new variables if needed

## 📋 Pull Request Process

### 1. **Before Submitting**
- Ensure all tests pass
- Update documentation
- Follow the code style guidelines
- Test on multiple platforms

### 2. **Pull Request Template**
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Breaking change

## Testing
- [ ] Tested on Windows (PowerShell)
- [ ] Tested on Linux (Bash)
- [ ] Tested on macOS (if available)
- [ ] Backup/restore cycle tested

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Cross-platform compatibility verified
```

### 3. **Review Process**
- Code review by maintainers
- Automated testing (when available)
- Cross-platform validation
- Documentation review

## 🐛 Reporting Issues

### **Bug Reports**
Use the bug report template:
```markdown
**Environment**
- OS: [Windows/Linux/macOS]
- Shell: [PowerShell/Bash]
- Docker version: [version]

**Describe the Bug**
Clear description of the issue

**Steps to Reproduce**
1. Run command...
2. Error occurs...

**Expected Behavior**
What should have happened

**Logs**
Include relevant error messages
```

### **Feature Requests**
```markdown
**Problem Statement**
What problem does this solve?

**Proposed Solution**
How should this work?

**Cross-Platform Considerations**
Any platform-specific requirements?
```

## 🎖️ Recognition

Contributors will be:
- Listed in the project README
- Credited in release notes
- Invited to join the maintainer team (for significant contributions)

## 📞 Getting Help

- **Documentation**: Check README.md and .github/copilot-instructions.md
- **Issues**: Search existing issues before creating new ones
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact maintainers for sensitive issues

## 🔄 Release Process

### **Versioning**
We use [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### **Release Checklist**
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Cross-platform testing completed
- [ ] Release notes prepared
- [ ] Version bumped in relevant files

---

Thank you for contributing to the reverse engineering community! 🔍✨
