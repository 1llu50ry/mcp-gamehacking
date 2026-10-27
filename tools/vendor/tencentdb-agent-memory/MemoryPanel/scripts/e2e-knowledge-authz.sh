#!/usr/bin/env bash
# Knowledge list 鉴权端到端验证（team-assets / my-assets / id-only read）
# 需要：Panel :8123 + Kernel :8420 + KS :8421，instance 与 .env 对齐
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8123}"
INSTANCE="${INSTANCE:-knowledge-debug}"
ADMIN_KEY="${ADMIN_KEY:-}"
MEMBER_KEY="${MEMBER_KEY:-}"
TEAM_ID="${TEAM_ID:-}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; echo "    resp: $2"; exit 1; }
info() { echo -e "${YELLOW}▶${NC} $1"; }

call_knowledge() {
  local path=$1 key=$2 body=$3
  curl -sS -X POST "$BASE/api/v1/knowledge/$path" \
    -H "X-Tdai-Service-Id: $INSTANCE" \
    -H "X-Tdai-User-Key: $key" \
    -H "content-type: application/json" \
    -d "$body"
}

jcode() { echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code'))"; }
jcount() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('items',[]) or []))"; }

if [[ -z "$ADMIN_KEY" || -z "$MEMBER_KEY" || -z "$TEAM_ID" ]]; then
  echo "Usage: ADMIN_KEY=sk-mem-... MEMBER_KEY=sk-mem-... TEAM_ID=team-... $0"
  echo "Optional: BASE INSTANCE"
  exit 1
fi

info "① admin 创建 private wiki"
WNAME="e2e-wiki-$(date +%s)"
R=$(call_knowledge wiki/create "$ADMIN_KEY" "{\"team_id\":\"$TEAM_ID\",\"name\":\"$WNAME\"}")
[[ $(jcode "$R") == "0" ]] || fail "wiki/create" "$R"
WIKI_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['wiki_id'])")
pass "wiki_id=$WIKI_ID (private by default)"

info "② member team-assets 不应看到 admin private wiki"
R=$(call_knowledge wiki/team-assets "$MEMBER_KEY" "{\"team_id\":\"$TEAM_ID\"}")
[[ $(jcode "$R") == "0" ]] || fail "wiki/team-assets member" "$R"
COUNT=$(jcount "$R")
python3 -c "
import sys,json
ids=[i.get('knowledge_id') for i in json.load(sys.stdin)['data']['items']]
sys.exit(0 if '$WIKI_ID' not in ids else 1)
" <<< "$R" || fail "private wiki leaked in team-assets" "$R"
pass "team-assets count=$COUNT, no leak"

info "③ admin my-assets 应看到自己 wiki"
R=$(call_knowledge wiki/my-assets "$ADMIN_KEY" "{\"team_id\":\"$TEAM_ID\"}")
[[ $(jcode "$R") == "0" ]] || fail "wiki/my-assets admin" "$R"
python3 -c "
import sys,json
ids=[i.get('knowledge_id') for i in json.load(sys.stdin)['data']['items']]
sys.exit(0 if '$WIKI_ID' in ids else 1)
" <<< "$R" || fail "admin my-assets missing wiki" "$R"
pass "admin my-assets contains wiki"

info "④ member 直接 get admin wiki → 应 403/404"
R=$(call_knowledge wiki/get "$MEMBER_KEY" "{\"wiki_id\":\"$WIKI_ID\"}")
CODE=$(jcode "$R")
[[ "$CODE" != "0" ]] || fail "wiki/get should be forbidden for member" "$R"
pass "wiki/get blocked (code=$CODE)"

info "⑤ 清理 admin wiki"
R=$(call_knowledge wiki/delete "$ADMIN_KEY" "{\"wiki_ids\":[\"$WIKI_ID\"]}")
[[ $(jcode "$R") == "0" ]] || fail "wiki/delete" "$R"
pass "wiki deleted"

echo -e "\n${GREEN}Knowledge authz E2E passed.${NC}"
