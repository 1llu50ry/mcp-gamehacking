# 🚀 Create Your Large BSim Database - Final Commands

## ✅ Your Database is Ready!

- **PostgreSQL**: Optimized and running (8GB shared buffers, 48GB cache)
- **SSL**: Enabled and configured
- **Template**: Ready for `large_32` (100M+ functions)
- **Monitoring**: Performance monitoring script ready

---

## 📋 **Step 1: Create BSim Database (Run on Windows)**

Open **Command Prompt as Administrator** and run:

```cmd
cd "C:\Program Files\ghidra_11.4.2_PUBLIC\support"

bsim createdatabase "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require" large_32 --user ben
```

## 📋 **Step 2: Add Categories (Run on Windows)**

```cmd
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" UNKNOWN
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" LIBRARY
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" EXECUTABLE
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" DRIVER
bsim addexecategory "postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim" MALWARE
```

## 📋 **Step 3: Monitor Progress (Run on Linux)**

```bash
# Single status check
./monitor-bsim.sh

# Continuous monitoring during imports
./monitor-bsim.sh --watch

# Export performance data to CSV
./monitor-bsim.sh --csv
```

## 📋 **Step 4: Connect from Ghidra**

1. **Open Ghidra**
2. **Tools** → **Binary Similarity** → **BSim**
3. **Create New Server**:
   - **URL**: `postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require`
   - **Test Connection** ✅

---

## 🎯 **Large_32 Template Specifications**

- **Architecture**: 32-bit code optimized
- **Capacity**: ~100 million unique vectors
- **Memory**: 8GB shared buffers, 48GB effective cache
- **Performance**: Optimized for large-scale imports
- **SSL**: Required and configured

## 📊 **Expected Performance**

- **Function Import**: 10,000-50,000 functions/minute
- **Database Size**: ~50-100GB for 100M functions
- **Query Speed**: Sub-second similarity searches
- **Memory Usage**: 8GB+ database cache

## 🔧 **Available Scripts**

| Script | Purpose |
|--------|---------|
| `./test-bsim-setup.sh` | Verify database status |
| `./monitor-bsim.sh` | Monitor database growth |
| `./monitor-bsim.sh --watch` | Continuous monitoring |
| `./bsim-backup.sh` | Create database backup |

## 📖 **Documentation**

- `WINDOWS-BSIM-CREATION.md` - Complete Windows setup guide
- `CREATE-LARGE-BSIM.md` - Large database configuration
- `SSL-CONNECTION.md` - SSL troubleshooting

---

## ⚡ **Quick Start Summary**

**Your database is ready to create!** Just run the `bsim createdatabase` command from your Windows Ghidra installation and you'll have a production-ready BSim database for 100M+ functions.

**Connection URL**: `postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/bsim?ssl=true&sslmode=require`