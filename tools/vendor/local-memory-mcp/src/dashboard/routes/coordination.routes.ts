import { Router } from "express";
import { CoordinationController } from "../controllers/CoordinationController";

const router = Router();

router.get("/claims", CoordinationController.listClaims);
router.post("/claims/release", CoordinationController.releaseClaim);

router.post("/handoffs", CoordinationController.createHandoff);
router.get("/handoffs", CoordinationController.listHandoffs);
router.post("/handoffs/status", CoordinationController.updateHandoffStatus);

export default router;
