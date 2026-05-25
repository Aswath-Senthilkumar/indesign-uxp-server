/**
 * Bridge HTTP client.
 *
 * Single source of truth for the bridge base URL — every caller in this
 * service imports from here. Error strings interpolate `config.bridgeUrl`
 * so misconfigured URLs surface in the message instead of a hardcoded
 * "127.0.0.1:3000".
 */

import config from "../config.js";

/**
 * @returns {Promise<{ connected: boolean, queueDepth: number }>}
 */
export async function bridgeStatus() {
    let r;
    try {
        r = await fetch(`${config.bridgeUrl}/status`, { cache: "no-store" });
    } catch (e) {
        const err = new Error(
            `bridge unreachable at ${config.bridgeUrl}: ${e.message}`
        );
        err.code = "BRIDGE_UNREACHABLE";
        throw err;
    }
    if (!r.ok) {
        const err = new Error(
            `bridge returned ${r.status} from ${config.bridgeUrl}/status`
        );
        err.code = "BRIDGE_BAD_STATUS";
        err.httpStatus = r.status;
        throw err;
    }
    return r.json();
}

/**
 * POST a JS code string to the bridge for in-plugin execution. Returns
 * the inner `result` payload that the plugin produced.
 *
 * Throws an Error annotated with:
 *   - `code: "BRIDGE_UNREACHABLE"` when fetch itself fails
 *   - `code: "BRIDGE_BAD_RESPONSE"` when the bridge returns non-2xx
 *     (with `httpStatus` set to the upstream code)
 *
 * @param {string} code  JS source the plugin will eval inside InDesign
 * @returns {Promise<unknown>}
 */
export async function bridgeExecute(code) {
    let r;
    try {
        r = await fetch(`${config.bridgeUrl}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
            cache: "no-store",
        });
    } catch (e) {
        const err = new Error(
            `bridge unreachable at ${config.bridgeUrl}: ${e.message}`
        );
        err.code = "BRIDGE_UNREACHABLE";
        throw err;
    }

    let body;
    try {
        body = await r.json();
    } catch {
        body = {};
    }

    if (!r.ok) {
        const msg = (body && body.error) || `bridge ${r.status}`;
        const err = new Error(msg);
        err.code = "BRIDGE_BAD_RESPONSE";
        err.httpStatus = r.status;
        throw err;
    }
    return body.result;
}

/**
 * The configured bridge URL (frozen). Exposed so error responders can
 * include the actual value the operator configured, not a hardcoded
 * default.
 */
export const bridgeUrl = config.bridgeUrl;
