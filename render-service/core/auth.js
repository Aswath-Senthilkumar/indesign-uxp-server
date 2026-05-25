/**
 * Optional bearer-token middleware.
 *
 * When `config.serviceToken` is set, every request EXCEPT `/status`
 * must carry `Authorization: Bearer <SERVICE_TOKEN>`. When unset (the
 * Phase 1 default), the middleware is a no-op.
 *
 * Phase 1 intent: leave the hook in place so the cloud phase only has
 * to flip the env var and share the token with the upstream caller.
 * Do not wire real secrets here.
 */

import config from "../config.js";

export function authMiddleware(req, res, next) {
    if (!config.serviceToken) return next();

    // /status is always reachable so callers can pre-flight bridge
    // connectivity without holding the token.
    if (req.path === "/status") return next();

    const header = req.headers["authorization"] || "";
    if (header !== `Bearer ${config.serviceToken}`) {
        return res.status(401).json({
            error: "Unauthorized: missing or invalid SERVICE_TOKEN",
        });
    }
    return next();
}
