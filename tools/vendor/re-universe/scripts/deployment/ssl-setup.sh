#!/bin/bash
set -e

# Generate SSL certificate if it doesn't exist
if [ ! -f "/var/lib/postgresql/data/server.crt" ]; then
    echo "Generating SSL certificate..."
    openssl req -new -x509 -days 365 -nodes -text \
        -out /var/lib/postgresql/data/server.crt \
        -keyout /var/lib/postgresql/data/server.key \
        -subj "/CN=localhost"

    # Set proper permissions
    chmod 600 /var/lib/postgresql/data/server.key
    chmod 644 /var/lib/postgresql/data/server.crt
    chown postgres:postgres /var/lib/postgresql/data/server.crt /var/lib/postgresql/data/server.key
    echo "SSL certificate generated successfully."
fi

# Start PostgreSQL with SSL enabled
exec postgres \
    -c password_encryption=scram-sha-256 \
    -c log_statement=all \
    -c log_line_prefix='%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ' \
    -c shared_preload_libraries=pg_stat_statements \
    -c pg_stat_statements.track=all \
    -c work_mem=16MB \
    -c random_page_cost=1.1 \
    -c effective_io_concurrency=4 \
    -c checkpoint_timeout=15min \
    -c log_min_duration_statement=1000 \
    -c log_checkpoints=on \
    -c log_lock_waits=on \
    -c ssl=on \
    -c ssl_cert_file=/var/lib/postgresql/data/server.crt \
    -c ssl_key_file=/var/lib/postgresql/data/server.key