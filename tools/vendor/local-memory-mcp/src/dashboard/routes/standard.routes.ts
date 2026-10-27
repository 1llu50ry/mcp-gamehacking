import { Router } from "express";
import { StandardsController } from "../controllers/StandardsController";

const router = Router();

router.get("/", StandardsController.list);
router.post("/", StandardsController.create);
router.get("/export", StandardsController.export);
router.post("/import", StandardsController.import);
router.post("/action", StandardsController.bulkAction);
router.get("/:id", StandardsController.get);
router.put("/:id", StandardsController.update);
router.delete("/:id", StandardsController.delete);

export default router;
