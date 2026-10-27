-- Minimal BSim Database Initialization
-- This creates only the basic database structure that Ghidra BSim tools expect
-- The actual BSim schema will be created by Ghidra's createdatabase command

\echo 'Initializing minimal BSim database for Ghidra integration...'

-- Create the database user if it doesn't exist
-- Note: The database and user are created by Docker environment variables
-- This just ensures proper permissions

-- Grant database creation privileges to the user for BSim management
ALTER USER ben CREATEDB;

-- Create a simple test function to verify database connectivity
CREATE OR REPLACE FUNCTION bsim_connectivity_test()
RETURNS TEXT
LANGUAGE SQL
AS $$
    SELECT 'BSim PostgreSQL database is ready for Ghidra integration' AS status;
$$;

-- Grant execute permission on the test function
GRANT EXECUTE ON FUNCTION bsim_connectivity_test() TO ben;

-- Log successful initialization
SELECT bsim_connectivity_test() AS initialization_status;

\echo 'Minimal BSim database initialized successfully!'
\echo 'Next steps:'
\echo '  1. Ensure Ghidra is installed with BSim extension built (make-postgres.sh)'
\echo '  2. Use Ghidra bsim createdatabase command to create the actual BSim schema'
\echo '  3. Example: ./bsim createdatabase postgresql://ben:bsim@localhost:5432/bsim medium_32'