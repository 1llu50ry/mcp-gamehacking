# 🚀 Production Deployment Guide

This guide provides step-by-step instructions for deploying the Ghidra BSim PostgreSQL platform in production environments.

## 📋 Pre-Deployment Checklist

### System Requirements
- **Operating System**: Ubuntu 20.04+ LTS (recommended)
- **RAM**: 16GB minimum, 32GB+ recommended
- **Storage**: 500GB+ SSD with RAID 1/5 for database
- **CPU**: 8+ cores for large-scale analysis
- **Network**: Gigabit Ethernet with firewall support

### Software Dependencies
- **Docker CE 20.10+**
- **Docker Compose 2.0+**
- **OpenSSL 1.1.1+**
- **Fail2ban** (for intrusion prevention)
- **UFW or iptables** (firewall)

## 🔧 Production Setup Steps

### Step 1: System Hardening

#### **OS Security Updates**
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install security updates automatically
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

#### **Firewall Configuration**
```bash
# Install and configure UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 5432/tcp from 10.0.0.0/8  # Restrict PostgreSQL to private network
sudo ufw enable

# Verify configuration
sudo ufw status verbose
```

#### **Fail2ban Setup**
```bash
# Install fail2ban
sudo apt install fail2ban -y

# Configure for PostgreSQL
sudo cat > /etc/fail2ban/jail.d/postgresql.conf << EOF
[postgresql]
enabled = true
port = 5432
filter = postgresql
logpath = /var/log/postgresql/postgresql-*.log
maxretry = 3
bantime = 3600
EOF

sudo systemctl restart fail2ban
```

### Step 2: Secure Credential Generation

#### **Generate Production Credentials**
```bash
# Create secure credentials script
cat > generate-prod-credentials.sh << 'EOF'
#!/bin/bash
set -e

# Generate secure database credentials
DB_USER="bsim_prod_$(openssl rand -hex 6)"
DB_PASSWORD=$(openssl rand -base64 32)

# Create production environment file
cat > .env.production << EOF
# Production BSim Database Configuration
BSIM_DB_NAME=bsim_production
BSIM_DB_USER=$DB_USER
BSIM_DB_PASSWORD=$DB_PASSWORD
BSIM_DB_PORT=5432

# Production SSL Configuration
SSL_CERT_COUNTRY=US
SSL_CERT_STATE=State
SSL_CERT_CITY=City
SSL_CERT_ORG="Your Organization"
SSL_CERT_UNIT="Security Team"
SSL_CERT_COMMON_NAME="bsim.yourdomain.com"

# Backup Configuration
BACKUP_RETENTION_WEEKS=12
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

echo "✅ Production credentials generated in .env.production"
echo "📋 Database User: $DB_USER"
echo "🔐 Password: [REDACTED - check .env.production file]"
echo "⚠️  Keep these credentials secure and never commit to git!"
EOF

chmod +x generate-prod-credentials.sh
./generate-prod-credentials.sh
```

#### **Secure Credential Storage**
```bash
# Set restrictive permissions
chmod 600 .env.production

# Create encrypted backup
gpg --symmetric --cipher-algo AES256 .env.production

# Store in secure location
sudo mkdir -p /etc/bsim-secrets
sudo mv .env.production.gpg /etc/bsim-secrets/
sudo chmod 700 /etc/bsim-secrets
sudo chown root:root /etc/bsim-secrets/*
```

### Step 3: SSL Certificate Setup

#### **Production SSL Certificates**
```bash
# Option 1: Generate CA-signed certificates (recommended)
# Use your organization's PKI or public CA like Let's Encrypt

# Option 2: Generate high-security self-signed certificates
openssl req -new -x509 -days 365 -nodes -sha256 \
    -out ssl/prod-server.crt \
    -keyout ssl/prod-server.key \
    -subj "/C=US/ST=State/L=City/O=Organization/OU=Security/CN=bsim.yourdomain.com"

# Set secure permissions
chmod 600 ssl/prod-server.key
chmod 644 ssl/prod-server.crt
```

### Step 4: Database Security Configuration

#### **PostgreSQL Hardening**
```bash
# Create production PostgreSQL configuration
cat > postgres-prod.conf << 'EOF'
# Production PostgreSQL Configuration
listen_addresses = '10.0.0.100'  # Specific IP only
port = 5432
ssl = on
ssl_cert_file = '/etc/ssl/certs/server.crt'
ssl_key_file = '/etc/ssl/private/server.key'
ssl_ciphers = 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384'
ssl_prefer_server_ciphers = on
ssl_min_protocol_version = 'TLSv1.2'

# Security settings
log_connections = on
log_disconnections = on
log_line_prefix = '%t [%p-%l] %q%u@%d '
log_statement = 'ddl'
log_min_duration_statement = 1000

# Performance settings for production
shared_buffers = 8GB
effective_cache_size = 24GB
maintenance_work_mem = 2GB
checkpoint_completion_target = 0.9
EOF
```

#### **Access Control Configuration**
```bash
# Create production pg_hba.conf
cat > pg_hba_prod.conf << 'EOF'
# Production PostgreSQL Access Control
local   all             postgres                                trust
local   all             all                                     peer

# BSim production user - SSL required
hostssl bsim_production bsim_prod_user 10.0.0.0/8 scram-sha-256

# Deny all other connections
host    all             all             0.0.0.0/0               reject
EOF
```

### Step 5: Production Docker Configuration

#### **Production docker-compose.yml**
```yaml
version: '3.8'

services:
  bsim-postgres:
    image: postgres:15-alpine
    container_name: bsim-postgres-prod
    restart: always
    environment:
      POSTGRES_DB: ${BSIM_DB_NAME}
      POSTGRES_USER: ${BSIM_DB_USER}
      POSTGRES_PASSWORD: ${BSIM_DB_PASSWORD}
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
    volumes:
      - bsim_postgres_data:/var/lib/postgresql/data
      - ./postgres-prod.conf:/etc/postgresql/postgresql.conf
      - ./ssl/prod-server.crt:/etc/ssl/certs/server.crt:ro
      - ./ssl/prod-server.key:/etc/ssl/private/server.key:ro
      - ./bsim-init:/docker-entrypoint-initdb.d
    ports:
      - "127.0.0.1:5432:5432"  # Bind to localhost only
    command: >
      postgres
      -c config_file=/etc/postgresql/postgresql.conf
      -c ssl=on
      -c ssl_cert_file=/etc/ssl/certs/server.crt
      -c ssl_key_file=/etc/ssl/private/server.key
    networks:
      - bsim-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${BSIM_DB_USER} -d ${BSIM_DB_NAME}"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "10"
    deploy:
      resources:
        limits:
          memory: 16G
          cpus: '8'

volumes:
  bsim_postgres_data:
    driver: local
    driver_opts:
      o: bind
      type: none
      device: /data/bsim/postgres  # Dedicated storage mount

networks:
  bsim-network:
    driver: bridge
    internal: false
```

### Step 6: Monitoring & Logging Setup

#### **Log Aggregation**
```bash
# Install log aggregation (example with rsyslog)
sudo apt install rsyslog -y

# Configure centralized logging
sudo cat >> /etc/rsyslog.conf << 'EOF'
# BSim container logs
$ModLoad imfile
$InputFileName /var/lib/docker/containers/*/*-json.log
$InputFileTag docker:
$InputFileStateFile docker-logs
$InputFileSeverity info
$InputFileFacility local0
$InputRunFileMonitor

local0.*    /var/log/bsim/docker.log
EOF

sudo systemctl restart rsyslog
```

#### **Monitoring Setup**
```bash
# Install monitoring tools
sudo apt install prometheus-node-exporter htop iotop -y

# Create monitoring script
cat > monitor-production.sh << 'EOF'
#!/bin/bash
# Production monitoring script

# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Database performance
docker exec bsim-postgres-prod psql -U postgres -c "
SELECT
    datname,
    numbackends,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    temp_files,
    temp_bytes
FROM pg_stat_database
WHERE datname = 'bsim_production';"

# Disk usage
df -h /data/bsim/

# Memory usage
free -h

# Recent errors
docker logs --tail=50 bsim-postgres-prod | grep -i error
EOF

chmod +x monitor-production.sh
```

### Step 7: Backup & Recovery

#### **Production Backup Strategy**
```bash
# Create encrypted backup script
cat > backup-production.sh << 'EOF'
#!/bin/bash
set -e

BACKUP_DIR="/backup/bsim"
ENCRYPT_KEY=$(cat /etc/bsim-secrets/.env.production | grep BACKUP_ENCRYPTION_KEY | cut -d= -f2)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Database backup
docker exec bsim-postgres-prod pg_dump -U postgres -d bsim_production | \
    gzip | \
    openssl enc -aes-256-cbc -salt -k "$ENCRYPT_KEY" > \
    "$BACKUP_DIR/bsim_prod_$TIMESTAMP.sql.gz.enc"

# Verify backup
if [ -f "$BACKUP_DIR/bsim_prod_$TIMESTAMP.sql.gz.enc" ]; then
    echo "✅ Backup created: bsim_prod_$TIMESTAMP.sql.gz.enc"

    # Remove old backups (keep 12 weeks)
    find "$BACKUP_DIR" -name "bsim_prod_*.sql.gz.enc" -mtime +84 -delete

    # Log backup
    echo "$(date): Backup successful" >> /var/log/bsim/backup.log
else
    echo "❌ Backup failed!"
    echo "$(date): Backup failed" >> /var/log/bsim/backup.log
    exit 1
fi
EOF

chmod +x backup-production.sh

# Schedule automated backups
(crontab -l 2>/dev/null; echo "0 2 * * 0 /path/to/project/backup-production.sh") | crontab -
```

### Step 8: Deployment Execution

#### **Deploy Production Environment**
```bash
# 1. Load production environment
cp .env.production .env

# 2. Start production services
docker-compose -f docker-compose.prod.yml up -d

# 3. Wait for startup
sleep 30

# 4. Verify deployment
./test-bsim-setup.sh --comprehensive

# 5. Run security validation
./security-check.sh

# 6. Test backup system
./backup-production.sh

echo "✅ Production deployment complete!"
```

## 📊 Post-Deployment Validation

### Security Testing
```bash
# Port scan validation
nmap -p 5432 localhost

# SSL configuration test
openssl s_client -connect localhost:5432 -starttls postgres

# Authentication test
PGPASSWORD=wrong_password psql -h localhost -p 5432 -U wrong_user -d bsim_production

# Check for default credentials
grep -r "bsim\|bsim_password" /path/to/project/ && echo "❌ Default credentials found!" || echo "✅ No default credentials"
```

### Performance Validation
```bash
# Connection test
time psql -h localhost -p 5432 -U $BSIM_DB_USER -d bsim_production -c "SELECT 1;"

# Database performance
docker exec bsim-postgres-prod psql -U postgres -c "SELECT * FROM bsim_capacity_stats();"

# Resource monitoring
docker stats --no-stream bsim-postgres-prod
```

## 🚨 Emergency Procedures

### Security Incident Response
```bash
# 1. Immediate isolation
sudo ufw deny 5432
docker stop bsim-postgres-prod

# 2. Evidence preservation
docker commit bsim-postgres-prod forensic-image-$(date +%s)
cp -r /data/bsim/postgres /forensics/bsim-$(date +%s)

# 3. Clean deployment
docker rm bsim-postgres-prod
docker volume rm bsim_postgres_data
git checkout main
# Follow deployment steps with new credentials
```

### Disaster Recovery
```bash
# 1. Stop services
docker-compose down

# 2. Restore from backup
LATEST_BACKUP=$(ls -t /backup/bsim/bsim_prod_*.sql.gz.enc | head -1)
openssl enc -d -aes-256-cbc -k "$ENCRYPT_KEY" -in "$LATEST_BACKUP" | \
    gunzip | \
    docker exec -i bsim-postgres-prod psql -U postgres -d bsim_production

# 3. Verify restoration
./test-bsim-setup.sh --comprehensive
```

## 📚 Maintenance Schedule

### Daily Tasks
- [ ] Monitor system resources
- [ ] Check application logs
- [ ] Verify backup completion

### Weekly Tasks
- [ ] Security updates
- [ ] Performance review
- [ ] Backup testing
- [ ] Log rotation

### Monthly Tasks
- [ ] Credential rotation
- [ ] Security scanning
- [ ] Capacity planning
- [ ] Documentation updates

### Quarterly Tasks
- [ ] SSL certificate renewal
- [ ] Disaster recovery testing
- [ ] Security audit
- [ ] Dependency updates

---

> **🔒 Security Reminder**: This platform handles sensitive malware samples and reverse engineering data. Maintain strict security controls and monitor for any unauthorized access attempts.