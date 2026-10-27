-- ============================================================================
-- DUPLICATE PREVENTION CONSTRAINTS
-- ============================================================================
-- These constraints prevent duplicate data when re-running BSim population scripts
-- Run this migration to enable safer upsert operations in Step1_AddProgramToBSimDatabase.java
--
-- Note: exetable.md5 is already UNIQUE in standard BSim schema (used for ON CONFLICT)
-- The name_exec unique constraint was removed to follow standard BSim behavior

-- Add unique constraint on desctable for (id_exe, addr)
-- This ensures one function per address per executable
DO $$
BEGIN
    -- First, remove any existing duplicates (keep the first one by id)
    DELETE FROM desctable a
    USING desctable b
    WHERE a.id > b.id
      AND a.id_exe = b.id_exe
      AND a.addr = b.addr;
    
    -- Add unique constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'desctable_unique_exe_addr'
    ) THEN
        ALTER TABLE desctable 
        ADD CONSTRAINT desctable_unique_exe_addr UNIQUE (id_exe, addr);
        RAISE NOTICE 'Added unique constraint desctable_unique_exe_addr';
    ELSE
        RAISE NOTICE 'Constraint desctable_unique_exe_addr already exists';
    END IF;
END $$;

-- Remove name_exec unique constraint if it exists (not standard BSim behavior)
-- Standard BSim uses md5 as the unique identifier for executables
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exetable_unique_name'
    ) THEN
        ALTER TABLE exetable DROP CONSTRAINT exetable_unique_name;
        RAISE NOTICE 'Removed non-standard exetable_unique_name constraint';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exetable_name_exec_key'
    ) THEN
        ALTER TABLE exetable DROP CONSTRAINT exetable_name_exec_key;
        RAISE NOTICE 'Removed non-standard exetable_name_exec_key constraint';
    END IF;
    
    RAISE NOTICE 'exetable.md5 is already UNIQUE (standard BSim behavior)';
END $$;

-- Verify constraints
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_name IN ('desctable', 'exetable')
ORDER BY tc.table_name, tc.constraint_name;
