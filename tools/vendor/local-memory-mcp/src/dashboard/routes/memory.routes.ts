import { Router } from "express";
import { MemoriesController } from "../controllers/MemoriesController";

const router = Router();

router.get("/", MemoriesController.list);
router.post("/", MemoriesController.create);
router.post("/import", MemoriesController.bulkCreate);
router.post("/action", MemoriesController.bulkAction);
router.get("/:id", MemoriesController.get);
router.put("/:id", MemoriesController.update);
router.delete("/:id", MemoriesController.delete);

export default router;
