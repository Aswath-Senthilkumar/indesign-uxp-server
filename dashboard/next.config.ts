import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
    // Tell Turbopack the workspace root is this folder, not the repo root.
    // The repo root has its own package-lock.json (for the MCP server) and
    // Next.js auto-detection picks that as the workspace root, surfacing a
    // warning and risking confused module resolution.
    turbopack: {
        root: here,
    },
};

export default nextConfig;
