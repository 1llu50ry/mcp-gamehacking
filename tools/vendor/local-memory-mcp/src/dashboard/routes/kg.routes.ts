import { Router } from "express";
import { KGController } from "../controllers/KGController";

const router = Router();

router.get("/kg/entities", KGController.listEntities);
router.get("/kg/entities/:name", KGController.getEntity);
router.post("/kg/entities", KGController.createEntity);
router.delete("/kg/entities/:name", KGController.deleteEntity);
router.get("/kg/relations", KGController.listRelations);
router.post("/kg/relations", KGController.createRelation);
router.delete("/kg/relations", KGController.deleteRelation);
router.delete("/kg/observations/:id", KGController.deleteObservation);
router.get("/kg/graph", KGController.listGraph);

export default router;
