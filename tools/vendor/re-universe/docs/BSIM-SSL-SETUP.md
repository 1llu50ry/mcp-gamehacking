# BSim Database SSL Configuration Guide

## Overview

Ghidra BSim requires SSL-enabled PostgreSQL connections for database operations. This guide documents the SSL setup requirements and troubleshooting steps for BSim database creation.

## SSL Requirements

### Why SSL is Required

Ghidra BSim tools enforce SSL connections to PostgreSQL databases by default. Attempting to connect to a non-SSL PostgreSQL instance will result in the following error:

```
Failed to create database: SQL error during -createdatabase- :
Could not create database: Cannot create PoolableConnectionFactory
(The server does not support SSL.)
```

### SSL Configuration in docker-compose.yml

The PostgreSQL container must be configured with SSL enabled:

```yaml
services:
  bsim-postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=${BSIM_DB_NAME:-bsim}
      - POSTGRES_USER=${BSIM_DB_USER:-ben}
      - POSTGRES_PASSWORD=${BSIM_DB_PASSWORD}
    command: >
      postgres
      -c ssl=on
      -c password_encryption=scram-sha-256
      -c log_statement=all
      -c shared_preload_libraries=pg_stat_statements
      # ... other performance optimizations
```

### SSL Certificate Handling

PostgreSQL automatically generates self-signed SSL certificates when `ssl=on` is specified and no certificates exist. This is sufficient for BSim operations.

**Key Points:**
- Self-signed certificates work for local BSim operations
- PostgreSQL will auto-generate certificates on first startup with SSL enabled
- Certificate files are stored in `/var/lib/postgresql/data/` within the container
- No manual certificate generation is required for basic BSim functionality

## Verification Steps

### 1. Check SSL Status

Verify SSL is enabled in PostgreSQL:

```bash
docker exec bsim-postgres psql -U ben -d bsim -c "SHOW ssl;"
```

Expected output:
```
 ssl
-----
 on
```

### 2. Test Database Connection

Test that the BSim database is accessible:

```bash
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT 'SSL enabled and working' as status;"
```

### 3. Verify BSim Configuration

Check BSim database configuration:

```bash
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM bsim_database_info();"
```

## Troubleshooting SSL Issues

### Error: "The server does not support SSL"

**Problem:** PostgreSQL SSL is not enabled
**Solution:**
1. Add `ssl=on` to PostgreSQL command in docker-compose.yml
2. Restart the PostgreSQL container: `docker-compose restart bsim-postgres`
3. Verify SSL is enabled using verification steps above

### Error: SSL certificate permissions

**Problem:** Custom SSL certificate files have incorrect permissions
**Solution:**
- Use auto-generated certificates (recommended)
- Remove custom certificate volumes from docker-compose.yml
- Let PostgreSQL generate certificates automatically

### Error: SSL connection refused

**Problem:** SSL port or configuration issues
**Solution:**
1. Check PostgreSQL logs: `docker logs bsim-postgres`
2. Verify container is running: `docker ps | grep bsim-postgres`
3. Check SSL configuration in PostgreSQL

## Implementation Timeline

### Initial Issue Discovery
- **Date:** 2026-01-12
- **Error:** BSim database creation failed due to missing SSL support
- **Ghidra Version:** 11.4.2
- **PostgreSQL Version:** 15

### Resolution Applied
1. **SSL Configuration Added:** Modified docker-compose.yml to enable SSL
2. **Certificate Management:** Configured auto-generation of SSL certificates
3. **Database Recreation:** Cleared database and recreated with SSL enabled
4. **Verification:** Confirmed BSim database creation works with SSL

### Final Configuration
- **SSL Status:** Enabled (`ssl=on`)
- **Certificate Type:** Auto-generated self-signed
- **BSim Template:** large_32 (k=19, L=232)
- **Database Tables:** 22 tables created successfully
- **Connection Status:** Verified working

## Best Practices

### Security Considerations
1. **Production Deployments:** Use properly signed SSL certificates
2. **Certificate Rotation:** Plan for certificate renewal in production
3. **Access Control:** Restrict database access to authorized BSim clients
4. **Monitoring:** Monitor SSL connection attempts and failures

### Performance Optimization
1. **SSL Overhead:** SSL adds minimal overhead for BSim operations
2. **Connection Pooling:** Consider connection pooling for high-volume BSim analysis
3. **Certificate Caching:** PostgreSQL caches SSL certificates for performance

### Maintenance
1. **Regular Updates:** Keep PostgreSQL updated for security patches
2. **Log Monitoring:** Monitor PostgreSQL logs for SSL-related issues
3. **Backup Considerations:** Include SSL configuration in backup procedures

## Configuration Summary

The working BSim SSL configuration requires:

1. **PostgreSQL SSL enabled** (`-c ssl=on`)
2. **Auto-generated certificates** (no custom certificates needed)
3. **Environment variables** properly configured in `.env`
4. **Database recreation** after SSL enablement
5. **Verification** of SSL status and BSim functionality

This configuration enables Ghidra BSim tools to successfully connect and create databases without SSL-related errors.

## LSH Vector Extension Verification

The BSim database includes the required `lshvector` extension for locality-sensitive hashing:

### Check Extension Status
```bash
# Verify lshvector extension is installed
docker exec bsim-postgres psql -U ben -d bsim -c "\dx lshvector"

# Check lshvector data type availability
docker exec bsim-postgres psql -U ben -d bsim -c "\dT lshvector"

# Verify BSim tables with LSHVECTOR columns exist
docker exec bsim-postgres psql -U ben -d bsim -c "\d vectable"
```

### Extension Details
- **Source**: Compiled from Ghidra's BSim lshvector C extension
- **Version**: 1.0
- **Installation**: Automatically built via custom Dockerfile
- **Functions**: 13 lshvector-related functions available
- **Tables**: `vectable` and `signature` tables support LSHVECTOR data type