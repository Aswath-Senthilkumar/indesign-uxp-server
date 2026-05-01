/**
 * Path traversal protection (Block 3 mitigation, see pre-stage-2-prompt.md).
 *
 * Every handler that accepts a user-supplied filePath / folderPath / dataSource
 * MUST run it through validatePath() before passing it to the InDesign DOM or
 * to Node's fs API. validatePath resolves the path and rejects anything that
 * escapes the configured allow-list.
 *
 * Allow-list:
 *   INDESIGN_ALLOWED_ROOTS  comma- or semicolon-separated list of absolute
 *                           directories. Defaults to process.cwd() when unset.
 */
import path from 'path';

let cachedRoots = null;
let cachedRootSource = null;

function computeRoots() {
    const env = process.env.INDESIGN_ALLOWED_ROOTS;
    if (!env || !env.trim()) {
        return { roots: [path.resolve(process.cwd())], source: 'cwd' };
    }
    const roots = env
        .split(/[,;]/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .map((r) => path.resolve(r));
    return { roots, source: 'env' };
}

function getAllowedRoots() {
    if (cachedRoots === null) {
        const computed = computeRoots();
        cachedRoots = computed.roots;
        cachedRootSource = computed.source;
        if (cachedRootSource === 'cwd') {
            console.error(
                '[pathValidator] WARNING: INDESIGN_ALLOWED_ROOTS not set; defaulting to cwd ' +
                    `(${cachedRoots[0]}). Set the env var to widen the allow-list.`
            );
        }
    }
    return cachedRoots;
}

function caseFold(p) {
    return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isUnderRoot(resolved, root) {
    const r = caseFold(resolved);
    const rt = caseFold(root);
    if (r === rt) return true;
    return r.startsWith(rt + path.sep) || r.startsWith(rt + '/');
}

/**
 * Resolve and validate a user-supplied path.
 * @param {string} userPath
 * @param {string} [label] human-readable label included in error messages
 * @returns {string} the absolute, normalized path
 * @throws {Error} when userPath is empty, non-string, or escapes the allow-list
 */
export function validatePath(userPath, label = 'path') {
    if (typeof userPath !== 'string' || userPath.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    if (userPath.indexOf('\0') !== -1) {
        throw new Error(`${label} contains an embedded NUL byte`);
    }
    const resolved = path.resolve(userPath);
    const roots = getAllowedRoots();
    if (!roots.some((root) => isUnderRoot(resolved, root))) {
        throw new Error(
            `${label} "${userPath}" resolves to "${resolved}", which is outside the allowed roots [${roots.join(', ')}]. ` +
                'Set INDESIGN_ALLOWED_ROOTS to widen the allow-list.'
        );
    }
    return resolved;
}

/** Test-only — drop the cached roots so a new env value is picked up. */
export function _resetForTests() {
    cachedRoots = null;
    cachedRootSource = null;
}
