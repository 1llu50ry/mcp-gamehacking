#!/bin/bash

# PostgreSQL Docker Entrypoint with SSL Certificate Generation
# This script generates SSL certificates before starting PostgreSQL

set -e

echo "=== BSim PostgreSQL SSL Setup ==="

# SSL and data directories
DATA_DIR="/var/lib/postgresql/data"

# Function to generate SSL certificates
generate_ssl_certs() {
    echo "Generating SSL certificates for PostgreSQL..."

    # Create temporary directory for certificate generation
    TEMP_SSL="/tmp/ssl"
    mkdir -p "$TEMP_SSL"

    # Generate private key
    openssl genrsa -out "$TEMP_SSL/server.key" 2048

    # Generate certificate signing request
    openssl req -new -key "$TEMP_SSL/server.key" -out "$TEMP_SSL/server.csr" \
        -subj "/C=US/ST=State/L=City/O=BSim/OU=Database/CN=localhost"

    # Generate self-signed certificate (valid for 365 days)
    openssl x509 -req -in "$TEMP_SSL/server.csr" -signkey "$TEMP_SSL/server.key" \
        -out "$TEMP_SSL/server.crt" -days 365

    # Generate CA certificate (copy of server cert for simplicity)
    cp "$TEMP_SSL/server.crt" "$TEMP_SSL/ca.crt"

    # Copy certificates to data directory
    cp "$TEMP_SSL/server.crt" "$DATA_DIR/server.crt"
    cp "$TEMP_SSL/server.key" "$DATA_DIR/server.key"
    cp "$TEMP_SSL/ca.crt" "$DATA_DIR/ca.crt"

    # Set proper ownership and permissions
    chown postgres:postgres "$DATA_DIR/server.crt" "$DATA_DIR/server.key" "$DATA_DIR/ca.crt"
    chmod 600 "$DATA_DIR/server.key"
    chmod 644 "$DATA_DIR/server.crt" "$DATA_DIR/ca.crt"

    # Clean up temporary files
    rm -rf "$TEMP_SSL"

    echo "SSL certificates generated successfully"
}

# Check if this is a fresh initialization
if [[ ! -d "$DATA_DIR/base" ]]; then
    echo "Fresh PostgreSQL initialization detected"

    # Run the original docker entrypoint without SSL first
    export POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C"

    # Initialize database without SSL
    echo "Initializing PostgreSQL database..."
    /usr/local/bin/docker-entrypoint.sh postgres \
        -c password_encryption=scram-sha-256 \
        -c log_statement=all \
        -c log_line_prefix='%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ' &

    POSTGRES_PID=$!

    # Wait for PostgreSQL to be ready
    echo "Waiting for PostgreSQL to be ready for initial setup..."
    until pg_isready -h localhost -p 5432 -U "${POSTGRES_USER:-ben}" 2>/dev/null; do
        sleep 1
    done

    echo "PostgreSQL is ready, stopping for SSL configuration..."
    kill $POSTGRES_PID
    wait $POSTGRES_PID 2>/dev/null || true

    # Generate SSL certificates
    generate_ssl_certs

    echo "Starting PostgreSQL with SSL support..."

else
    echo "Existing PostgreSQL data found"

    # Check if SSL certificates exist, generate if not
    if [[ ! -f "$DATA_DIR/server.crt" || ! -f "$DATA_DIR/server.key" ]]; then
        generate_ssl_certs
    else
        echo "SSL certificates already exist"
    fi
fi

# Start PostgreSQL with SSL configuration
exec /usr/local/bin/docker-entrypoint.sh postgres \
    -c ssl=on \
    -c ssl_cert_file=/var/lib/postgresql/data/server.crt \
    -c ssl_key_file=/var/lib/postgresql/data/server.key \
    -c ssl_ca_file=/var/lib/postgresql/data/ca.crt \
    -c password_encryption=scram-sha-256 \
    -c log_statement=all \
    -c log_line_prefix='%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '