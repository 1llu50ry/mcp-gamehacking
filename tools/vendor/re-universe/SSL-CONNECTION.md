# BSim PostgreSQL SSL Connection Guide

The BSim PostgreSQL database is now configured with SSL support to resolve the "The server does not support SSL" error in Ghidra.

## Quick Solution

Use this connection URL in Ghidra BSim:
```
postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require
```

## SSL Configuration Details

### Current SSL Setup
- **SSL Status**: ✅ Enabled
- **Certificate Type**: Self-signed certificate
- **Certificate Location**: `./ssl/ca.crt`
- **Valid For**: 365 days from creation

### Connection Options

#### Option 1: SSL Required (Recommended)
```
postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require
```
- ✅ Secure connection
- ✅ Works with self-signed certificates
- ✅ Recommended for production use

#### Option 2: SSL with Certificate Verification
If you need to verify the certificate (advanced users):
```
postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=verify-ca&sslrootcert=./ssl/ca.crt
```

#### Option 3: SSL Disabled (For Testing Only)
```
postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=false&sslmode=disable
```
- ⚠️ **Not recommended for production**
- Use only for testing if SSL causes issues

## Troubleshooting SSL Issues

### If Ghidra Still Shows SSL Error

1. **Check Container Status**:
   ```bash
   ./test-bsim-setup.sh
   ```

2. **Verify SSL is Enabled**:
   ```bash
   docker exec bsim-postgres psql -U ben -d bsim -c "SHOW ssl;"
   ```

3. **Check Certificate Files**:
   ```bash
   ls -la ./ssl/ca.crt
   docker exec bsim-postgres ls -la /var/lib/postgresql/data/server.*
   ```

### If SSL Connection Fails

1. **Try SSL Required Mode First**:
   ```
   postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require
   ```

2. **Check Java SSL Configuration** (if needed):
   - Ghidra uses Java's SSL implementation
   - Self-signed certificates should work with `sslmode=require`
   - If issues persist, you may need to import the certificate into Java's keystore

3. **Add Certificate to Java Keystore** (advanced):
   ```bash
   # Find Java installation
   java -XshowSettings:properties -version 2>&1 | grep java.home

   # Import certificate (replace JAVA_HOME with actual path)
   keytool -importcert -file ./ssl/ca.crt -keystore $JAVA_HOME/lib/security/cacerts -alias bsim-postgres
   ```

### SSL Certificate Renewal

The SSL certificate is valid for 365 days. To renew:

1. **Stop the container**:
   ```bash
   docker-compose down bsim-postgres
   ```

2. **Remove old certificates**:
   ```bash
   docker volume rm re-universe_bsim_postgres_data
   ```

3. **Restart container** (will generate new certificates):
   ```bash
   docker-compose up -d bsim-postgres
   ```

## Connection Test

To verify SSL is working, you should be able to connect from Ghidra BSim using the SSL-enabled URL without the "server does not support SSL" error.

### Expected Behavior
- ✅ **Before**: "The server does not support SSL" error
- ✅ **After**: Successful BSim database connection
- ✅ **SSL Status**: Connection established with SSL encryption

## Additional Resources

- **BSim Setup Guide**: `BSIM-SETUP.md`
- **Verification Script**: `./test-bsim-setup.sh`
- **PostgreSQL SSL Documentation**: https://www.postgresql.org/docs/current/ssl-tcp.html