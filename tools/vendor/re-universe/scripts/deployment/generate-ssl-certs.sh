#!/bin/bash

# Production SSL Certificate Generator
# Creates proper SSL certificates for production BSim deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
SSL_DIR="./ssl"
CERT_VALIDITY_DAYS=365
CONFIG_FILE="${1:-.env.production}"

# Load configuration
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
else
    echo -e "${RED}[ERROR]${NC} Configuration file $CONFIG_FILE not found"
    exit 1
fi

# Functions
print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Create SSL directory
mkdir -p "$SSL_DIR"

print_header "🔐 Production SSL Certificate Generator"

# Generate CA private key
openssl genrsa -out "$SSL_DIR/ca-key.pem" 4096

# Generate CA certificate
openssl req -new -x509 -days $CERT_VALIDITY_DAYS -key "$SSL_DIR/ca-key.pem" -sha256 -out "$SSL_DIR/ca.pem" -subj "/C=${SSL_CERT_COUNTRY}/ST=${SSL_CERT_STATE}/L=${SSL_CERT_CITY}/O=${SSL_CERT_ORG}/OU=Certificate Authority/CN=BSim CA"

# Generate server private key
openssl genrsa -out "$SSL_DIR/server-key.pem" 4096

# Generate server certificate signing request
openssl req -subj "/C=${SSL_CERT_COUNTRY}/ST=${SSL_CERT_STATE}/L=${SSL_CERT_CITY}/O=${SSL_CERT_ORG}/OU=${SSL_CERT_UNIT}/CN=${SSL_CERT_COMMON_NAME}" -sha256 -new -key "$SSL_DIR/server-key.pem" -out "$SSL_DIR/server.csr"

# Create certificate extensions file
cat > "$SSL_DIR/server-extensions.conf" <<EOF
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${SSL_CERT_COMMON_NAME}
DNS.2 = localhost
DNS.3 = bsim-postgres
IP.1 = 127.0.0.1
# IP.2 = <your-server-ip>
EOF

# Generate server certificate signed by CA
openssl x509 -req -days $CERT_VALIDITY_DAYS -in "$SSL_DIR/server.csr" -CA "$SSL_DIR/ca.pem" -CAkey "$SSL_DIR/ca-key.pem" -out "$SSL_DIR/server-cert.pem" -extensions v3_req -extfile "$SSL_DIR/server-extensions.conf" -CAcreateserial

# Generate client private key
openssl genrsa -out "$SSL_DIR/client-key.pem" 4096

# Generate client certificate signing request
openssl req -subj "/C=${SSL_CERT_COUNTRY}/ST=${SSL_CERT_STATE}/L=${SSL_CERT_CITY}/O=${SSL_CERT_ORG}/OU=BSim Client/CN=bsim-client" -new -key "$SSL_DIR/client-key.pem" -out "$SSL_DIR/client.csr"

# Generate client certificate
openssl x509 -req -days $CERT_VALIDITY_DAYS -in "$SSL_DIR/client.csr" -CA "$SSL_DIR/ca.pem" -CAkey "$SSL_DIR/ca-key.pem" -out "$SSL_DIR/client-cert.pem" -CAcreateserial

# Set proper permissions
chmod 400 "$SSL_DIR"/*-key.pem
chmod 444 "$SSL_DIR"/*.pem
chmod 444 "$SSL_DIR"/*.csr
chmod 444 "$SSL_DIR"/*.conf

# Create PostgreSQL-compatible files
cp "$SSL_DIR/server-cert.pem" "$SSL_DIR/server.crt"
cp "$SSL_DIR/server-key.pem" "$SSL_DIR/server.key"
cp "$SSL_DIR/ca.pem" "$SSL_DIR/ca.crt"

# Set PostgreSQL-specific permissions
chmod 600 "$SSL_DIR/server.key"
chmod 644 "$SSL_DIR/server.crt" "$SSL_DIR/ca.crt"

# Clean up CSR files
rm -f "$SSL_DIR"/*.csr "$SSL_DIR"/*.srl

print_success "SSL certificates generated successfully!"
echo ""
print_header "📋 Certificate Summary"
echo -e "  ${BLUE}CA Certificate:${NC} $SSL_DIR/ca.pem"
echo -e "  ${BLUE}Server Certificate:${NC} $SSL_DIR/server-cert.pem"
echo -e "  ${BLUE}Server Key:${NC} $SSL_DIR/server-key.pem"
echo -e "  ${BLUE}Client Certificate:${NC} $SSL_DIR/client-cert.pem"
echo -e "  ${BLUE}Client Key:${NC} $SSL_DIR/client-key.pem"
echo ""
echo -e "  ${BLUE}PostgreSQL Files:${NC}"
echo -e "  ${BLUE}  - CA:${NC} $SSL_DIR/ca.crt"
echo -e "  ${BLUE}  - Certificate:${NC} $SSL_DIR/server.crt"
echo -e "  ${BLUE}  - Private Key:${NC} $SSL_DIR/server.key"
echo ""

print_header "🔒 Security Notes"
echo -e "  ${YELLOW}• Certificates valid for $CERT_VALIDITY_DAYS days${NC}"
echo -e "  ${YELLOW}• Private keys have restricted permissions (400/600)${NC}"
echo -e "  ${YELLOW}• Keep private keys secure and never commit to git${NC}"
echo -e "  ${YELLOW}• Distribute ca.pem to clients for certificate validation${NC}"

print_header "📈 Next Steps"
echo -e "  1. Restart PostgreSQL container to load new certificates"
echo -e "  2. Test SSL connection: ${BLUE}./test-ssl-connection.sh${NC}"
echo -e "  3. Update client applications to use SSL certificates"
echo -e "  4. Set up certificate rotation schedule (before expiry)"