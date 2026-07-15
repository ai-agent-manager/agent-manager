import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BundleContents, RovoAgentInfo } from '../bundle/scanner.js';
import type { BundleManifest } from '../bundle/manifest.js';
import { getAgentmanDir } from '../config/paths.js';

// ---------------------------------------------------------------------------
// Input sanitisation
// ---------------------------------------------------------------------------

/**
 * Strict allowlist for directory names used as agent identifiers.
 *
 * Rejects anything that:
 *  - contains path separators (/ or \)
 *  - is a relative path component (. or ..)
 *  - contains null bytes or other control characters
 *  - is empty or exceeds 255 characters
 *
 * This is the first line of defence against directory traversal.
 */
function isSafeDirName(name: string): boolean {
  if (!name || name.length > 255) return false;

  // Must not contain path separators, null bytes, or control chars
  if (/[/\\]/.test(name)) return false;
  // oxlint-disable-next-line no-control-regex -- intentionally matches control characters for file-name sanitisation
  if (/[\x00-\x1f]/.test(name)) return false;

  // Must not be a relative path component
  if (name === '.' || name === '..') return false;

  // Must only contain alphanumeric, hyphen, underscore, dot (no leading dot)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) return false;

  return true;
}

/**
 * Verify that a resolved filesystem path is contained within the
 * ~/.agentman directory. This is a belt-and-suspenders check applied
 * *after* input sanitisation, to catch anything that slipped through.
 *
 * Uses `path.resolve()` to normalise symlinks and relative segments,
 * then verifies the canonical path starts with the agentman root.
 */
function isWithinAgentmanDir(resolvedPath: string): boolean {
  const root = path.resolve(getAgentmanDir());
  const normalised = path.resolve(resolvedPath);
  // Must be exactly the root or start with root + separator
  return normalised === root || normalised.startsWith(root + path.sep);
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message });
}

// ---------------------------------------------------------------------------
// Route context — shared state injected by the server
// ---------------------------------------------------------------------------

export interface RouteContext {
  bundleContents: BundleContents;
  manifest: BundleManifest;
  bundleDir: string;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /health — unauthenticated health check.
 * Returns 200 with `{ status: "ok" }`.
 */
export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, { status: 'ok' });
}

/**
 * GET /bundle/info — returns current bundle metadata.
 */
export function handleBundleInfo(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): void {
  jsonResponse(res, 200, {
    version: ctx.manifest.version,
    published: ctx.manifest.published,
    agentCount: ctx.bundleContents.rovoAgents.length,
    skillCount: ctx.bundleContents.skills.length,
  });
}

/**
 * GET /agents — list all Rovo agents in the current bundle.
 * Returns summary information only (no full config or file contents).
 */
export function handleListAgents(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): void {
  const agents = ctx.bundleContents.rovoAgents.map((agent) => ({
    dirName: agent.dirName,
    name: agent.config.identity.name,
    description: agent.config.identity.description,
    avatar: agent.config.identity.avatar ?? null,
    meta: agent.meta,
  }));
  jsonResponse(res, 200, agents);
}

/**
 * GET /agents/:dirName — return the full resolved config for a single agent.
 *
 * Security: The dirName parameter is validated with a strict allowlist
 * and the resolved path is verified to remain within ~/.agentman/.
 * The agent config is already fully resolved in memory (all $file refs
 * have been read at bundle scan time), so no filesystem reads are
 * performed during this request — the response is served from the
 * in-memory BundleContents.
 */
export function handleGetAgent(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  dirName: string
): void {
  // --- Input sanitisation ---

  // 1. Strict character allowlist
  if (!isSafeDirName(dirName)) {
    errorResponse(res, 400, 'Invalid agent name: contains disallowed characters');
    return;
  }

  // 2. Verify the resolved path stays within ~/.agentman/
  const candidatePath = path.resolve(ctx.bundleDir, dirName);
  if (!isWithinAgentmanDir(candidatePath)) {
    errorResponse(res, 400, 'Invalid agent name: path traversal detected');
    return;
  }

  // --- Lookup ---

  // Lookup is performed against the in-memory agent list, NOT the filesystem.
  // This means even if sanitisation were bypassed, no arbitrary file reads
  // would occur — we only return data that was loaded at bundle scan time.
  const agent: RovoAgentInfo | undefined = ctx.bundleContents.rovoAgents.find(
    (a) => a.dirName === dirName
  );

  if (!agent) {
    errorResponse(res, 404, `Agent '${dirName}' not found`);
    return;
  }

  jsonResponse(res, 200, {
    dirName: agent.dirName,
    config: agent.config,
    meta: agent.meta,
  });
}

// ---------------------------------------------------------------------------
// Route matcher
// ---------------------------------------------------------------------------

/**
 * Parse the URL path and dispatch to the appropriate handler.
 * Returns `false` if no route matches (caller should return 404).
 */
export function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): boolean {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // Normalise: remove trailing slash (but keep '/' as-is)
  const normalised = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  if (normalised === '/health') {
    handleHealth(req, res);
    return true;
  }

  if (normalised === '/bundle/info') {
    handleBundleInfo(req, res, ctx);
    return true;
  }

  if (normalised === '/agents') {
    handleListAgents(req, res, ctx);
    return true;
  }

  // Match /agents/:dirName
  const agentMatch = normalised.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    const dirName = decodeURIComponent(agentMatch[1]!);
    handleGetAgent(req, res, ctx, dirName);
    return true;
  }

  return false;
}
