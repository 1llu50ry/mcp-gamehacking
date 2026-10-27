# BSim Production Deployment Guide

## 🎯 Quick Production Setup

This guide provides a complete production-ready deployment of the BSim database with enterprise security, monitoring, and backup features.

### Prerequisites

- Docker and docker-compose installed
- At least 16GB RAM and 100GB disk space
- Linux server with systemd (recommended)
- SSL certificate authority (optional, will auto-generate)

## 🚀 One-Command Deployment

```bash
# Generate production credentials and deploy
./generate-prod-credentials.sh --backup
./deploy-production.sh
```

## 📋 Manual Step-by-Step Deployment

### 1. Generate Production Credentials

```bash
# Create secure production credentials
./generate-prod-credentials.sh --backup --verbose

# Review and customize settings
nano .env.production
```

### 2. Generate SSL Certificates

```bash
# Create production SSL certificates
./generate-ssl-certs.sh

# Verify certificates
openssl x509 -in ssl/prod-server.crt -text -noout
```

### 3. Deploy Production Environment

```bash
# Deploy with production configuration
./deploy-production.sh

# Or deploy without security checks (not recommended)
./deploy-production.sh --skip-checks
```

### 4. Verify Deployment

```bash
# Check system status
./production-monitoring.sh

# Test database connection
docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "SELECT 'Production database ready' AS status;"
```

## 🔐 Security Features

### Production Security Configuration

✅ **Secure Credentials**
- Randomly generated 32-character passwords
- Unique production database user
- No hardcoded defaults

✅ **SSL/TLS Encryption**
- Production-grade SSL certificates
- Enforced encrypted connections
- Certificate rotation support

✅ **Database Hardening**
- Restricted user permissions
- Connection limits and timeouts
- Query logging and monitoring

✅ **Container Security**
- Non-root container execution
- Minimal attack surface
- Isolated network namespace

### Security Validation

```bash
# Run comprehensive security checks
./security-check.sh

# Validate SSL configuration
openssl s_client -connect localhost:5432 -starttls postgres
```

## 💾 Backup & Recovery

### Automated Backups

Production backups include:
- Daily compressed database dumps
- Encrypted backup files
- Automatic retention management
- Backup verification and checksums

```bash
# Manual backup
./production-backup.sh

# Check backup status
cat /opt/bsim/backups/latest_backup.json

# Restore from backup
./restore-backup.sh /opt/bsim/backups/bsim_production_20260113_120000.sql.gz.enc
```

### Backup Configuration

```bash
# Configure backup settings in .env.production
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION_KEY=<secure_key>
REMOTE_BACKUP_URL=s3://your-backup-bucket/bsim/
```

## 📊 Monitoring & Alerting

### Real-time Monitoring

```bash
# Generate monitoring report
./production-monitoring.sh

# Start continuous monitoring
./production-monitoring.sh --daemon

# Configure alerts in .env.production
ALERT_EMAIL=admin@yourdomain.com
SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

### Monitored Metrics

- **Database Health**: Connection status, query performance
- **Resource Usage**: CPU, memory, disk space
- **Security**: SSL certificate expiry, failed logins
- **Backups**: Backup success, retention compliance
- **Business**: Function count, signature growth

## 🛠️ Production Management

### Container Management

```bash
# Start production services
docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d

# Stop production services
docker-compose -f docker-compose.yml -f docker-compose.production.yml down

# View logs
docker logs bsim-postgres-production -f

# Container status
docker stats bsim-postgres-production
```

### Database Management

```bash
# Connect to production database
export PGPASSWORD=$(grep BSIM_DB_PASSWORD .env.production | cut -d= -f2)
docker exec -it bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2)

# Database maintenance
docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "VACUUM ANALYZE;"

# Performance tuning
docker exec bsim-postgres-production psql -U $(grep BSIM_DB_USER .env.production | cut -d= -f2) -d $(grep BSIM_DB_NAME .env.production | cut -d= -f2) -c "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"
```

## 🔄 Maintenance & Updates

### Regular Maintenance Tasks

**Daily**
- Monitor system resources
- Review security alerts
- Verify backup completion

**Weekly**
- Update Docker images
- Review database performance
- Check SSL certificate status

**Monthly**
- Rotate database credentials
- Update SSL certificates
- Review and update security policies

### Credential Rotation

```bash
# Generate new credentials
./generate-prod-credentials.sh --force

# Update running containers
docker-compose -f docker-compose.yml -f docker-compose.production.yml down
docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

## 🌐 Ghidra Integration

### Production Connection

```java
// Ghidra BSim connection for production
String url = "postgresql://username:password@your-server:5432/bsim_production?sslmode=require&sslcert=client.crt&sslkey=client.key&sslrootcert=ca.crt";
```

### Client Certificate Setup

```bash
# Copy client certificates for Ghidra
cp ssl/client-cert.pem /path/to/ghidra/ssl/
cp ssl/client-key.pem /path/to/ghidra/ssl/
cp ssl/ca.pem /path/to/ghidra/ssl/
```

## 🚨 Incident Response

### Emergency Procedures

**Database Down**
```bash
# Check container status
docker ps -a | grep bsim
docker logs bsim-postgres-production --tail 50

# Restart services
docker-compose -f docker-compose.yml -f docker-compose.production.yml restart bsim-postgres
```

**High Resource Usage**
```bash
# Check resource consumption
docker stats bsim-postgres-production
./production-monitoring.sh

# Scale resources (if needed)
docker-compose -f docker-compose.yml -f docker-compose.production.yml down
# Edit docker-compose.production.yml to increase resources
docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

**Security Incident**
```bash
# Immediate response
docker-compose -f docker-compose.yml -f docker-compose.production.yml down
./generate-prod-credentials.sh --force

# Investigate
docker logs bsim-postgres-production | grep -i "authentication\|error\|fail"
```

## 📞 Support & Troubleshooting

### Log Locations

- **Container Logs**: `docker logs bsim-postgres-production`
- **Backup Logs**: `/var/log/bsim-backup.log`
- **Monitor Logs**: `/var/log/bsim-monitoring.log`
- **Database Logs**: Inside container at `/var/log/postgresql/`

### Common Issues

**Connection Refused**
- Check if container is running
- Verify SSL certificates
- Check firewall settings

**Performance Issues**
- Review PostgreSQL configuration
- Check system resources
- Analyze slow queries

**Backup Failures**
- Verify disk space
- Check encryption keys
- Review backup script permissions

### Getting Help

1. Review logs for error messages
2. Run `./production-monitoring.sh` for system status
3. Check Docker container health
4. Consult TROUBLESHOOTING.md for common issues

## 🔒 Security Compliance

This production deployment meets:

- **Encryption**: All data encrypted in transit and at rest
- **Authentication**: Strong password policies and unique credentials
- **Authorization**: Principle of least privilege
- **Auditing**: Comprehensive logging and monitoring
- **Backup**: Encrypted, verified, and tested backups
- **Incident Response**: Automated alerting and response procedures

For security audits, provide:
- Security validation report: `./security-check.sh > security-audit.txt`
- SSL certificate details: `openssl x509 -in ssl/prod-server.crt -text`
- Backup verification: `cat /opt/bsim/backups/latest_backup.json`