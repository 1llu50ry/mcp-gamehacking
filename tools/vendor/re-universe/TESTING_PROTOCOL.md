# Testing Protocol for RE-Universe Platform

## Pre-Commit Testing Checklist

Before committing any changes, run through this checklist to ensure all services remain functional:

### 1. Core Infrastructure Health Checks
```bash
# Check all container statuses
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(bsim-postgres|redis-cache|vector-search|ai-orchestration|chat-interface|ghidra-api|ghidra-web)"

# Test database connectivity
docker exec bsim-postgres pg_isready -U ben -d bsim
```

### 2. Service Health Endpoints
```bash
# Test all health endpoints
curl -s http://localhost:8091/health | jq '.status'  # vector-search
curl -s http://localhost:8092/health | jq '.status'  # ai-orchestration
curl -s http://localhost:8093/health | jq '.status'  # chat-interface
curl -s http://localhost:8081/api/health | jq '.status'  # ghidra-api
```

### 3. Web Interface Accessibility
```bash
# Test web interfaces return 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:8083  # d2docs website
curl -s -o /dev/null -w "%{http_code}" http://localhost:8093  # chat interface
```

### 4. Database Integrity
```bash
# Check database table counts
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT COUNT(*) as total_tables FROM information_schema.tables WHERE table_schema = 'public';"

# Verify critical tables exist
docker exec bsim-postgres psql -U ben -d bsim -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('conversations', 'chat_messages', 'function_analysis', 'vectors');"
```

### 5. Service Integration Tests
```bash
# Test AI orchestration classification
curl -s -X POST "http://localhost:8092/classify" \
  -H "Content-Type: application/json" \
  -d '{"request_id": "test", "prompt": "test", "user_id": "test", "priority": "normal"}' | jq '.recommended_model'

# Test AI orchestration budget system
curl -s http://localhost:8092/budget | jq '.spending_summary.daily_budget'
```

## Current Service Status (as of Day 5)

### ✅ Healthy Services
- **bsim-postgres** (port 5432) - Database with 64 tables including chat schema
- **redis-cache** (port 6379) - Caching layer for AI orchestration
- **vector-search** (port 8091) - Semantic search (degraded: no OpenAI key)
- **ai-orchestration** (port 8092) - Multi-model AI routing with budget controls
- **chat-interface** (port 8093) - Real-time WebSocket chat with database persistence
- **ghidra-api** (port 8081) - BSim analysis API (healthy but no analysis data loaded)
- **ghidra-web** (port 8083) - Django web interface (healthy but displays no data due to empty BSim database)

### ⚠️ Known Limitations
1. **No Analysis Data**: BSim database tables exist but are empty (0 functions analyzed)
   - d2docs website loads but shows no data
   - API endpoints return 404 for data queries
   - This is expected - no binaries have been analyzed yet

2. **Missing API Keys**: Some services run in degraded mode
   - Vector search: No OpenAI API key (semantic embeddings disabled)
   - AI orchestration: No Anthropic API key (mock responses only)

3. **Mock Data**: AI responses are simulated until API keys are configured

### 🔧 Data Loading Requirements
To fully test the platform with real data:
1. Configure API keys in `.env` file
2. Load binary files for analysis
3. Run Ghidra analysis to populate BSim database
4. Generate vector embeddings for semantic search

## Testing Before Each Commit

1. **Run Health Check Script**:
   ```bash
   # Create a simple health check script
   #!/bin/bash
   echo "=== RE-Universe Platform Health Check ==="

   # Check container statuses
   echo "Container Status:"
   docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(postgres|redis|vector|orchestration|chat|ghidra)"

   # Test health endpoints
   echo -e "\nService Health:"
   echo "Vector Search: $(curl -s http://localhost:8091/health | jq -r '.status')"
   echo "AI Orchestration: $(curl -s http://localhost:8092/health | jq -r '.status')"
   echo "Chat Interface: $(curl -s http://localhost:8093/health | jq -r '.status')"
   echo "Ghidra API: $(curl -s http://localhost:8081/api/health | jq -r '.status')"

   # Test web interfaces
   echo -e "\nWeb Interface Status:"
   echo "D2Docs Website: $(curl -s -o /dev/null -w "%{http_code}" http://localhost:8083)"
   echo "Chat Interface: $(curl -s -o /dev/null -w "%{http_code}" http://localhost:8093)"
   ```

2. **Verify No Regressions**: Ensure previously working functionality still works
3. **Test New Features**: Verify new functionality works as expected
4. **Check Logs**: Review service logs for errors or warnings
5. **Document Changes**: Update this protocol if service architecture changes

## Regression Prevention

- **Database Migration Safety**: Always test schema changes on a backup first
- **Port Conflicts**: Verify no new services conflict with existing port assignments
- **Dependency Changes**: Test that service dependencies (Docker Compose `depends_on`) still work
- **Environment Variables**: Ensure new env vars don't break existing services
- **Network Connectivity**: Verify inter-service communication remains functional