import { Router } from "express";
import { SystemController } from "../controllers/SystemController";
import { ArenaController } from "../controllers/ArenaController";

const router = Router();

router.get("/health", SystemController.getHealth);
router.get("/repos", SystemController.getRepos);
router.get("/stats", SystemController.getStats);
router.get("/metrics", SystemController.getMetrics);
router.get("/recent-actions", SystemController.getRecentActions);
router.get("/dashboard/overview", ArenaController.getOverview);
router.get("/capabilities", SystemController.getCapabilities);
router.get("/export", SystemController.getExport);
router.post("/tools/:name/call", SystemController.callTool);

export default router;
