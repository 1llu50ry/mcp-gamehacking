# Creating Large BSim Database (100M+ Functions)

This guide shows how to create a BSim database using the `large_32` template for 32-bit code that can handle 100 million+ functions.

## Database Configuration

- **Template**: `large_32`
- **Architecture**: 32-bit code
- **Capacity**: ~100 million unique vectors
- **Target**: Large-scale binary similarity analysis

## Prerequisites

1. **Ghidra Installation** with BSim PostgreSQL extension built
2. **PostgreSQL Container** running (already configured)
3. **Sufficient System Resources**:
   - RAM: 8GB+ recommended for large datasets
   - Storage: 50GB+ for 100M functions
   - CPU: Multi-core recommended for indexing

## Step 1: Verify Database Readiness

```bash
# Run verification script
./test-bsim-setup.sh

# Expected output should show all green checkmarks
```

## Step 2: Create Large BSim Database

### Using Setup Script (Recommended)

Once you have Ghidra installed on your Windows machine:

```bash
# Create large_32 BSim database
./setup-bsim.sh \
  --ghidra-dir "C:/path/to/ghidra" \
  --template large_32 \
  --verbose

# This will execute:
# cd C:/path/to/ghidra/support
# ./bsim createdatabase postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim large_32 --user ben
```

### Manual Database Creation

If you prefer to run the commands manually:

```bash
# Navigate to Ghidra support directory
cd "C:/path/to/ghidra/support"

# Create BSim database with large_32 template
./bsim createdatabase \
  "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require" \
  large_32 \
  --user ben

# Add executable categories for organization
./bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" UNKNOWN
./bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" LIBRARY
./bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" EXECUTABLE
./bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" DRIVER
./bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" MALWARE
```

## Step 3: Verify Database Creation

After creation, verify the database schema:

```bash
# Check database tables
docker exec bsim-postgres psql -U ben -d bsim -c "\\dt"

# Check BSim configuration
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT * FROM executable_category;"

# Check database size and capacity
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT schemaname,tablename,attname,n_distinct,correlation FROM pg_stats WHERE tablename LIKE '%bsim%';"
```

## Step 4: Database Schema for large_32

The `large_32` template will create optimized tables for handling 100M+ functions:

### Core Tables Created

- **executable**: Binary metadata and classification
- **function**: Function signatures and addresses
- **signature**: Feature vectors and similarity data
- **vector**: LSH vectors for fast similarity search
- **callgraph**: Function call relationships
- **feature**: Feature definitions and weights

### Performance Optimizations

- **Partitioned Tables**: Large tables split for better performance
- **Optimized Indexes**: B-tree and hash indexes for fast lookups
- **LSH Indexing**: Locality-sensitive hashing for similarity search
- **Batch Operations**: Optimized for bulk inserts

## Step 5: Import Large Dataset

### Prepare Your Binary Collection

```bash
# Create directory for binaries
mkdir /path/to/large-binary-collection

# Organize binaries by category
mkdir /path/to/large-binary-collection/{malware,libraries,drivers,applications}
```

### Analyze Binaries with Ghidra

```bash
# Analyze large collection (headless mode recommended)
cd "C:/path/to/ghidra/support"

./analyzeHeadless \
  /path/to/ghidra-projects \
  large-binary-project \
  -import /path/to/large-binary-collection/* \
  -scriptPath /path/to/ghidra/Ghidra/Features/BSim/ghidra_scripts \
  -postScript BSimFeatureExtractor.java
```

### Generate and Commit Signatures

```bash
# Generate signatures for all analyzed binaries
./bsim generatesigs \
  "ghidra:///path/to/ghidra-projects/large-binary-project" \
  /tmp/bsim-signatures \
  --database "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim"

# Commit signatures to database (batch processing)
./bsim commitsigs \
  "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" \
  /tmp/bsim-signatures
```

## Performance Considerations

### Database Tuning

```sql
-- Optimize PostgreSQL for large BSim database
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- Reload configuration
SELECT pg_reload_conf();
```

### Backup Strategy for Large Database

```bash
# Create backup with compression (for large databases)
./bsim-backup.sh --name large-bsim-backup-$(date +%Y%m%d)

# Monitor backup size
ls -lh ./backups/large-bsim-backup-*.sql.gz
```

## Monitoring and Maintenance

### Database Size Monitoring

```sql
-- Check total database size
SELECT pg_size_pretty(pg_database_size('bsim')) AS database_size;

-- Check table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check function count
SELECT COUNT(*) AS total_functions FROM function;
SELECT COUNT(*) AS total_signatures FROM signature;
```

### Performance Monitoring

```sql
-- Check query performance
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE query LIKE '%bsim%'
ORDER BY mean_exec_time DESC;

-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename LIKE '%bsim%'
ORDER BY idx_tup_read DESC;
```

## Expected Results

After successful creation:

- **Database**: Ready for 100M+ function signatures
- **Templates**: Large-scale optimized schema
- **Indexing**: LSH-optimized for fast similarity queries
- **Performance**: Tuned for large dataset operations
- **Capacity**: ~100 million unique vectors supported

## Troubleshooting Large Databases

### Common Issues

1. **Memory Issues**: Increase PostgreSQL memory settings
2. **Slow Queries**: Check index usage and query plans
3. **Storage Space**: Monitor disk usage during imports
4. **Connection Timeouts**: Increase connection timeout for large operations

### Performance Tips

- Use batch processing for large imports
- Create custom indexes for specific query patterns
- Regular VACUUM and ANALYZE operations
- Monitor query performance with pg_stat_statements

## Connection Details

Once created, connect to your large BSim database:

- **URL**: `postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require`
- **Template**: `large_32`
- **Capacity**: 100M+ functions
- **Architecture**: 32-bit optimized