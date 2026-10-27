import { Router } from "express";
import { UnifiedGraphController } from "../controllers/UnifiedGraphController";

const router = Router();

router.get("/unified-graph", UnifiedGraphController.getGraph);

export default router;
