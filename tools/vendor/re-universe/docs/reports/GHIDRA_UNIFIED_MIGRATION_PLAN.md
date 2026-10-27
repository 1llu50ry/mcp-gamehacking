# Ghidra Repository Migration: pd2 → diablo2 Unified Structure

## 🎯 Goal
Migrate from redundant Classic/LoD folder structure to unified version-based structure while **preserving all existing analysis work**.

---

## Current State (pd2 repo)

\`\`\`
pd2/
├── Classic/
│   ├── 1.00/ (26 binaries)
│   ├── 1.01/ (25 binaries)
│   └── ... through 1.14d
├── LoD/
│   ├── 1.07/ (25 binaries)
│   └── ... through 1.14d
└── PD2/ (30 mod binaries)
\`\`\`

**Problem:** ~50% redundancy. DLLs are identical between Classic and LoD but stored twice.

---

## Target State (diablo2 repo)

\`\`\`
diablo2/
└── vanilla/
    ├── 1.00/
    │   ├── D2Game.dll           # Single copy (shared)
    │   ├── D2Client.dll         # Single copy (shared)
    │   ├── D2Common.dll         # Single copy (shared)
    │   ├── ... (all shared DLLs)
    │   ├── Classic-Game.exe     # Prefixed (different binary)
    │   ├── LoD-Game.exe         # Prefixed (different binary)
    │   ├── Classic-Diablo II.exe
    │   └── LoD-Diablo II.exe
    ├── 1.07/                    # First LoD version
    │   ├── (shared DLLs)
    │   ├── Classic-Game.exe
    │   └── LoD-Game.exe
    └── ... through 1.14d
\`\`\`

**Result:** ~50% reduction in binaries, zero loss of analysis.

---

## Migration Strategy: Preservation First

### Phase 1: Backup & Audit

1. **Full backup of pd2 repository**
   \`\`\`bash
   # Already have backup at: repo-data/backups/pd2_backup_20260220_225126
   # Create fresh backup before migration
   sudo cp -a /repos/pd2 /repos/pd2_premigration_backup
   \`\`\`

2. **Audit existing analysis** (identify projects with work done)
   \`\`\`bash
   # Count function renames, comments, data types per project
   # Flag projects with significant analysis to prioritize
   \`\`\`

### Phase 2: Create New Structure

1. **Create diablo2 repository on Ghidra server**
   \`\`\`bash
   # Via Ghidra server admin or direct creation
   mkdir -p /repos/diablo2/vanilla/{1.00,1.01,...,1.14d}
   \`\`\`

2. **Set up version folders matching binaries/ structure**

### Phase 3: Migrate with Analysis Preservation

For each version (e.g., 1.09d):

#### Step 3a: Identify shared vs. different binaries
\`\`\`
SHARED (keep single copy, merge analysis from both Classic & LoD):
- D2Game.dll, D2Client.dll, D2Common.dll, D2CMP.dll
- D2DDraw.dll, D2Direct3D.dll, D2Gdi.dll, D2Glide.dll, D2Gfx.dll
- D2Lang.dll, D2Launch.dll, D2MCPClient.dll, D2Multi.dll
- D2Net.dll, D2Sound.dll, D2Win.dll, D2VidTst.exe
- Fog.dll, Storm.dll, Bnclient.dll, SmackW32.dll, binkw32.dll, ijl11.dll

DIFFERENT (prefix and keep both):
- Game.exe → Classic-Game.exe, LoD-Game.exe
- Diablo II.exe → Classic-Diablo II.exe, LoD-Diablo II.exe
\`\`\`

#### Step 3b: For SHARED binaries
\`\`\`
1. Check if Classic/1.09d/D2Game.dll has analysis work
2. Check if LoD/1.09d/D2Game.dll has analysis work
3. If BOTH have work: Export both, merge (manual review for conflicts)
4. If ONE has work: Use that one as the source
5. If NEITHER: Import fresh from binaries/1.09d/D2Game.dll

Copy to: diablo2/vanilla/1.09d/D2Game.dll
\`\`\`

#### Step 3c: For DIFFERENT binaries
\`\`\`
1. Copy Classic/1.09d/Game.exe → diablo2/vanilla/1.09d/Classic-Game.exe
   (preserve all analysis, just rename)
2. Copy LoD/1.09d/Game.exe → diablo2/vanilla/1.09d/LoD-Game.exe
   (preserve all analysis, just rename)
\`\`\`

### Phase 4: Verify & Validate

1. **Count check**: Ensure all projects migrated
2. **Analysis spot-check**: Verify function names preserved
3. **BSim compatibility**: Update BSim records to point to new paths

### Phase 5: Cutover

1. Rename pd2 → pd2_archived
2. Rename diablo2 → active repository
3. Update any scripts/configs referencing old paths

---

## Analysis Preservation Matrix

| Source | Target | Preservation Method |
|--------|--------|---------------------|
| Classic/X.XX/D2Game.dll | vanilla/X.XX/D2Game.dll | Merge analysis if both have work |
| LoD/X.XX/D2Game.dll | vanilla/X.XX/D2Game.dll | (merged with Classic) |
| Classic/X.XX/Game.exe | vanilla/X.XX/Classic-Game.exe | Direct copy with rename |
| LoD/X.XX/Game.exe | vanilla/X.XX/LoD-Game.exe | Direct copy with rename |
| Classic/X.XX/Diablo II.exe | vanilla/X.XX/Classic-Diablo II.exe | Direct copy with rename |
| LoD/X.XX/Diablo II.exe | vanilla/X.XX/LoD-Diablo II.exe | Direct copy with rename |
| PD2/* | pd2/* (keep separate) | Direct copy (mod, not vanilla) |

---

## Special Cases

### Version 1.00 (Classic only)
- No LoD version exists
- Keep original names (no prefix needed)
- Includes D2Server.dll (unique!)

### Versions 1.01-1.06b (Classic only)
- No LoD version exists
- Keep original names (no prefix needed)

### Version 1.07+ (Both Classic & LoD exist)
- Apply prefix naming for Game.exe and Diablo II.exe
- Deduplicate shared DLLs

### Versions 1.14a-1.14d
- Blizzard consolidated DLLs into executables
- Fewer files per version (~5-9 instead of ~25)

---

## BSim Database Impact

After migration, BSim records will need path updates:
\`\`\`sql
-- Example update for migrated paths
UPDATE exetable 
SET name_exec = REPLACE(name_exec, 'Classic/', 'vanilla/')
WHERE name_exec LIKE 'Classic/%';

-- Add prefixes to executables
UPDATE exetable
SET name_exec = REPLACE(name_exec, '/Game.exe', '/Classic-Game.exe')
WHERE name_exec LIKE 'Classic/%/Game.exe';
\`\`\`

---

## Execution Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Backup & Audit | 1 hour | Not started |
| Phase 2: Create Structure | 30 min | Not started |
| Phase 3: Migrate (per version) | ~15 min each | Not started |
| Phase 4: Verify | 2 hours | Not started |
| Phase 5: Cutover | 30 min | Not started |

**Total estimated time:** 1 day for full migration

---

## Rollback Plan

If issues discovered:
1. Rename diablo2 → diablo2_failed
2. Rename pd2_premigration_backup → pd2
3. Investigate and retry

---

## Next Steps

1. [ ] Create fresh backup of pd2
2. [ ] Audit which projects have significant analysis work
3. [ ] Begin Phase 2: Create new diablo2 structure
4. [ ] Migrate version by version, starting with 1.00 (D2Server.dll priority)

---

*Plan created: February 21, 2026*
*Status: Ready for execution*

---

## Appendix: PD2 Mod Preservation

### Target Structure with Mods Folder

```
diablo2/
├── vanilla/
│   ├── 1.00/
│   │   ├── D2Game.dll           # Shared (single copy)
│   │   ├── D2Server.dll         # Unique server binary
│   │   ├── Classic-Game.exe     # Prefixed
│   │   └── LoD-Game.exe         # Prefixed
│   ├── 1.07/
│   └── ... through 1.14d
│
└── mods/
    └── pd2/
        ├── BH.dll               # Maphack
        ├── D2Client.dll         # Modified client
        ├── D2Game.dll           # Modified engine
        ├── Game.exe             # PD2 executable
        ├── PD2_EXT.dll          # PD2 extension
        ├── ProjectDiablo.dll    # Core PD2 mod
        ├── SGD2FreeDisplayFix.dll
        ├── SGD2FreeRes.dll
        ├── ddraw.dll            # Graphics wrapper
        ├── glide3x.dll          # Glide wrapper
        └── ... (31 total binaries)
```

### PD2 Migration

| Source | Target | Method |
|--------|--------|--------|
| `pd2/PD2/*` | `diablo2/mods/pd2/*` | Direct copy, preserve all analysis |

### Why Separate Mods Folder?

1. **Different purpose** - Mods are modifications, not official Blizzard releases
2. **No deduplication** - PD2 binaries are unique, don't share with vanilla
3. **Future expansion** - Can add Median XL, Path of Diablo, etc. later
4. **Clear organization** - Separates official vs. community content

### PD2 Binary Inventory (31 files)

```
BH.dll              - Maphack overlay
binkw32.dll         - Video codec
Bnclient.dll        - Battle.net client (modified)
D2CMP.dll           - Compression
D2Client.dll        - Client logic (modified)
D2Common.dll        - Shared functions (modified)
D2DDraw.dll         - DirectDraw
D2Direct3D.dll      - Direct3D
D2Game.dll          - Core engine (modified)
D2Gdi.dll           - GDI graphics
D2gfx.dll           - Graphics utilities
D2Glide.dll         - 3dfx Glide
D2Lang.dll          - Localization
D2Launch.dll        - Launcher
D2MCPClient.dll     - MCP client
D2Multi.dll         - Multiplayer
D2Net.dll           - Networking
D2sound.dll         - Audio
D2Win.dll           - Window management
ddraw.dll           - DirectDraw wrapper
Fog.dll             - Blizzard utility
Game.exe            - Main executable
glide3x.dll         - Glide 3 wrapper
ijl11.dll           - Intel JPEG
libcrypto-1_1.dll   - Crypto library
PD2_EXT.dll         - PD2 extension
ProjectDiablo.dll   - Core mod DLL
SGD2FreeDisplayFix.dll - Resolution fix
SGD2FreeRes.dll     - Free resolution
SmackW32.dll        - Smacker video
Storm.dll           - Blizzard utility
```

---

*Updated: February 21, 2026*
