import { Router } from "express";
import { TasksController } from "../controllers/TasksController";

const router = Router();

router.get("/", TasksController.list);
router.post("/", TasksController.create);
router.post("/import", TasksController.bulkCreate);
router.post("/action", TasksController.bulkAction);
router.get("/stats/time", TasksController.getTimeStats);
router.get("/by-code", TasksController.getByCode);
router.get("/:id", TasksController.get);
router.put("/:id", TasksController.update);
router.delete("/:id", TasksController.delete);
router.put("/comments/:id", TasksController.updateComment);
router.delete("/comments/:id", TasksController.deleteComment);

export default router;
