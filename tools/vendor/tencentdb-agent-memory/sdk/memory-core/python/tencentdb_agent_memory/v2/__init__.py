"""TencentDB Agent Memory v2 Python SDK (现有数据面 + 管理面 API，路径走 /v2)。

显式 v2 入口；顶层 `from tencentdb_agent_memory import MemoryClient` 仍指向这里，
所以老代码升级 SDK 后零修改即可继续工作。
"""

from .client import AsyncMemoryClient, MemoryClient

__all__ = ["MemoryClient", "AsyncMemoryClient"]
