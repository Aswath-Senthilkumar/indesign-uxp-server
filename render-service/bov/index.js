import { Router } from "express";
import coverRouter   from "./routes/cover.js";
import section1Router from "./routes/section1.js";

const router = Router();

router.use(coverRouter);
router.use(section1Router);

export default router;
