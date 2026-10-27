# 🚀 Production Deployment Checklist

This checklist ensures all critical steps are completed for secure production deployment of the Ghidra BSim PostgreSQL platform.

## 📋 Pre-Deployment Security Checklist

### 🔐 **Phase 1: Security Foundation (CRITICAL)**

#### Credential Management
- [ ] **Remove all default credentials** from the platform
  ```bash
  # Verify no hardcoded credentials exist
  ./security-check.sh --quick
  ```

- [ ] **Generate production credentials**
  ```bash
  ./generate-prod-credentials.sh --backup
  ```

- [ ] **Verify .env.production is created and secured**
  ```bash
  ls -la .env.production  # Should show permissions 600
  ```

- [ ] **Test credential strength**
  ```bash
  # Password should be 32+ characters
  grep BSIM_DB_PASSWORD .env.production | cut -d= -f2 | wc -c
  ```

#### SSL/TLS Security
- [ ] **Generate production SSL certificates**
  ```bash
  # For production, use CA-signed certificates
  # For testing, generate self-signed:
  openssl req -new -x509 -days 365 -nodes -sha256 \
    -out ssl/server.crt -keyout ssl/server.key \
    -subj "/C=US/ST=State/L=City/O=Org/OU=Security/CN=bsim.domain.com"
  ```

- [ ] **Set secure SSL permissions**
  ```bash
  chmod 600 ssl/server.key
  chmod 644 ssl/server.crt
  chmod 700 ssl/
  ```

- [ ] **Verify SSL configuration**
  ```bash
  openssl x509 -in ssl/server.crt -text -noout | grep "Signature Algorithm"
  ```

### 🛡️ **Phase 2: System Security**

#### Network Security
- [ ] **Configure firewall rules**
  ```bash
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow ssh
  sudo ufw allow 5432/tcp from 10.0.0.0/8  # Restrict to private network
  sudo ufw enable
  sudo ufw status verbose
  ```

- [ ] **Install and configure fail2ban**
  ```bash
  sudo apt install fail2ban -y
  # Configure PostgreSQL jail (see PRODUCTION-DEPLOYMENT.md)
  sudo systemctl enable fail2ban
  sudo systemctl start fail2ban
  ```

#### System Hardening
- [ ] **Update system packages**
  ```bash
  sudo apt update && sudo apt upgrade -y
  sudo apt autoremove -y
  ```

- [ ] **Configure automatic security updates**
  ```bash
  sudo apt install unattended-upgrades -y
  sudo dpkg-reconfigure -plow unattended-upgrades
  ```

- [ ] **Set up log monitoring**
  ```bash
  # Ensure rsyslog is configured for container logs
  systemctl status rsyslog
  ```

### 📊 **Phase 3: Environment Setup**

#### Docker Configuration
- [ ] **Verify Docker security**
  ```bash
  docker version
  docker info | grep -i "security"
  ```

- [ ] **Create production docker-compose configuration**
  ```bash
  # Copy docker-compose.yml to docker-compose.prod.yml
  # Configure production settings (see PRODUCTION-DEPLOYMENT.md)
  ```

- [ ] **Set up dedicated storage**
  ```bash
  sudo mkdir -p /data/bsim/postgres
  sudo mkdir -p /backup/bsim
  sudo chown -R 999:999 /data/bsim/postgres  # PostgreSQL UID
  ```

#### Environment Configuration
- [ ] **Load production environment**
  ```bash
  cp .env.production .env
  source .env
  ```

- [ ] **Verify environment variables**
  ```bash
  echo $BSIM_DB_USER
  echo $BSIM_DB_NAME
  # Password should not be displayed
  ```

## 🚀 **Phase 4: Deployment**

### Initial Deployment
- [ ] **Start production services**
  ```bash
  docker-compose -f docker-compose.prod.yml up -d
  ```

- [ ] **Wait for startup and verify health**
  ```bash
  sleep 60
  docker ps | grep bsim-postgres
  docker logs bsim-postgres | tail -20
  ```

- [ ] **Test database connectivity**
  ```bash
  ./test-bsim-setup.sh --test database
  ```

### Comprehensive Testing
- [ ] **Run full test suite**
  ```bash
  ./test-bsim-setup.sh --comprehensive
  ```

- [ ] **Run security validation**
  ```bash
  ./security-check.sh
  ```

- [ ] **Verify SSL connectivity**
  ```bash
  PGPASSWORD=$BSIM_DB_PASSWORD psql \
    -h localhost -p 5432 -U $BSIM_DB_USER -d $BSIM_DB_NAME \
    -c "SELECT 'SSL test successful' as status;" \
    --set=sslmode=require
  ```

- [ ] **Test BSim functionality**
  ```bash
  docker exec bsim-postgres psql -U $BSIM_DB_USER -d $BSIM_DB_NAME \
    -c "SELECT * FROM bsim_database_info();"
  ```

## 🔧 **Phase 5: Operations Setup**

### Monitoring & Alerting
- [ ] **Configure monitoring**
  ```bash
  ./monitor-bsim.sh alerts
  ```

- [ ] **Test alerting mechanisms**
  ```bash
  # Simulate alert conditions and verify notifications
  ./monitor-bsim.sh --test-alerts
  ```

- [ ] **Set up log aggregation**
  ```bash
  # Configure centralized logging (see PRODUCTION-DEPLOYMENT.md)
  ```

### Backup & Recovery
- [ ] **Configure automated backups**
  ```bash
  ./bsim-backup.sh --setup-cron
  ```

- [ ] **Test backup creation**
  ```bash
  ./bsim-backup.sh --name "initial-prod-backup"
  ```

- [ ] **Test backup restoration**
  ```bash
  # Test restore in non-production environment
  ./restore-bsim.sh --backup "initial-prod-backup" --test-mode
  ```

- [ ] **Verify backup encryption**
  ```bash
  # Ensure backups are encrypted with production key
  file ./backups/bsim/latest-backup.sql.gz.enc
  ```

### Maintenance Scheduling
- [ ] **Schedule credential rotation**
  ```bash
  # Add to crontab for quarterly rotation
  (crontab -l; echo "0 2 1 */3 * /path/to/rotate-credentials.sh") | crontab -
  ```

- [ ] **Schedule SSL certificate renewal**
  ```bash
  # Add to crontab for certificate renewal
  (crontab -l; echo "0 2 1 */3 * /path/to/renew-ssl-certs.sh") | crontab -
  ```

## 🧪 **Phase 6: Validation & Go-Live**

### Security Validation
- [ ] **Final security scan**
  ```bash
  ./security-check.sh --verbose
  ```

- [ ] **Penetration testing (if required)**
  ```bash
  # Run authorized security testing
  # Document and address any findings
  ```

- [ ] **Verify no test data in production**
  ```bash
  # Ensure no development/test data exists
  docker exec bsim-postgres psql -U $BSIM_DB_USER -d $BSIM_DB_NAME \
    -c "SELECT COUNT(*) FROM executable;"  # Should be 0 for new deployment
  ```

### Performance Validation
- [ ] **Performance baseline testing**
  ```bash
  ./monitor-bsim.sh performance
  ```

- [ ] **Resource utilization check**
  ```bash
  docker stats --no-stream bsim-postgres
  free -h
  df -h
  ```

- [ ] **Connection limits testing**
  ```bash
  # Test maximum concurrent connections
  ./test-connection-limits.sh
  ```

### Documentation & Handover
- [ ] **Update production documentation**
  ```bash
  # Document actual production configuration
  # Update runbooks and procedures
  ```

- [ ] **Create operations runbook**
  ```bash
  # Include emergency contacts, procedures
  # Document troubleshooting steps
  ```

- [ ] **Train operations team**
  ```bash
  # Ensure team knows monitoring, backup, recovery procedures
  ```

## 🚨 **Phase 7: Go-Live & Monitoring**

### Go-Live
- [ ] **Enable production traffic**
  ```bash
  # Configure load balancers, DNS, etc.
  # Start accepting production connections
  ```

- [ ] **Monitor initial deployment**
  ```bash
  # Watch for 24-48 hours
  ./monitor-bsim.sh watch performance
  ```

- [ ] **Verify all services operational**
  ```bash
  ./test-bsim-setup.sh
  ./security-check.sh --quick
  ```

### Post-Deployment
- [ ] **Schedule regular health checks**
  ```bash
  # Add health check monitoring
  (crontab -l; echo "*/15 * * * * /path/to/health-check.sh") | crontab -
  ```

- [ ] **Document lessons learned**
  ```bash
  # Update deployment procedures based on experience
  ```

- [ ] **Security review scheduled**
  ```bash
  # Schedule first security review in 30 days
  ```

## ✅ **Deployment Sign-Off**

### Technical Sign-Off
- [ ] **Security Team Approval**
  - All security requirements met
  - Penetration testing completed (if required)
  - Security monitoring active

- [ ] **Operations Team Approval**
  - Monitoring and alerting configured
  - Backup and recovery tested
  - Runbooks and procedures documented

- [ ] **Infrastructure Team Approval**
  - Resource allocation adequate
  - Network security configured
  - Storage and backup systems operational

### Business Sign-Off
- [ ] **Project Manager Approval**
  - All requirements satisfied
  - Risk assessment completed
  - Change management process followed

- [ ] **Security Officer Approval**
  - Security policies compliance verified
  - Risk mitigation strategies implemented
  - Incident response procedures in place

## 📞 **Emergency Contacts & Procedures**

### Emergency Response Team
- **Security Incidents**: [security@organization.com]
- **Infrastructure Issues**: [infrastructure@organization.com]
- **Database Issues**: [database@organization.com]

### Emergency Procedures
```bash
# Security Incident
./incident-response.sh --security-breach

# Infrastructure Failure
./incident-response.sh --infrastructure-failure

# Database Corruption
./incident-response.sh --database-recovery
```

---

## 📝 **Notes Section**

**Deployment Date**: ________________

**Deployed By**: ____________________

**Environment**: ____________________

**Version/Commit**: _________________

**Special Configurations**: __________
___________________________________

**Post-Deployment Issues**: __________
___________________________________

**Action Items**: ___________________
___________________________________

---

> **🔒 Security Reminder**: This checklist ensures secure deployment of a platform that handles sensitive malware samples and reverse engineering data. Follow all steps carefully and maintain strict security controls throughout the deployment process.