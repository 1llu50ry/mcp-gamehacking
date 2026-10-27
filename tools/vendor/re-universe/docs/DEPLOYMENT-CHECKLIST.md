# BSim Production Deployment Checklist

## 📋 Complete Deployment Checklist

This checklist ensures all components are properly configured for production use.

### ✅ **Prerequisites** (Required before deployment)

- [ ] **System Requirements**
  - [ ] 16GB+ RAM available
  - [ ] 100GB+ disk space available
  - [ ] Linux server with systemd (for automated services)
  - [ ] Internet connectivity for Docker images

- [ ] **Dependencies Installed**
  ```bash
  # Run dependency installer
  ./install-dependencies.sh

  # Or install manually:
  # Docker, docker-compose, jq, bc, curl, openssl, git, make, gcc
  ```

- [ ] **Docker Access**
  - [ ] Docker daemon running
  - [ ] User added to docker group: `sudo usermod -aG docker $USER`
  - [ ] Test: `docker ps` (should not require sudo)

### ✅ **Security Setup** (Critical for production)

- [ ] **Production Credentials**
  ```bash
  # Generate secure credentials
  ./generate-prod-credentials.sh --backup --verbose

  # Verify .env.production was created
  ls -la .env.production
  ```

- [ ] **SSL Certificates**
  ```bash
  # Generate production SSL certificates
  ./generate-ssl-certs.sh

  # Verify certificates exist
  ls -la ssl/prod-server.crt ssl/prod-server.key
  ```

- [ ] **Security Validation**
  ```bash
  # Run security checks
  ./security-check.sh

  # Verify no hardcoded passwords remain
  grep -r "<DB_PASSWORD>\|bsim\|changeme" . --exclude-dir=.git || echo "No hardcoded passwords found"
  ```

### ✅ **Production Deployment**

- [ ] **Pre-deployment Validation**
  ```bash
  # Run production validation
  ./validate-production.sh
  ```

- [ ] **Deploy Production Environment**
  ```bash
  # Full production deployment
  ./deploy-production.sh

  # Or quick deployment
  ./generate-prod-credentials.sh --backup && ./deploy-production.sh
  ```

- [ ] **Database Initialization**
  ```bash
  # Verify database is accessible
  docker exec bsim-postgres-production pg_isready -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2)

  # Test SSL connection
  docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "SELECT 'SSL enabled' as status;"
  ```

### ✅ **Monitoring & Backup Setup**

- [ ] **Backup Configuration**
  ```bash
  # Test backup functionality
  ./production-backup.sh

  # Verify backup was created
  ls -la /opt/bsim/backups/

  # Check backup manifest
  cat /opt/bsim/backups/latest_backup.json
  ```

- [ ] **Monitoring Setup**
  ```bash
  # Test monitoring
  ./production-monitoring.sh

  # Start monitoring daemon (optional)
  ./production-monitoring.sh --daemon &
  ```

- [ ] **Automated Services** (systemd - Linux only)
  ```bash
  # Check if systemd services were created
  sudo systemctl status bsim-backup.timer
  sudo systemctl status bsim-backup.service
  ```

### ✅ **Functional Testing**

- [ ] **Database Connectivity**
  ```bash
  # Test PostgreSQL connection
  export PGPASSWORD=$(grep BSIM_DB_PASSWORD .env.production | cut -d= -f2)
  docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "\l"
  ```

- [ ] **lshvector Extension**
  ```bash
  # Verify lshvector extension is loaded
  docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "\dx lshvector"
  ```

- [ ] **BSim Schema**
  ```bash
  # Check BSim tables exist
  docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "\dt"
  ```

### ✅ **Post-Deployment Configuration**

- [ ] **Alert Configuration** (Optional)
  ```bash
  # Edit .env.production to add alert settings
  nano .env.production

  # Add:
  # ALERT_EMAIL=admin@yourdomain.com
  # SLACK_WEBHOOK=https://hooks.slack.com/services/...
  ```

- [ ] **Backup Scheduling** (Optional)
  ```bash
  # Add to crontab for manual scheduling
  crontab -e

  # Add line: 0 2 * * * /path/to/re-universe/production-backup.sh
  ```

- [ ] **Remote Backup** (Optional)
  ```bash
  # Configure remote backup in production-backup.sh
  # Uncomment and configure lines 127-130
  ```

### ✅ **Documentation & Access**

- [ ] **Connection Information**
  ```bash
  # Display connection details
  source .env.production
  echo "Database URL: postgresql://${BSIM_DB_USER}:<password>@localhost:${BSIM_DB_PORT}/${BSIM_DB_NAME}?sslmode=require"
  ```

- [ ] **Management Commands**
  ```bash
  # Document these commands for your team:

  # Start: docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d
  # Stop: docker-compose -f docker-compose.yml -f docker-compose.production.yml down
  # Monitor: ./production-monitoring.sh
  # Backup: ./production-backup.sh
  # Logs: docker logs bsim-postgres-production
  ```

- [ ] **Security Documentation**
  - [ ] .env.production file location documented
  - [ ] SSL certificate renewal procedure documented
  - [ ] Backup restore procedure documented
  - [ ] Emergency contact information available

### ✅ **Final Validation**

- [ ] **Complete System Test**
  ```bash
  # Run final production validation
  ./validate-production.sh

  # Should show all checks passed
  ```

- [ ] **Performance Baseline**
  ```bash
  # Establish baseline metrics
  ./production-monitoring.sh > baseline-metrics.txt

  # Monitor for 24 hours to establish normal patterns
  ```

## 🚨 **Critical Security Reminders**

1. **Never commit .env.production to git**
2. **Rotate credentials monthly in production**
3. **Monitor SSL certificate expiry**
4. **Test backup restore procedures quarterly**
5. **Keep Docker images updated**
6. **Review security logs weekly**

## 📞 **Emergency Procedures**

### Database Down
```bash
# Check container status
docker ps -a | grep bsim
docker logs bsim-postgres-production

# Restart if needed
docker-compose -f docker-compose.yml -f docker-compose.production.yml restart bsim-postgres
```

### High Resource Usage
```bash
# Check resource consumption
docker stats bsim-postgres-production
./production-monitoring.sh

# Review database performance
docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "SELECT * FROM pg_stat_activity;"
```

### Security Incident
```bash
# Immediate shutdown
docker-compose -f docker-compose.yml -f docker-compose.production.yml down

# Regenerate credentials
./generate-prod-credentials.sh --force

# Review logs
docker logs bsim-postgres-production | grep -i "authentication\|error\|fail"
```

---

**Completion**: When all checkboxes are completed, your BSim platform is production-ready and secure.

**Support**: Refer to [PRODUCTION-READY.md](PRODUCTION-READY.md) for detailed documentation and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for issue resolution.