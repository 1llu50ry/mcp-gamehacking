// 统一入口：直接启动 stateless panel（链路 A）。
// Legacy 链路 B 已移除，不再需要 PANEL_MODE 分叉。
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { main } from './panel/index.js';
main();
