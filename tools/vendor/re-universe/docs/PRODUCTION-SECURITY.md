# 🔒 Production Security Guide

This document outlines critical security requirements and best practices for deploying the Ghidra BSim PostgreSQL platform in production environments.

## ⚠️ **CRITICAL SECURITY REQUIREMENTS**

### 🔐 Credential Management

#### **NEVER use default credentials in production**

The following credentials **MUST** be changed before production deployment:

```bash
# ❌ NEVER USE THESE IN PRODUCTION:
BSIM_DB_USER=ben
BSIM_DB_PASSWORD=bsim
BSIM_DB_USER=bsim_user
BSIM_DB_PASSWORD=bsim_password

# ✅ USE STRONG, UNIQUE CREDENTIALS:
BSIM_DB_USER=prod_bsim_$(openssl rand -hex 4)
BSIM_DB_PASSWORD=$(openssl rand -base64 32)
```

#### **Required Password Complexity**
- **Minimum 16 characters**
- **Mix of uppercase, lowercase, numbers, and symbols**
- **No dictionary words or common patterns**
- **Unique per environment (dev/staging/prod)**

### 🔄 **Credential Rotation**

#### **Database Passwords**
```bash
# Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# Update environment
sed -i "s/BSIM_DB_PASSWORD=.*/BSIM_DB_PASSWORD=$NEW_PASSWORD/" .env

# Update database
docker exec bsim-postgres psql -U postgres -d postgres -c "ALTER USER bsim_user PASSWORD '$NEW_PASSWORD';"

# Restart services
./stop-bsim.sh && ./start-bsim.sh
```

#### **SSL Certificates**
```bash
# Rotate certificates every 90 days
./renew-ssl-certs.sh

# Automated rotation (add to crontab)
0 2 1 */3 * cd /path/to/project && ./renew-ssl-certs.sh
```

## 🛡️ **Network Security**

### **Firewall Configuration**
```bash
# Only allow necessary ports
sudo ufw allow 5432/tcp  # PostgreSQL (restrict to specific IPs)
sudo ufw enable

# Restrict PostgreSQL access to specific hosts
# Edit postgresql.conf:
# listen_addresses = '10.0.0.100'  # Specific IP only
# pg_hba.conf:
# host    bsim    bsim_user    10.0.0.100/32    scram-sha-256
```

### **SSL/TLS Requirements**
- **Mandatory SSL** - All database connections must use SSL
- **TLS 1.2 minimum** - Disable older protocols
- **Valid certificates** - Use CA-signed certificates in production
- **Perfect Forward Secrecy** - Enable ephemeral key exchange

### **Database Security**

#### **PostgreSQL Hardening**
```bash
# Required postgresql.conf settings:
ssl = on
ssl_ciphers = 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'
ssl_prefer_server_ciphers = on
ssl_min_protocol_version = 'TLSv1.2'
log_connections = on
log_disconnections = on
log_failed_login_attempts = on
```

#### **User Permissions**
```sql
-- Minimum required permissions for BSim user
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bsim_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bsim_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bsim_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO bsim_user;
```

## 🔍 **Monitoring & Auditing**

### **Required Monitoring**

#### **Failed Authentication Attempts**
```bash
# Monitor failed logins
docker exec bsim-postgres tail -f /var/log/postgresql/postgresql-*.log | grep "FATAL.*authentication"

# Alert on repeated failures
awk '/authentication failed/ {count++} END {if(count > 10) print "ALERT: " count " failed logins"}' postgresql.log
```

#### **Suspicious Activity**
```bash
# Monitor for unusual queries
docker exec bsim-postgres psql -U postgres -d bsim -c "
SELECT query, state, query_start, client_addr
FROM pg_stat_activity
WHERE query NOT LIKE '%pg_stat_activity%'
AND state = 'active'
AND query_start < now() - interval '5 minutes';"
```

### **Log Retention & Analysis**
```bash
# Centralized logging (rsyslog/fluentd)
# Retain logs for minimum 90 days
# Automated log analysis for anomalies
# SIEM integration for real-time monitoring
```

## 🚨 **Incident Response**

### **Compromise Response**

#### **Immediate Actions**
1. **Isolate system** - Disable network access
2. **Preserve evidence** - Snapshot containers and volumes
3. **Rotate all credentials** - Database, SSL certificates, SSH keys
4. **Audit access logs** - Identify scope of compromise
5. **Notify stakeholders** - Security team, management, compliance

#### **Recovery Steps**
```bash
# 1. Stop all services
./stop-bsim.sh --remove --volumes

# 2. Backup current state for analysis
docker volume create forensic-backup
docker cp bsim-postgres:/var/lib/postgresql/data /tmp/forensic-data

# 3. Deploy clean environment
git checkout main
./start-bsim.sh

# 4. Restore from known-good backup
./restore-bsim.sh --backup "last-known-good"

# 5. Implement additional hardening
```

## 📋 **Production Deployment Checklist**

### **Pre-Deployment**
- [ ] **Change ALL default credentials**
- [ ] **Generate unique SSL certificates**
- [ ] **Configure firewall rules**
- [ ] **Set up monitoring and alerting**
- [ ] **Test backup and restore procedures**
- [ ] **Validate SSL/TLS configuration**
- [ ] **Review database permissions**
- [ ] **Configure log retention**

### **Post-Deployment**
- [ ] **Verify no default credentials in use**
- [ ] **Test security controls**
- [ ] **Confirm monitoring is active**
- [ ] **Document emergency procedures**
- [ ] **Schedule credential rotation**
- [ ] **Conduct security testing**

### **Ongoing Operations**
- [ ] **Monthly credential rotation**
- [ ] **Quarterly SSL certificate renewal**
- [ ] **Regular security patches**
- [ ] **Log review and analysis**
- [ ] **Backup testing**
- [ ] **Access review**

## 🔧 **Security Automation**

### **Automated Security Checks**
```bash
#!/bin/bash
# security-check.sh - Run daily security validation

# Check for default credentials
if grep -r "ben:bsim\|bsim_password" . 2>/dev/null; then
    echo "CRITICAL: Default credentials found!"
    exit 1
fi

# Verify SSL is enabled
if ! docker exec bsim-postgres psql -U postgres -c "SHOW ssl;" | grep -q "on"; then
    echo "CRITICAL: SSL not enabled!"
    exit 1
fi

# Check certificate expiry
if ! openssl x509 -in ssl/server.crt -noout -checkend 604800; then
    echo "WARNING: SSL certificate expires within 7 days!"
fi

echo "Security check passed"
```

### **Credential Generation**
```bash
#!/bin/bash
# generate-secure-credentials.sh

# Generate secure database credentials
DB_USER="bsim_$(openssl rand -hex 6)"
DB_PASSWORD=$(openssl rand -base64 32)

# Update environment file
cat > .env.production << EOF
BSIM_DB_NAME=bsim
BSIM_DB_USER=$DB_USER
BSIM_DB_PASSWORD=$DB_PASSWORD
BSIM_DB_PORT=5432
EOF

echo "Secure credentials generated in .env.production"
echo "Database User: $DB_USER"
echo "Password: [REDACTED - check .env.production file]"
```

## ⚠️ **Common Security Mistakes**

### **❌ DO NOT**
- Use default or weak passwords
- Expose PostgreSQL port to public internet
- Store credentials in git repositories
- Use self-signed certificates in production
- Skip security monitoring
- Deploy without changing defaults
- Use shared accounts

### **✅ DO**
- Generate unique credentials per environment
- Restrict network access to minimum required
- Use secrets management systems
- Implement comprehensive monitoring
- Regular security testing and audits
- Automate security checks
- Follow principle of least privilege

## 📚 **Additional Resources**

- [PostgreSQL Security Checklist](https://postgresql.org/docs/current/security-checklist.html)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

> **⚠️ IMPORTANT**: This platform handles sensitive malware samples and reverse engineering data. Ensure compliance with your organization's security policies, legal requirements, and industry regulations before deployment.