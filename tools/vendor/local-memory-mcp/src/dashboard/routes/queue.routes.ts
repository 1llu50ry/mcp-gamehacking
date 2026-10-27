import { Router } from "express";
import { QueueController } from "../controllers/QueueController";

const router = Router();

// TASK-013 observability (unchanged; back-compat).
router.get("/status", QueueController.status);

// TASK-296 failed-job admin. Literal enum statuses on the wire
// (pending|claimed|done|poison) — the UI renders 'poison' as "failed" only.
router.get("/jobs", QueueController.listJobs);
router.post("/jobs/:id/retry", QueueController.retryJob);
router.post("/jobs/:id/clear", QueueController.clearJob);
router.delete("/jobs/:id", QueueController.clearJob);
router.post("/retry-all", QueueController.retryAll);

export default router;
