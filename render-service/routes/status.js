/**
 * GET /status
 *
 * Reflects the bridge's own /status response so callers can pre-flight
 * connectivity without knowing the bridge URL. Returns the service's
 * own bridge URL alongside the bridge's connected/queueDepth so error
 * messages can be self-describing.
 *
 * Always 200 with `connected: false` when the bridge is unreachable —
 * callers should branch on the connected flag, not the HTTP status,
 * to differentiate "bridge says no" from "service down".
 */

import express from "express";
import { bridgeStatus } from "../core/bridge-client.js";
import config from "../config.js";

const router = express.Router();

router.get("/status", async (_req, res) => {
    try {
        const s = await bridgeStatus();
        return res.json({
            service: "render-service",
            bridgeUrl: config.bridgeUrl,
            connected: !!s.connected,
            queueDepth: s.queueDepth ?? 0,
        });
    } catch (e) {
        return res.status(503).json({
            service: "render-service",
            bridgeUrl: config.bridgeUrl,
            connected: false,
            queueDepth: 0,
            error: `bridge unreachable at ${config.bridgeUrl}`,
            hint: "start the bridge: cd bridge && node server.js",
            detail: e.message,
        });
    }
});

export default router;
