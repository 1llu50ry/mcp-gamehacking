# Docker 部署说明

本目录包含 **team-memory-control**（Control 面板后端）的容器化构建文件。

## 目录结构

```
docker/
├── README.md                          # 本文件
└── local/
    ├── Dockerfile.local               # Control 单镜像（多阶段构建）
    └── Dockerfile.local.dockerignore  # 构建上下文忽略规则
```

## 镜像一览

| 镜像名（示例） | Dockerfile | 构建上下文 | 说明 |
|----------------|------------|------------|------|
| `team-memory-control:local` | `docker/local/Dockerfile.local` | **仓库根目录** `.` | Control HTTP 服务，默认 `:8123` |

---

## `docker/local/Dockerfile.local`

### 用途

构建 **Control 面板** 单体镜像：后端用 `tsx` 直跑 `src/index.ts`（stateless panel，入口 `src/panel/`），`web/` 前端在独立 stage 编译后以静态资源托管。

### 多阶段结构

| Stage | 作用 |
|-------|------|
| `base` | `node:22-slim` + 原生编译工具链（`better-sqlite3` 需要 `python3`/`make`/`g++`） |
| `ui-builder` | 编译 `web/`：`npm install` + `npm run build` → `dist/` |
| `runtime` | 拷贝全仓源码、`npm install`、嵌入 UI 产物，启动 Control |

### 构建参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `PANEL_UI` | `web` | 前端工程目录（当前活跃面板为 `web/`；`frontend/` 为历史目录，已不维护） |
| `WEB_UI` | `1` | `1` 正常构建面板 UI；`0` 跳过 UI 构建、生成占位 `index.html`（见下文「禁用面板 UI 构建」） |

运行时通过 `METADATA_INSTANCES_CONFIG` 指定实例表，`UI_DIST_DIR=./web/dist` 托管前端。

### 暴露端口与健康检查

- 端口：`8123`
- 健康检查：`GET http://127.0.0.1:8123/health`

---

## 构建与运行

### 前置条件

- Docker（建议启用 BuildKit）
- Node 引擎要求与仓库一致：`>=22`（见根 `package.json`）
- 在 **仓库根目录** 执行构建（上下文为整个仓库）

```bash
# 在仓库根目录
docker build \
  --build-arg PANEL_UI=web \
  -t team-memory-control:local \
  -f docker/local/Dockerfile.local .

docker run -d --name tmc-control \
  -p 8123:8123 \
  -e UI_DIST_DIR=./web/dist \
  -e METADATA_INSTANCES_CONFIG=/app/config/metadata-instances.json \
  -e KNOWLEDGE_SERVICE_URL=http://host.docker.internal:8421 \
  -e KNOWLEDGE_AUTH_TOKEN=<ks-token> \
  -e KNOWLEDGE_LLM_PROXY_BASE_URL=http://host.docker.internal:8096 \
  -v "$(pwd)/config/metadata-instances.json:/app/config/metadata-instances.json:ro" \
  team-memory-control:local
```

登录：浏览器打开 `http://localhost:8123/`，选择实例 ID，填入 Gateway 的 **user_key**。实例表字段见 [`config/metadata-instances.README.md`](../config/metadata-instances.README.md)。

若 Gateway 跑在宿主机，挂载的 `metadata-instances.json` 里 `gateway_endpoint` 须用容器可访问的地址（如 `http://host.docker.internal:8420`），不要用 `127.0.0.1`。

### 禁用面板 UI 构建（`WEB_UI=0`）

面板 UI 依赖 `@tencent/*` 等内部包，公共 npm 镜像不提供。若构建环境**无法访问内部 npm 源**（如离线机、外部 CI），`npm install` 会失败。此时用 `WEB_UI=0` 跳过 UI 构建：

```bash
docker build \
  --build-arg PANEL_UI=web \
  --build-arg WEB_UI=0 \
  -t team-memory-control:local-no-ui \
  -f docker/local/Dockerfile.local .
```

镜像会生成占位 `dist/index.html`，**Control 后端与 `/health`、`/api/*` 完全可用**，仅静态面板页面不可访问（前端路由返回占位提示）。需要面板 UI 时请用默认 `WEB_UI=1` 并确保能拉到内部依赖。

### 常用环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `UI_DIST_DIR` | `./web/dist` | 静态前端目录（Dockerfile 通过 `ENV` 设为 `./${PANEL_UI}/dist`） |
| `METADATA_INSTANCES_CONFIG` | `./config/metadata-instances.json` | 实例注册表路径 |
| `METADATA_REMOTE_TIMEOUT_MS` | `15000` | 转发 Gateway 超时 |
| `KNOWLEDGE_SERVICE_URL` | `http://127.0.0.1:8421` | Knowledge Service（KS）地址，容器内须指向容器可访问的 KS |
| `KNOWLEDGE_AUTH_TOKEN` | — | 调 KS 的 bearer token，按部署填充 |
| `KNOWLEDGE_TIMEOUT_MS` | `15000` | 调 KS 超时 |
| `KNOWLEDGE_LLM_BINDING_SYNC` | `true` | 启动时为每个实例确保 KS 的 LLM 绑定（走 proxy 记账）；`false` 跳过 |
| `KNOWLEDGE_LLM_PROXY_BASE_URL` | `http://127.0.0.1:8096` | LLM 记账 proxy 地址（容器内须可达） |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `json` | 本地可设 `LOG_FORMAT=pretty` |

> 注：`LLM_MODEL`（wiki ingest 模型）不在 Panel 配置，统一由 KS 侧 `LLM_MODEL` 决定（默认 `Memory-Model`）。

---

## `docker/local/Dockerfile.local.dockerignore`

BuildKit 会优先使用 `<dockerfile>.dockerignore`（而非仓库根 `.dockerignore`）。

主要排除：

- `**/node_modules`、`**/dist` — 避免宿主机平台编译的 `better-sqlite3` 或旧产物进入镜像
- `.env`、`data/`、`*.db` — 禁止把密钥与本地数据打进镜像
- `docs/`、测试报告等 — 缩小构建上下文

**安全提示**：`config/metadata-instances.json` **会**随 `COPY . .` 进入镜像。若含真实 `api_key`，生产镜像应改为运行时挂载，或在 dockerignore 中排除该文件并强制 `-v` 挂载。

---

## 本地开发对照

| 方式 | 命令 |
|------|------|
| 源码开发 | `pnpm dev` |
| Docker 单镜像 | 见上文 `docker build` / `docker run` |

---

## 故障排查

| 现象 | 可能原因 |
|------|----------|
| `GET /` 404 | `UI_DIST_DIR` 未设为 `./web/dist`，或前端 stage `npm run build` 失败 |
| 登录后 API 401 / 无 team | `metadata-instances.json` 中 `gateway_endpoint` 不可达，或 `api_key` 与 Gateway 不一致 |
| 知识资产加载失败 / 500 | `KNOWLEDGE_SERVICE_URL` 容器内不可达，或 `KNOWLEDGE_AUTH_TOKEN` 不匹配 |
| 启动卡在「ensure LLM binding」 | `KNOWLEDGE_LLM_PROXY_BASE_URL` 容器内不可达；可设 `KNOWLEDGE_LLM_BINDING_SYNC=false` 临时跳过 |
