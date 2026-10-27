# Ghidra BSim with PostgreSQL Setup Guide

This project provides a complete, production-ready setup for Ghidra BSim (Binary Similarity) analysis with a PostgreSQL database backend. BSim enables you to find similar functions across different binaries, making it invaluable for malware analysis, code reuse detection, and reverse engineering.

## 🚨 **SECURITY WARNING**

> **⚠️ CRITICAL**: This setup contains default credentials for development/testing only.
> **NEVER use default credentials in production environments.**
> **See [PRODUCTION-SECURITY.md](PRODUCTION-SECURITY.md) for production deployment guidance.**

## 🚀 Quick Start

### Development/Testing Setup

1. **Start the BSim database:**
   ```bash
   ./start-bsim.sh
   ```

2. **Connect from Ghidra:**
   - Open Ghidra → Tools → BSim Search
   - Server: `postgresql://[username]:[password]@localhost:5432/bsim`
   - **⚠️ Important:** Check "Use SSL" (required for BSim database creation)

   > **SSL Requirement:** Ghidra BSim requires SSL-enabled PostgreSQL connections. The database is automatically configured with SSL enabled. See [BSIM-SSL-SETUP.md](BSIM-SSL-SETUP.md) for troubleshooting.

3. **Ingest your first binary:**
   ```bash
   ./ingest-binary.sh /path/to/your/executable.exe
   ```

### Production Deployment

**🔒 For production use:**
1. **Read [PRODUCTION-SECURITY.md](PRODUCTION-SECURITY.md) first**
2. **Change ALL default credentials in `.env`**
3. **Generate secure SSL certificates**
4. **Configure firewall and monitoring**
5. **Test security controls**

## 📋 Prerequisites

### Required Software
- **Docker and Docker Compose** - For PostgreSQL container management
- **Ghidra 11.4.2 or newer** - With BSim extension enabled
- **Git** - For cloning Ghidra source code
- **Build tools** - gcc, make, PostgreSQL development headers

### System Requirements
- **RAM**: 8GB+ recommended for large datasets
- **Storage**: 50GB+ for large BSim databases (100M+ functions)
- **CPU**: Multi-core recommended for parallel analysis
- **OS**: Ubuntu Linux (tested and optimized)

### Ghidra BSim Extension
The PostgreSQL LSH extension must be built from Ghidra source:

```bash
# Clone official Ghidra repository (OUTSIDE the re-universe project)
# Do this in a separate directory (e.g., /opt or ~/projects)
cd /opt  # or your preferred location for external projects
git clone https://github.com/NationalSecurityAgency/ghidra.git
cd ghidra

# Build the LSH extension
cd Ghidra/Features/BSim/src/lshvector
make
sudo make install
```

## 🏗️ Architecture Overview

### Components
- **PostgreSQL 15 Container**: Secure database backend with SSL support
- **LSH Extension**: Official Ghidra Locality Sensitive Hashing extension
- **BSim Schema**: Large-scale database schema (large_32 template)
- **Automated Backups**: Weekly scheduled backups with retention
- **SSL/TLS Security**: Certificate-based encrypted connections

### Database Configuration
- **Template**: `large_32` - Optimized for 32-bit executables
- **Capacity**: ~100 million functions
- **LSH Parameters**: k=19, L=232
- **Architecture**: 32-bit optimized, size-agnostic compatibility

## 🔧 Installation and Setup

### 1. Container Setup

Start the PostgreSQL container with BSim configuration:

```bash
# Start the database container
docker-compose up -d bsim-postgres

# Verify container is running
docker ps | grep bsim-postgres
```

### 2. Database Initialization

The database is automatically initialized on first startup with:
- Complete BSim schema (large_32 template)
- LSH extension functions
- Proper indexes for large-scale performance
- SSL certificate configuration

### 3. Verify Setup

```bash
# Test database connectivity
./test-bsim-setup.sh

# Check BSim configuration
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM bsim_database_info();"
```

## 🔗 Database Connection

### Connection Details
- **URL**: `postgresql://ben:bsim@localhost:5432/bsim`
- **Host**: `localhost`
- **Port**: `5432`
- **Database**: `bsim`
- **Username**: `ben`
- **Password**: `bsim`
- **SSL**: Required (certificates auto-generated)

### From Ghidra BSim
1. Open Ghidra
2. Go to **Tools** → **Binary Similarity** → **BSim**
3. Create new server configuration:
   - **URL**: `postgresql://ben:bsim@localhost:5432/bsim`
   - **SSL**: Enable "Use SSL"
   - Test connection

### SSL Configuration
SSL certificates are automatically generated and configured:
- **CA Certificate**: `./ssl/ca.crt`
- **Server Certificate**: `./ssl/server.crt`
- **Server Key**: `./ssl/server.key`

## 📊 Database Schema

### Official Ghidra BSim Tables
- **exetable**: Official executable metadata table (MD5, architecture, compiler)
- **desctable**: Function descriptions with signatures and addresses
- **vectable**: LSH vector storage with compressed binary data
- **callgraphtable**: Function call graph relationships
- **execattable**: Executable attributes and categories
- **weighttable**: LSH weight coefficients (583 entries for large_32)
- **idflookup**: ID mapping table for BSim operations

### Additional Tables (Backwards Compatibility)
- **executable**: Extended binary metadata (mirrors exetable with additional fields)
- **function**: Function definitions with addresses
- **signature**: LSH feature vectors for similarity matching
- **vector**: Individual LSH hash values
- **callgraph**: Function call relationships

### Monitoring Views
```sql
-- Database statistics
SELECT * FROM bsim_statistics;

-- Capacity utilization
SELECT * FROM bsim_capacity_stats();
```

## 🛠️ Usage Workflows

### Binary Ingestion
```bash
# Ingest a single binary
./ingest-binary.sh /path/to/executable.exe

# Batch ingest from directory
find /malware/samples -name "*.exe" -exec ./ingest-binary.sh {} \;
```

### Similarity Search
1. **From Ghidra GUI**:
   - Analyze target binary in Ghidra
   - Tools → BSim Search → Query Functions
   - Set similarity threshold (0.7+ recommended)

2. **Command Line**:
   ```bash
   # Query similar functions
   ./query-bsim.sh --function "main" --threshold 0.8
   ```

### Database Management
```bash
# Monitor database status
./monitor-bsim.sh

# Create manual backup
./bsim-backup.sh --name "pre-analysis-backup"

# Clean up old data
./cleanup-bsim.sh --older-than 30d
```

## 📁 Automated Backups

### Backup Schedule
- **Frequency**: Weekly (Sundays at 2:00 AM)
- **Retention**: 4 weeks
- **Location**: `./backups/bsim/`
- **Compression**: gzip

### Manual Backup
```bash
# Create backup with custom name
./bsim-backup.sh --name "my-custom-backup"

# Restore from backup
./restore-bsim.sh --backup "my-custom-backup"
```

## 📈 Performance Optimization

### Database Tuning
The database is pre-configured for large-scale analysis:
- **shared_buffers**: 8GB
- **effective_cache_size**: 48GB
- **maintenance_work_mem**: 2GB
- **checkpoint_completion_target**: 0.9

### Monitoring Performance
```bash
# Check database performance
./monitor-bsim.sh --performance

# View active queries
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

## 🔍 Troubleshooting

### Common Issues

#### 1. "Database does not exist"
```bash
# Check container status
docker ps | grep bsim-postgres

# Verify database exists
docker exec bsim-postgres psql -U ben -l | grep bsim

# Reinitialize if needed
docker-compose down
docker volume rm re-universe_bsim_postgres_data
docker-compose up -d bsim-postgres
```

#### 2. "Could not fetch key value: name"
```bash
# Check BSim configuration
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM keyvaluetable;"

# Reinitialize schema if missing
docker exec bsim-postgres psql -U ben -d bsim -f /docker-entrypoint-initdb.d/create-bsim-schema.sql
```

#### 3. "The server does not support SSL"
```bash
# Verify SSL configuration
docker exec bsim-postgres psql -U ben -d bsim -c "SHOW ssl;"

# Check certificate files
ls -la ssl/
```

#### 4. "LSH functions not found"
```bash
# Check LSH extension
docker exec bsim-postgres psql -U ben -d bsim -c "\dx lsh"

# Rebuild if needed
cd ghidra/Ghidra/Features/BSim/src/lshvector
make clean && make && sudo make install
```

#### 5. "Column 'architecture' does not exist"
```bash
# This error indicates schema compatibility issues
# The database schema has been updated to include all required tables
# Verify the schema includes official Ghidra BSim tables
docker exec bsim-postgres psql -U ben -d bsim -c "\dt"

# Check if exetable has architecture column
docker exec bsim-postgres psql -U ben -d bsim -c "\d exetable" | grep architecture
```

#### 6. "Table 'exetable' does not exist"
```bash
# This indicates the schema wasn't properly initialized
# Reinitialize with the updated schema
docker exec bsim-postgres psql -U ben -d bsim -f /docker-entrypoint-initdb.d/create-bsim-schema.sql
```

#### 7. Performance Issues
```bash
# Check database size
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM bsim_statistics;"

# Monitor resource usage
docker stats bsim-postgres

# Consider upgrading to large_64 template for very large datasets
```

### Log Analysis
```bash
# Container logs
docker logs bsim-postgres

# PostgreSQL logs
docker exec bsim-postgres tail -f /var/log/postgresql/postgresql-15-main.log

# BSim operation logs
./monitor-bsim.sh --logs
```

## 🔒 Security Considerations

### SSL/TLS
- **Encryption**: All connections use TLS 1.2+
- **Certificates**: Auto-generated self-signed certificates
- **Production**: Replace with CA-signed certificates

### Access Control
- **Database User**: Limited to BSim operations only
- **Network**: Container exposed only to localhost
- **Backups**: Encrypted and access-controlled

### Credential Management
```bash
# Change default password
./change-bsim-password.sh --new-password "your-secure-password"

# Rotate SSL certificates
./renew-ssl-certs.sh
```

## 📚 Advanced Usage

### Custom Templates
```bash
# Create custom template for specific use case
./create-bsim-template.sh --name "malware_analysis" --k 15 --L 128

# Use custom template
./setup-bsim.sh --template "malware_analysis"
```

### Batch Operations
```bash
# Parallel binary ingestion
./parallel-ingest.sh --directory /large/dataset --threads 8

# Bulk similarity analysis
./batch-similarity.sh --input-list binaries.txt --output results.json
```

### Integration with CI/CD
```bash
# Automated malware analysis pipeline
./ci-bsim-analysis.sh --new-samples /incoming --report /reports
```

## 🧪 Testing and Validation

### Automated Tests
```bash
# Run complete test suite
./test-bsim-setup.sh --comprehensive

# Test specific components
./test-bsim-setup.sh --test ssl
./test-bsim-setup.sh --test lsh
./test-bsim-setup.sh --test schema
```

### Manual Validation
```bash
# Verify LSH extension
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT lsh_compare('{1,2,3}', '{1,2,4}');"

# Test similarity matching
./validate-similarity.sh --test-binary /path/to/known/binary
```

## 🔄 Maintenance

### Regular Tasks
- **Weekly**: Automated backups
- **Monthly**: Update database statistics
- **Quarterly**: Review and clean old data
- **Annually**: Update Ghidra and rebuild LSH extension

### Maintenance Scripts
```bash
# Update database statistics
./maintain-bsim.sh --update-stats

# Clean up orphaned data
./maintain-bsim.sh --cleanup

# Optimize indexes
./maintain-bsim.sh --reindex
```

## 📊 Monitoring and Alerts

### Metrics
```bash
# Database size and growth
./monitor-bsim.sh --metrics

# Performance indicators
./monitor-bsim.sh --performance

# Capacity utilization
./monitor-bsim.sh --capacity
```

### Alerting
Configure alerts for:
- Database size > 90% capacity
- Query performance degradation
- Backup failures
- SSL certificate expiration

## 🚀 Migration and Scaling

### Upgrading
```bash
# Upgrade to newer template
./migrate-bsim.sh --from large_32 --to large_64

# Update to latest Ghidra version
./upgrade-ghidra.sh --version 11.4.3
```

### Scaling
For very large datasets (1B+ functions):
- Consider PostgreSQL clustering
- Implement table partitioning
- Use external storage for backups

## 📖 References and Resources

### Official Documentation
- [Ghidra BSim Documentation](https://github.com/NationalSecurityAgency/ghidra/tree/master/GhidraDocs/GhidraClass/BSim)
- [BSim Command Line Tutorial](https://github.com/NationalSecurityAgency/ghidra/blob/master/GhidraDocs/GhidraClass/BSim/BSimTutorial_BSim_Command_Line.md)
- [PostgreSQL LSH Extension](https://github.com/NationalSecurityAgency/ghidra/tree/master/Ghidra/Features/BSim/src/lshvector)

### Community Resources
- [Ghidra GitHub Repository](https://github.com/NationalSecurityAgency/ghidra)
- [BSim Research Papers](https://ghidra.re/online-courses/)
- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)

### Support
- **Issues**: Report problems via GitHub issues
- **Community**: Ghidra community forums and mailing lists
- **Documentation**: This README and inline script help

---

**Note**: This setup is optimized for defensive security research and malware analysis. Ensure compliance with your organization's security policies and legal requirements when analyzing potentially malicious code.