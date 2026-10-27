#!/usr/bin/env bash
# 发布 Memory Hub 多架构镜像到 Docker Hub。
#
# 流程：
#   1) secret-scan 源码（MemoryPanel + MemoryKnowledge）
#   2) PREPARE_ONLY 准备 context，再扫一遍 context
#   3) docker buildx 构建 linux/amd64 + linux/arm64 并 push
#
# 用法：
#   ./publish.sh                              # 默认 VERSION=1.0.0-beta.1，并推 :beta
#   VERSION=1.0.0-beta.2 ./publish.sh         # 版本 tag + 浮动 :beta（默认 ALSO_BETA=1）
#   ALSO_BETA=0 VERSION=1.0.0-beta.2 ./publish.sh   # 只推版本 tag，不挪 :beta
#   DRY_RUN=1 ./publish.sh                    # 只扫描 + 准备 context，不 build/push
#   PUSH=0 ./publish.sh                       # 本地 --load 单架构（默认 amd64）供抽查
#   ALSO_LATEST=1 ./publish.sh                # 额外打 agentmemory/memory-hub:latest（正式版再用）
#
# 前置：
#   - 已 docker login（账号需有 agentmemory org 推送权限）
#   - docker buildx 可用；默认 builder 名 multiarch（不存在则自动 create）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_ROOT="$(dirname "$REPO_ROOT")"

TMC_DIR="${TMC_DIR:-$REPO_ROOT/MemoryPanel}"
KNOWLEDGE_DIR="${KNOWLEDGE_DIR:-$REPO_ROOT/MemoryKnowledge}"
CTX_DIR="${CTX_DIR:-$WORKSPACE_ROOT/panel-knowledge-builder}"
VERSION="${VERSION:-1.0.0-beta.1}"
HUB_IMAGE="${HUB_IMAGE:-agentmemory/memory-hub}"
LOCAL_NAME="${LOCAL_NAME:-team-memory-panel-knowledge}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-multiarch}"
DRY_RUN="${DRY_RUN:-0}"
PUSH="${PUSH:-1}"
ALSO_BETA="${ALSO_BETA:-1}"
ALSO_LATEST="${ALSO_LATEST:-0}"
SECRET_SCAN="${SECRET_SCAN:-$TMC_DIR/scripts/secret-scan.sh}"

err() { echo "[publish-hub] error: $*" >&2; exit 1; }
log() { echo "[publish-hub] $*"; }

[[ -f "$TMC_DIR/package.json" ]] || err "MemoryPanel 不在 $TMC_DIR"
[[ -f "$KNOWLEDGE_DIR/package.json" ]] || err "MemoryKnowledge 不在 $KNOWLEDGE_DIR"
[[ -f "$SECRET_SCAN" ]] || err "secret-scan 不在 $SECRET_SCAN"
[[ -f "$SCRIPT_DIR/Dockerfile" ]] || err "Dockerfile 缺失"
command -v docker >/dev/null || err "需要 docker"
command -v rsync >/dev/null || err "需要 rsync"

# ── 1) 源码 secret-scan ─────────────────────────────────────────────
log "secret-scan: MemoryPanel"
(
  cd "$TMC_DIR"
  bash "$SECRET_SCAN" src web/src config package.json
)
log "secret-scan: MemoryKnowledge"
(
  cd "$KNOWLEDGE_DIR"
  bash "$SECRET_SCAN" src .env.example package.json
)

# ── 2) 准备 context ─────────────────────────────────────────────────
log "prepare context → $CTX_DIR"
KEEP_CTX=1 PREPARE_ONLY=1 CTX_DIR="$CTX_DIR" IMAGE_TAG="scan-$VERSION" \
  bash "$SCRIPT_DIR/build.sh"

[[ -f "$CTX_DIR/panel/package.json" && -f "$CTX_DIR/knowledge/package.json" ]] \
  || err "context 准备失败：$CTX_DIR"

log "secret-scan: build context"
(
  cd "$CTX_DIR"
  bash "$SECRET_SCAN" panel knowledge Dockerfile start-combined.sh .dockerignore
)

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN=1 → 跳过 build/push。context 保留在 $CTX_DIR"
  exit 0
fi

# ── 3) buildx multi-arch ────────────────────────────────────────────
# 注意：--push 只会推 TAG_ARGS 里的名字。本地名 team-memory-panel-knowledge
# 不能出现在 --push 里，否则会被当成 docker.io/library/... 导致 authorization failed。
HUB_TAGS=(-t "${HUB_IMAGE}:${VERSION}")
if [[ "$ALSO_BETA" == "1" ]]; then
  HUB_TAGS+=(-t "${HUB_IMAGE}:beta")
fi
if [[ "$ALSO_LATEST" == "1" ]]; then
  HUB_TAGS+=(-t "${HUB_IMAGE}:latest")
fi

log "builder=$BUILDER platforms=$PLATFORMS version=$VERSION also_beta=$ALSO_BETA also_latest=$ALSO_LATEST"
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  log "create buildx builder: $BUILDER"
  docker buildx create --name "$BUILDER" --driver docker-container --use
fi
docker buildx use "$BUILDER"
docker buildx inspect --bootstrap >/dev/null

if [[ "$PUSH" == "1" ]]; then
  log "buildx build --push ${HUB_IMAGE}:${VERSION} ($PLATFORMS)"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORMS" \
    "${HUB_TAGS[@]}" \
    --push \
    "$CTX_DIR"
  log "pushed ${HUB_IMAGE}:${VERSION}"
  [[ "$ALSO_BETA" == "1" ]] && log "also ${HUB_IMAGE}:beta"
  [[ "$ALSO_LATEST" == "1" ]] && log "also ${HUB_IMAGE}:latest"
else
  LOAD_PLATFORM="${LOAD_PLATFORM:-linux/amd64}"
  log "PUSH=0 → buildx --load ($LOAD_PLATFORM) as ${LOCAL_NAME}:${VERSION}"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$LOAD_PLATFORM" \
    -t "${LOCAL_NAME}:${VERSION}" \
    --load \
    "$CTX_DIR"
  log "spot-check image filesystem for .env / metadata-instances"
  cid=$(docker create "${LOCAL_NAME}:${VERSION}")
  cleanup() { docker rm -f "$cid" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  if docker export "$cid" | tar -t 2>/dev/null \
    | grep -E '(\.env$|metadata-instances\.json|/app/panel/\.env)' ; then
    err "镜像内出现疑似敏感路径，中止"
  fi
  cleanup
  trap - EXIT
  log "local image ready: ${LOCAL_NAME}:${VERSION}（未 push）"
fi

log "done. 验证: docker pull ${HUB_IMAGE}:${VERSION} && docker buildx imagetools inspect ${HUB_IMAGE}:${VERSION}"
