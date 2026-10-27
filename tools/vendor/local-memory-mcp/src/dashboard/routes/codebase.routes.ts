import { Router } from "express";
import { CodebaseController } from "../controllers/CodebaseController";

const router = Router();

router.get("/architecture", CodebaseController.getArchitecture);
router.get("/symbols", CodebaseController.getFileSymbols);
router.get("/search", CodebaseController.searchSymbols);
router.get("/code-search", CodebaseController.searchCode);
router.get("/trace", CodebaseController.traceSymbol);
router.get("/file/content", CodebaseController.getFileContent);
router.post("/file/content", CodebaseController.getFileContent);
router.get("/symbol/callers", CodebaseController.getSymbolCallers);
router.get("/graph", CodebaseController.getCodeGraph);
router.get("/index-status", CodebaseController.getIndexStatus);
router.post("/index", CodebaseController.startIndex);
router.post("/auto-index", CodebaseController.autoIndex);

export default router;
