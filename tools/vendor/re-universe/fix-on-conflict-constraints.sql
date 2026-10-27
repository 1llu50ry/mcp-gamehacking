-- Fix ON CONFLICT constraint errors for Step1 script
-- This adds the missing unique constraints that the Step1 script expects
--
-- Note: exetable.md5 is already UNIQUE in standard BSim schema
-- The Step1 script uses ON CONFLICT (md5) for idempotent inserts

-- 1. Remove name_exec unique constraint if it exists (not standard BSim)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'exetable_name_exec_key'
        AND table_name = 'exetable'
    ) THEN
        ALTER TABLE exetable DROP CONSTRAINT exetable_name_exec_key;
        RAISE NOTICE 'Removed non-standard name_exec unique constraint';
    ELSE
        RAISE NOTICE 'name_exec unique constraint does not exist (good - standard BSim)';
    END IF;
END $$;

-- 2. Add unique constraint on desctable(id_exe, addr) for ON CONFLICT (id_exe, addr)
--    This ensures that each address within an executable can only have one function
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'desctable_exe_addr_key'
        AND table_name = 'desctable'
    ) THEN
        -- Add unique constraint on (id_exe, addr)
        ALTER TABLE desctable ADD CONSTRAINT desctable_exe_addr_key UNIQUE (id_exe, addr);
        RAISE NOTICE 'Added unique constraint on desctable(id_exe, addr)';
    ELSE
        RAISE NOTICE 'Unique constraint on desctable(id_exe, addr) already exists';
    END IF;
END $$;

-- 3. Verify the constraints - show md5 unique constraint on exetable
SELECT
    'exetable' as table_name,
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'exetable'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%md5%'

UNION ALL

SELECT
    'desctable' as table_name,
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'desctable'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%exe_addr%';

-- Show all constraints for verification
SELECT
    table_name,
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name IN ('exetable', 'desctable')
    AND constraint_type = 'UNIQUE'
ORDER BY table_name, constraint_name;