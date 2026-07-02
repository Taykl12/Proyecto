import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { config } from "../config.js";
import {
  getEsp32Status,
  recordButtonPress,
  recordHeartbeat,
} from "../lib/esp32State.js";

const router = Router();

function requireDeviceToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.header("X-Device-Token");
  if (!token || token !== config.esp32DeviceToken) {
    res.status(401).json({ error: "Token de dispositivo inválido" });
    return;
  }
  next();
}

router.use(requireDeviceToken);

router.get("/heartbeat", (_req, res) => {
  recordHeartbeat();
  res.json({ ok: true });
});

router.post("/heartbeat", (_req, res) => {
  recordHeartbeat();
  res.json({ ok: true });
});

router.post("/button", (_req, res) => {
  recordButtonPress();
  res.json({ ok: true, ...getEsp32Status() });
});

export default router;
