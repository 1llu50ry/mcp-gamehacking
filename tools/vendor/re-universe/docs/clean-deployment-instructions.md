# Clean BSim Database Deployment Instructions (Unified Version System)

## Prerequisites
- Docker containers stopped: `docker-compose down`
- Database volume cleared: `docker volume rm re-universe_bsim-data` (optional for complete fresh start)
- **New**: All executables must follow unified naming convention (see below)

## Step-by-Step Deployment

### Phase 1: Infrastructure Setup
```bash
# 1. Start base infrastructure
./deploy-enhanced-bsim.sh schema

# 2. Verify base schema
docker exec -i bsim-postgres psql -U ben -d bsim -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

### Phase 2: Data Quality Setup
```bash
# 3. Apply unified version schema
docker exec -i bsim-postgres psql -U ben -d bsim -f /tmp/updated-single-version-schema.sql

# 4. Version validation constraints (automatically applied by schema)
# - game_version format validation
# - unified naming convention enforcement
# - exception binary handling
```

### Phase 3: Data Ingestion (CRITICAL: Unified Version Requirements)
```bash
# 5. Ingest properly versioned executables
# BEFORE running ghidra analysis, ensure all files follow NEW unified convention:
# STANDARD BINARIES (99% of files):
# - 1.03_D2Game.dll ✅
# - 1.13c_D2Common.dll ✅
# EXCEPTION BINARIES (Game.exe, Diablo_II.exe only):
# - Classic_1.03_Game.exe ✅
# - LoD_1.13c_Game.exe ✅
# OLD FORMAT (REJECT):
# - Classic_1.03_D2Game.dll ❌
# - D2Game.dll ❌

# 6. Run BSim analysis with version validation
./automate-ghidra-bsim-population.sh

# 7. Validate and manage unified versions
./manage-unified-versions.sh full
```

### Phase 4: Similarity Analysis
```bash
# 8. Generate BSim signatures (only for versioned files)
# Run in Ghidra with GenerateBSimSignatures.java

# 9. Build similarity matrix
# Run BSim_SimilarityWorkflow.java

# 10. Refresh cross-version data
# Version fields are now auto-populated by unified schema during ingestion
# Manual refresh if needed: SELECT populate_version_fields_from_filename();
```

### Phase 5: Validation
```bash
# 11. Final validation
./deploy-enhanced-bsim.sh validate

# 12. Test API endpoints
curl "http://localhost:8081/api/functions/cross-version/Classic_1.03_D2Game.dll"
curl "http://localhost:8081/api/functions/cross-version/LoD_1.13c_D2Game.dll"
```

## Critical Success Criteria

### ✅ **Data Quality Checks**
- [ ] All executables have `game_version` populated
- [ ] Executables follow unified naming convention
- [ ] Exception binaries properly identified (Game.exe, Diablo_II.exe)
- [ ] All functions have proper cross-version linkage

### ✅ **API Validation**
- [ ] Cross-version endpoints return function data
- [ ] Version matrix displays properly
- [ ] No "Unknown/Other" entries in version analysis

### ✅ **Performance Verification**
- [ ] Database queries use indexes (not regex parsing)
- [ ] Cross-version analysis loads quickly
- [ ] Similarity data properly linked

## Emergency Rollback
If deployment fails:
```bash
# Stop containers
docker-compose down

# Clear data (if needed)
docker volume rm re-universe_bsim-data

# Restart with old schema
./setup-bsim.sh
```