# BSim Database - Current Deployment Schema

**Last Updated**: January 14, 2026  
**Status**: ✅ **PRODUCTION READY** - Auto-initialization Enabled  
**Database Version**: PostgreSQL 15 with LSH Extension

---

## Overview

This document describes the **actually deployed state** of the BSim database in this project. As of January 14, 2026, the deployment now supports **automatic BSim schema creation** on container initialization. The database container automatically creates the complete BSim schema (18 tables, helper functions, and views) on first startup, making it ready for immediate use with Ghidra BSim tools.

### Initialization Modes

1. **Automatic Mode** (Default, `AUTO_CREATE_BSIM_SCHEMA=true`):
   - Full BSim schema auto-created on first container startup
   - No manual schema setup required
   - Ready for immediate use with Ghidra BSim
   
2. **Manual Mode** (`AUTO_CREATE_BSIM_SCHEMA=false`):
   - Minimal initialization only (legacy behavior)
   - BSim schema applied later via Ghidra tools or manual SQL

---

## Current Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Docker Container: bsim-postgres                                  │
│ Image: bsim-postgres:15-lshvector (custom build)                │
└────────────┬────────────────────────────────────────────────────┘
             │
             ├─► PostgreSQL 15 Base Installation
             │   - Port: 5432
             │   - Database: bsim
             │   - User: ben (configurable via BSIM_DB_USER)
             │   - Password: from BSIM_DB_PASSWORD env var
             │
             ├─► LSH Extension (lshvector.so)
             │   - Built from: github.com/NationalSecurityAgency/ghidra
             │   - Path: Ghidra/Features/BSim/src/lshvector
             │   - Files installed:
             │     • /usr/lib/postgresql/15/lib/lshvector.so
             │     • /usr/share/postgresql/15/extension/lshvector.control
             │     • /usr/share/postgresql/15/extension/lshvector--1.0.sql
             │
             ├─► Auto-Initialization Scripts (bsim-init/ → /docker-entrypoint-initdb.d/)
             │   - 00-ssl-setup.sh: Generate SSL certificates
             │   - 01-check-auto-create.sh: Check AUTO_CREATE_BSIM_SCHEMA flag
             │   - 02-enable-ssl.sh: Enable SSL in PostgreSQL
             │   - 03-init-minimal.sql: Grant privileges, test function
             │   - 04-create-bsim-schema.sql: Create full BSim schema (if AUTO_CREATE=true)
             │
             └─► BSim Schema (Conditional)
                 - Template: large_32 (100M functions capacity)
                 - Tables: 18 (12 official Ghidra + 6 compatibility)
                 - Functions: insert_vec(), remove_vec()
                 - Views: exe_category, exe_name_category
```

---

## Initialization Sequence

### Quick Start (Automatic Mode)

```bash
# 1. Configure environment (first time only)
cp .env.example .env
# Edit .env and set BSIM_DB_PASSWORD

# 2. Start containers
docker-compose up -d

# 3. Wait for initialization (~30 seconds)
docker logs bsim-postgres -f

# 4. Verify BSim schema is ready
docker exec -it bsim-postgres psql -U ben -d bsim -c "\dt"
```

**Result**: Full BSim schema auto-created, ready for Ghidra integration immediately.

---

### Detailed Initialization Steps

#### Step 1: Container Startup

```bash
docker-compose up -d bsim-postgres
```

**What happens:**
1. PostgreSQL 15 container starts
2. Environment variables loaded from `.env`:
   - `POSTGRES_DB=bsim`
   - `POSTGRES_USER=ben` (or custom via `BSIM_DB_USER`)
   - `POSTGRES_PASSWORD` (from `BSIM_DB_PASSWORD`)
   - `AUTO_CREATE_BSIM_SCHEMA=true` (default)
3. LSH extension already compiled into custom image
4. Volume mounts:
   - `bsim_postgres_data:/var/lib/postgresql/data` (persistent storage)
   - `./bsim-init:/docker-entrypoint-initdb.d:ro` (initialization scripts)

#### Step 2: Auto-Initialization Scripts

PostgreSQL executes scripts in `/docker-entrypoint-initdb.d/` **alphabetically** on first startup:

**00-ssl-setup.sh**: Generate SSL Certificates

```bash
openssl req -new -x509 -days 3650 -nodes \
  -out /var/lib/postgresql/data/server.crt \
  -keyout /var/lib/postgresql/data/server.key \
  -subj "/CN=bsim-postgres"
chmod 600 /var/lib/postgresql/data/server.key
chown postgres:postgres /var/lib/postgresql/data/server.*
```

**Result**: Self-signed SSL certificates valid for 10 years

**01-check-auto-create.sh**: Check AUTO_CREATE_BSIM_SCHEMA Flag

```bash
if [[ "${AUTO_CREATE_BSIM_SCHEMA}" == "true" ]]; then
    echo "✓ BSim schema will be auto-created"
else
    echo "✗ Skipping BSim schema auto-creation"
    rm -f "/docker-entrypoint-initdb.d/04-create-bsim-schema.sql"
fi
```

**Result**: Determines if BSim schema should be created automatically

**02-enable-ssl.sh**: Enable SSL in PostgreSQL

```bash
# Updates postgresql.conf
ssl = on
ssl_cert_file = '/var/lib/postgresql/data/server.crt'
ssl_key_file = '/var/lib/postgresql/data/server.key'
```

**Result**: PostgreSQL accepts SSL connections

**03-init-minimal.sql**: Basic Database Setup

```sql
-- Grant database creation privileges to the user
ALTER USER ben CREATEDB;

-- Create connectivity test function
```sql
-- Grant database creation privileges to the user
ALTER USER ben CREATEDB;

-- Create connectivity test function
CREATE OR REPLACE FUNCTION bsim_connectivity_test()
RETURNS TEXT
LANGUAGE SQL
AS $$
    SELECT 'BSim PostgreSQL database is ready for Ghidra integration' AS status;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION bsim_connectivity_test() TO ben;
```

**Result**: User `ben` can create databases, connectivity testing enabled

**04-create-bsim-schema.sql**: Create Full BSim Schema (Conditional)

This script runs **only if** `AUTO_CREATE_BSIM_SCHEMA=true`:

```sql
-- Idempotency check (skips if already initialized)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'exetable') THEN
        RAISE NOTICE 'BSim schema already exists. Skipping.';
        RAISE EXCEPTION 'BSim schema already initialized';
    END IF;
END $$;

-- Creates 18 tables, helper functions, views, indexes
-- Template: large_32 (100M functions, 32-bit executables, k=19, L=232)
```

**Result**: Full BSim schema created automatically, ready for use

---

## Current Database State

### With AUTO_CREATE_BSIM_SCHEMA=true (Default)

#### Databases

| Database | Owner | Purpose | Size |
|----------|-------|---------|------|
| `bsim` | `ben` | BSim analysis database | ~50 MB (with schema) |
| `postgres` | `postgres` | Default PostgreSQL database | System |
| `template0` | `postgres` | Template database | System |
| `template1` | `postgres` | Template database | System |

#### Users and Privileges

| User | Privileges | Purpose |
|------|-----------|---------|
| `ben` | CREATEDB, CONNECT, ALL ON bsim | BSim database owner |
| `postgres` | SUPERUSER | PostgreSQL admin |

#### Schemas

| Schema | Owner | Tables | Purpose |
|--------|-------|--------|---------|
| `public` | `postgres` | 18 | BSim schema (official + compatibility) |

#### Extensions Installed

| Extension | Version | Status | Purpose |
|-----------|---------|--------|---------|
| `lshvector` | 1.0 | ✅ Enabled | Locality-Sensitive Hashing for binary similarity |
| `plpgsql` | 1.0 | ✅ Installed | Procedural language for functions |

#### Functions Installed

| Function | Returns | Status | Purpose |
|----------|---------|--------|---------|
| `bsim_connectivity_test()` | TEXT | ✅ Created | Test database connectivity |
| `insert_vec()` | TRIGGER | ✅ Created | Insert LSH vectors into vectable |
| `remove_vec()` | TRIGGER | ✅ Created | Remove LSH vectors from vectable |

#### BSim Core Tables (18 Total)

**Official Ghidra Tables (12)**:
- `keyvaluetable` - BSim configuration (k, L, template, weights)
- `exetable` - Executable metadata (md5, name, architecture, compiler)
- `desctable` - Function descriptions (name, source file, flags)
- `vectable` - LSH vectors (lshvector type, ~430 bytes per function)
- `callgraphtable` - Call graph edges (caller → callee relationships)
- `archtable` - Architecture definitions (x86, ARM, MIPS, etc.)
- `cattable` - Category classification (malware families, libraries)
- `datatable` - Binary data storage (strings, constants)
- `sighittable` - Signature hit tracking (query results cache)
- `sigproptable` - Signature propagation (analysis workflow)
- `stringtable` - String literals and references
- `tagtable` - User-defined tags and annotations

**Compatibility Tables (6)**:
- `executable` - View/compatibility layer for exetable
- `function` - View/compatibility layer for desctable
- `signature` - View/compatibility layer for function signatures
- `vector` - View/compatibility layer for vectable
- `callgraph` - View/compatibility layer for callgraphtable
- `feature` - View/compatibility layer for feature extraction

#### Indexes and Optimization

- **Primary Keys**: All tables have proper primary keys
- **Foreign Keys**: Referential integrity enforced
- **B-Tree Indexes**: On md5, function_id, executable_id
- **GiST Indexes**: On lshvector columns for similarity search
- **Partitioning**: Ready for future implementation (100M+ functions)

---

### With AUTO_CREATE_BSIM_SCHEMA=false (Manual Mode)

Same as legacy behavior (minimal initialization only):

#### Extensions Installed

| Extension | Version | Status | Purpose |
|-----------|---------|--------|---------|
| `lshvector` | 1.0 | ✅ Available | Locality-Sensitive Hashing for binary similarity |
| `plpgsql` | 1.0 | ✅ Installed | Procedural language for functions |

#### Functions Installed

| Function | Returns | Status | Purpose |
|----------|---------|--------|---------|
| `bsim_connectivity_test()` | TEXT | ✅ Created | Test database connectivity |

#### BSim Tables (Manual Mode)

❌ **Not Created** - BSim tables must be created manually via:
- Ghidra: `./bsim createdatabase postgresql://user:pass@localhost:5432/bsim medium_32`
- Manual SQL: `psql -U ben -d bsim < bsim-init/04-create-bsim-schema.sql`

---

## Configuration

### Environment Variables (.env)

```bash
# BSim Database Configuration
BSIM_DB_NAME=bsim                       # Database name
BSIM_DB_USER=ben                        # Database user
BSIM_DB_PASSWORD=your_secure_password   # Database password (change!)
BSIM_DB_PORT=5432                       # Database port

# Auto-Creation Feature
AUTO_CREATE_BSIM_SCHEMA=true            # Enable auto-creation (default: true)
                                        # Set to false for manual schema setup
```

### Switching Between Modes

**Enable Auto-Creation** (Recommended for new deployments):
```bash
# In .env
AUTO_CREATE_BSIM_SCHEMA=true

# Recreate container from scratch
docker-compose down -v
docker-compose up -d
```

**Disable Auto-Creation** (For custom schemas or existing databases):
```bash
# In .env
AUTO_CREATE_BSIM_SCHEMA=false

# Recreate container
docker-compose down -v
docker-compose up -d
```

### Idempotency

The auto-creation script is **idempotent**:
- Safe to run multiple times
- Skips schema creation if `exetable` already exists
- Logs: "BSim schema already exists. Skipping initialization."

To force re-initialization:
```bash
# Method 1: Remove volume (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d

# Method 2: Manual database drop (preserves other databases)
docker exec -it bsim-postgres psql -U postgres -c "DROP DATABASE bsim; CREATE DATABASE bsim OWNER ben;"
docker restart bsim-postgres
```

---

## Schema Application Methods (Manual Mode Only)

These methods are only needed if `AUTO_CREATE_BSIM_SCHEMA=false`:

### Method 1: Ghidra CLI (Recommended)

```bash
# Using Ghidra's bsim command-line tool
./bsim createdatabase postgresql://ben:bsim@localhost:5432/bsim medium_32
# Options: medium_32 (10M functions), large_32 (100M), medium_64 (10M 64-bit)
```

### Method 2: Manual SQL Execution

```bash
# Execute the consolidated schema file
docker exec -i bsim-postgres psql -U ben -d bsim < bsim-init/04-create-bsim-schema.sql
```

### Method 3: Ghidra Script

**Script**: [ghidra-scripts/CreateProjectBSimDatabaseScript.java](../ghidra-scripts/CreateProjectBSimDatabaseScript.java)

```bash
# Run from Ghidra Script Manager
# Script automatically creates BSim schema with medium_32 template
# - Configures database for 32-bit x86 analysis
```

**Advantages**:
- Idempotent (safe to run multiple times)
- Auto-configures for project requirements
- Installs all required functions and tables
- Creates appropriate indexes

**Configuration**:
```java
// Hardcoded in script
host = "***REMOVED***"
port = 5432
database = "bsim"
user = "ben"
template = "medium_32"  // 32-bit x86 optimized
```

### Method 2: Ghidra Command Line

```bash
# From Ghidra installation directory
./bsim createdatabase postgresql://ben:bsim@***REMOVED***:5432/bsim medium_32
```

**Advantages**:
- Official Ghidra tool
- Flexible template selection
- Non-interactive automation

### Method 3: Manual SQL Execution

```bash
# Apply base schema manually
docker exec -i bsim-postgres psql -U ben -d bsim < create-bsim-schema.sql

# Apply helper functions
docker exec -i bsim-postgres psql -U ben -d bsim < create-bsim-functions.sql
```

**Advantages**:
- Full control over schema
- Can customize before applying
- No Ghidra installation required

**Disadvantages**:
- Manual process
- No automatic validation
- Must manage schema versions manually

---

## Verification Procedures

### Check Database Connectivity

```bash
# Test from host machine
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT bsim_connectivity_test();"
```

**Expected Output**:
```
                      bsim_connectivity_test
──────────────────────────────────────────────────────────────
 BSim PostgreSQL database is ready for Ghidra integration
```

### Check LSH Extension

```bash
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT * FROM pg_available_extensions WHERE name = 'lshvector';"
```

**Expected Output**:
```
   name    | default_version | installed_version | comment
───────────┼─────────────────┼───────────────────┼─────────
 lshvector | 1.0             | 1.0               | LSH vector support for BSim
```

### Check SSL Status

```bash
docker exec -it bsim-postgres psql -U ben -d bsim -c "SHOW ssl;"
```

**Expected Output**:
```
 ssl
─────
 on
```

### Check Schema Status

```bash
# Check if BSim tables exist
docker exec -it bsim-postgres psql -U ben -d bsim -c "\dt"
```

**Expected Output (Before Schema Application)**:
```
Did not find any relations.
```

**Expected Output (After Schema Application)**:
```
                 List of relations
 Schema |       Name        | Type  | Owner
────────┼───────────────────┼───────┼───────
 public | archtable         | table | ben
 public | callgraphtable    | table | ben
 public | desctable         | table | ben
 public | exetable          | table | ben
 public | keyvaluetable     | table | ben
 public | vectable          | table | ben
 ...
```

### Check BSim Configuration (After Schema Applied)

```bash
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT * FROM keyvaluetable WHERE key IN ('template', 'k', 'L');"
```

**Expected Output**:
```
    key    |  value   |   val
───────────┼──────────┼──────────
 template  | large_32 | large_32
 k         | 19       | 19
 L         | 232      | 232
```

---

## Connection Strings

### From Docker Host

```bash
# PostgreSQL standard connection
postgresql://ben:bsim@localhost:5432/bsim

# With SSL
postgresql://ben:bsim@localhost:5432/bsim?sslmode=require

# Ghidra BSim format
ghidra://ben:bsim@localhost:5432/bsim
```

### From Docker Network

```bash
# Container-to-container communication
postgresql://ben:bsim@bsim-postgres:5432/bsim
```

### Environment Variables

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=bsim
export PGUSER=ben
export PGPASSWORD=bsim
```

---

## File Locations

### Inside Container

| Path | Purpose | Persistence |
|------|---------|-------------|
| `/var/lib/postgresql/data/` | Database files | ✅ Docker volume |
| `/var/lib/postgresql/data/server.crt` | SSL certificate | ✅ Docker volume |
| `/var/lib/postgresql/data/server.key` | SSL private key | ✅ Docker volume |
| `/usr/lib/postgresql/15/lib/lshvector.so` | LSH extension binary | 🔄 Image layer |
| `/usr/share/postgresql/15/extension/` | Extension control files | 🔄 Image layer |

### On Docker Host

| Path | Purpose | Access |
|------|---------|--------|
| `./repo-data/` | Not currently used | Planned |
| `./backups/` | Database backups | Via scripts |
| `./.env` | Environment configuration | Read by docker-compose |
| `./docker-compose.yml` | Container orchestration | Docker Compose |

---

## Security Considerations

### Current Security State

| Feature | Status | Production-Ready? |
|---------|--------|-------------------|
| SSL Encryption | ✅ Enabled | ⚠️ Self-signed cert |
| Password Security | ⚠️ Default password | ❌ Change required |
| Network Isolation | ✅ Docker network | ✅ Yes |
| Port Exposure | ✅ localhost only | ✅ Yes |
| User Privileges | ✅ CREATEDB only | ✅ Yes |
| Database Encryption | ❌ Not enabled | ⚠️ Consider for production |

### Production Hardening Checklist

- [ ] Change default password (`POSTGRES_PASSWORD` in `.env`)
- [ ] Use production SSL certificates (not self-signed)
- [ ] Enable database encryption at rest
- [ ] Configure pg_hba.conf for specific IP restrictions
- [ ] Enable audit logging (`log_statement = 'all'`)
- [ ] Set up automated backups
- [ ] Configure connection pooling (pgBouncer)
- [ ] Enable query logging for monitoring

---

## Performance Configuration

### Current Settings (Defaults)

```ini
shared_buffers = 128MB          # Default PostgreSQL setting
work_mem = 4MB                  # Default PostgreSQL setting
maintenance_work_mem = 64MB     # Default PostgreSQL setting
max_connections = 100           # Default PostgreSQL setting
```

### Recommended for Large BSim (100M+ Functions)

```ini
shared_buffers = 2GB            # 25% of available RAM
work_mem = 64MB                 # For large LSH operations
maintenance_work_mem = 512MB    # For index creation
max_connections = 50            # BSim is compute-heavy, not connection-heavy
effective_cache_size = 6GB      # 75% of available RAM
random_page_cost = 1.1          # For SSD storage
```

**To apply**: Create `postgresql.conf.d/performance.conf` and mount to container

---

## Backup and Recovery

### Current Backup Strategy

Backups managed via [backup.sh](../backup.sh) / [backup.ps1](../backup.ps1):

```bash
# Create backup
./backup.sh -BackupName "manual-backup-$(date +%Y%m%d)"

# Backups stored in: ./backups/
# Format: pg_dump SQL + compressed archive
```

### Restore Procedure

```bash
# Stop containers
docker-compose down

# Restore from backup
./restore.sh -BackupFile "./backups/backup-20260114.zip" --force

# Restart containers
docker-compose up -d
```

---

## Monitoring and Logs

### View Container Logs

```bash
# Real-time logs
docker logs -f bsim-postgres

# Last 100 lines
docker logs --tail 100 bsim-postgres
```

### PostgreSQL Query Logs

```bash
# Enable query logging (temporary)
docker exec -it bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET log_statement = 'all';"
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT pg_reload_conf();"

# View logs
docker exec -it bsim-postgres cat /var/log/postgresql/postgresql-15-main.log
```

### Database Statistics

```bash
# Database size
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT pg_size_pretty(pg_database_size('bsim'));"

# Table sizes (after schema applied)
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs bsim-postgres

# Common causes:
# - Port 5432 already in use
# - Corrupted data directory
# - Insufficient disk space

# Fix: Stop conflicting services
sudo netstat -tlnp | grep 5432
```

### Can't Connect to Database

```bash
# Test connectivity
./test-connectivity.sh

# Check if container is running
docker ps | grep bsim-postgres

# Check network
docker network inspect re-universe_default
```

### LSH Extension Not Found

```bash
# Verify extension files exist
docker exec -it bsim-postgres ls -la /usr/lib/postgresql/15/lib/lshvector.so
docker exec -it bsim-postgres ls -la /usr/share/postgresql/15/extension/lshvector*

# Rebuild container if missing
docker-compose build --no-cache bsim-postgres
docker-compose up -d bsim-postgres
```

### SSL Connection Issues

```bash
# Check SSL status
docker exec -it bsim-postgres psql -U ben -d bsim -c "SHOW ssl;"

# Regenerate certificates
docker exec -it bsim-postgres bash /docker-entrypoint-initdb.d/00-ssl-setup.sh
docker-compose restart bsim-postgres
```

---

## Related Documentation

- [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md) - Official Ghidra BSim schema reference
- [BSIM-SCHEMA-EXTENSION.md](BSIM-SCHEMA-EXTENSION.md) - Planned documentation propagation extensions
- [BSIM-SCHEMA-DIAGRAM.md](BSIM-SCHEMA-DIAGRAM.md) - Entity-relationship diagrams
- [BSIM-SETUP.md](../BSIM-SETUP.md) - Complete setup guide
- [BSIM-SSL-SETUP.md](BSIM-SSL-SETUP.md) - SSL configuration guide

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 1.0 | Initial documentation of current deployment state |

---

*This document reflects the actual deployed state of the BSim database. For the full schema specification, see [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md).*
