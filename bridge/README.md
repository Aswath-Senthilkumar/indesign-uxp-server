# bridge

Lightweight HTTP + WebSocket relay between the Node.js services (MCP server, render service) and the Adobe InDesign UXP plugin. It has no workflow knowledge — it just relays JS code strings and serialised results.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| `3000` | HTTP | `/execute` — receives code strings from MCP server / render service |
| `3001` | WebSocket | Persistent connection to the UXP plugin running inside InDesign |

## Architecture

```
MCP Server  ─┐
              ├── POST /execute { code, id }
Render Svc  ─┘         │
                        ▼
              Bridge HTTP server (:3000)
                        │  { type: "execute", code, id } over WS
                        ▼
              UXP Plugin (:3001 WS, inside InDesign)
                        │  new Function('app', `return (async () => { code })()`)
                        ▼
              InDesign DOM
                        │  serialised JSON result
                        ▼
              Bridge → HTTP 200 → caller
```

## Serial execution queue

All `/execute` calls are queued and run one at a time. Concurrent callers block until the current execution finishes. This prevents overlapping DOM mutations and keeps InDesign state consistent across multi-step renders.

Each execution has a **30-second timeout**. If InDesign does not return a result in time, the bridge rejects the request with a timeout error.

## Authentication

Set `BRIDGE_TOKEN` in the environment to require `Authorization: Bearer <token>` on every `/execute` request. Unset by default — any local caller can submit code. Enable in shared environments.

## Files

| File | Purpose |
|------|---------|
| `server.js` | Express HTTP app + `ws` WebSocket server, execution queue, pending request map, timeout handling |
| `package.json` | Dependencies: `express`, `ws`, `uuid` |

## Startup

```bash
cd bridge
npm install       # once
node server.js
```

The plugin (inside InDesign) must open its panel and connect before any `/execute` call will succeed. Verify via the render service:

```bash
curl http://127.0.0.1:8765/status
# { "connected": true, "queueDepth": 0, ... }
```

If `connected` is `false`, re-open the **InDesign Bridge** panel in InDesign.
