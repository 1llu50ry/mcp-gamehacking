import { Router } from "express";
import { BugReportController } from "../controllers/BugReportController";

const router = Router();

router.get("/", BugReportController.list);
router.get("/stats", BugReportController.stats);
router.get("/:id", BugReportController.get);
router.post("/:id/resolve", BugReportController.resolve);

export default router;
