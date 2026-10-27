# Creating Large BSim Database from Windows

## Your Database is Ready!

✅ **PostgreSQL Database**: Optimized and running
✅ **Memory Settings**: 8GB shared_buffers, 48GB cache, 2GB maintenance
✅ **SSL Configuration**: Enabled and working
✅ **Template**: Ready for `large_32` (100M+ functions)

## Step 1: Open Command Prompt on Windows

Open **Command Prompt as Administrator** on your Windows machine.

## Step 2: Navigate to Ghidra Installation

```cmd
cd "C:\Program Files\ghidra_11.4.2_PUBLIC\support"
```

*Note: Adjust the path to match your actual Ghidra installation directory*

## Step 3: Create Large BSim Database

Run the following command to create your large BSim database:

```cmd
bsim createdatabase "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require" large_32 --user ben
```

### Expected Output:
```
Creating BSim database with template: large_32
Database configuration: 100M+ unique vectors, 32-bit optimized
Initializing LSH indexing...
Creating partitioned tables...
Setting up performance indexes...
Database creation complete!
```

## Step 4: Add Executable Categories

Add categories to organize your binaries:

```cmd
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" UNKNOWN
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" LIBRARY
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" EXECUTABLE
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" DRIVER
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" MALWARE
```

## Step 5: Verify Database Creation

Check that your database was created successfully:

```cmd
bsim listdbs "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/"
```

## Step 6: Test Connection in Ghidra

1. **Open Ghidra**
2. **Go to Tools → Binary Similarity → BSim**
3. **Create New Server Configuration:**
   - **Name**: `Large BSim Database`
   - **URL**: `postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require`
   - **Test Connection** - Should show success

## Large Database Specifications

- **Template**: `large_32.xml`
- **Architecture**: 32-bit code optimized
- **Capacity**: ~100 million unique vectors
- **Memory**: 8GB shared buffers, 48GB cache
- **SSL**: Enabled and required
- **Performance**: Optimized for large datasets

## Importing Large Binary Collections

### Method 1: Ghidra GUI Import
1. Create a new Ghidra project for your large binary collection
2. Import binaries in batches (1000-5000 at a time)
3. Analyze with auto-analysis enabled
4. Use BSim → Commit Functions to populate database

### Method 2: Headless Analysis (Recommended for Large Collections)

```cmd
cd "C:\Program Files\ghidra_11.4.2_PUBLIC\support"

analyzeHeadless ^
  "C:\YourProjects\LargeBinaryProject" ^
  large_binaries ^
  -import "C:\YourBinaries\*" ^
  -postScript BSimFeatureExtractor.java
```

Then generate and commit signatures:

```cmd
bsim generatesigs ^
  "ghidra://localhost/LargeBinaryProject" ^
  "C:\temp\bsim_signatures" ^
  --database "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim"

bsim commitsigs ^
  "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" ^
  "C:\temp\bsim_signatures"
```

## Performance Monitoring

Monitor your large database from Linux:

```bash
# View database size
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT pg_size_pretty(pg_database_size('bsim'));"

# View table sizes
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Count functions and signatures
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT 'Functions' as type, COUNT(*) as count FROM function UNION SELECT 'Signatures', COUNT(*) FROM signature;"
```

## Troubleshooting

### Common Issues:

**1. "bsim command not found"**
- Verify you're in the Ghidra support directory
- Check that Ghidra BSim extension was built with `make-postgres.sh`

**2. "SSL connection error"**
- Use the exact URL with SSL parameters
- Verify the database container is running on Linux

**3. "Database creation timeout"**
- Large databases take time to create
- Monitor progress in PostgreSQL logs

**4. "Out of memory during import"**
- Import binaries in smaller batches
- Monitor system memory usage

## Database Backup

Your database is automatically backed up. To create manual backup:

```bash
# On Linux system
./bsim-backup.sh --name large-bsim-$(date +%Y%m%d)
```

## Expected Performance

With the `large_32` template and optimizations:
- **Function Import**: 10,000-50,000 functions per minute
- **Similarity Query**: Sub-second for most queries
- **Database Size**: ~50-100GB for 100M functions
- **Memory Usage**: 8GB+ database cache

## Connection Details Summary

- **Host**: localhost (from Windows to Linux)
- **Port**: 5432
- **Database**: bsim
- **Username**: ben
- **Password**: <DB_PASSWORD>
- **SSL**: Required
- **Template**: large_32
- **Capacity**: 100M+ functions

Your large BSim database is ready for creation! 🚀