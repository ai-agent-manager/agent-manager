import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getTempDir } from "../config/paths.js";
import { getBundleEndpointTelemetryValue, trackTelemetryError, trackTelemetryEvent } from "../telemetry.js";

export interface IndexEntry {
    version: string;
    published: string;
}

export interface AgentsIndex {
    lastUpdated: string;
    agents: IndexEntry[];
}

export interface DownloadResult {
    zipPath: string;
    version: string;
    /** SHA-256 hash of the downloaded ZIP, or null if no sidecar was available. */
    sha256: string | null;
}

function authFetchOpts(bearerToken?: string): RequestInit | undefined {
    if (!bearerToken) return undefined;
    return { headers: { Authorization: `Bearer ${bearerToken}` } };
}

function stripTrailingSlashes(value: string): string {
    let end = value.length;

    while (end > 0 && value[end - 1] === "/") {
        end -= 1;
    }

    return value.slice(0, end);
}

/**
 * True when a path segment would escape its prefix — including after
 * percent-decoding (so `%2e%2e` and `foo%2f%2e%2e` cannot walk out of
 * `agents/`). Decoding is repeated a few times to catch double-encoding.
 */
function isTraversalSegment(segment: string): boolean {
    if (isUnsafePathSegment(segment)) return true;

    let current = segment;
    for (let i = 0; i < 5; i++) {
        let decoded: string;
        try {
            decoded = decodeURIComponent(current);
        } catch {
            // Malformed percent-encoding is not traversal; the segment is used literally.
            return false;
        }
        if (decoded === current) return false;
        if (isUnsafePathSegment(decoded) || decoded.includes("/")) return true;
        current = decoded;
    }

    return false;
}

function isUnsafePathSegment(segment: string): boolean {
    return segment === "." || segment === ".." || segment.includes("\\");
}

/**
 * Validate and normalise a `basePath` prefix for use in bundle URL construction.
 * Strips leading/trailing slashes. Throws on values that would let a discovery
 * document redirect requests off the configured origin: absolute URLs and
 * `..` path-traversal segments, including percent-encoded forms.
 */
export function normaliseBasePath(basePath: string): string {
    // Checked on the raw value: stripping leading slashes first would turn a
    // protocol-relative "//evil.example.com" into the innocuous-looking
    // "evil.example.com" before this check ever saw the double slash. The
    // third character must be non-slash (an actual host) so an all-slashes
    // value like "///" falls through to the empty-value check below instead.
    if (/^[a-z][a-z0-9+.-]*:/i.test(basePath) || /^\/\/[^/]/.test(basePath)) {
        throw new Error(`basePath must be a relative path, not an absolute URL: ${basePath}`);
    }

    const stripped = basePath.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!stripped) {
        throw new Error("basePath must not be empty");
    }

    if (stripped.split("/").some(isTraversalSegment)) {
        throw new Error(`basePath must not contain path traversal segments: ${basePath}`);
    }

    return stripped;
}

/** Build the `agents/[<basePath>/]` prefix shared by the index, bundle, and hash URLs. */
function buildAgentsPrefix(baseUrl: string, basePath?: string): string {
    const base = `${stripTrailingSlashes(baseUrl)}/agents`;
    return basePath ? `${base}/${normaliseBasePath(basePath)}` : base;
}

/**
 * Build the URL for the agents index.json.
 *
 * `basePath` addresses a bundle stream nested under `agents/` on an origin
 * that hosts several independent sources (see DiscoverySource.basePath).
 */
export function buildIndexUrl(baseUrl: string, basePath?: string): string {
    return `${buildAgentsPrefix(baseUrl, basePath)}/index.json`;
}

/**
 * Build the URL for a versioned bundle zip.
 */
export function buildBundleUrl(baseUrl: string, version: string, basePath?: string): string {
    return `${buildAgentsPrefix(baseUrl, basePath)}/${version}/bundle.zip`;
}

/**
 * Build the URL for a bundle's SHA-256 hash sidecar file.
 */
export function buildHashUrl(baseUrl: string, version: string, basePath?: string): string {
    return `${buildAgentsPrefix(baseUrl, basePath)}/${version}/bundle.zip.sha256`;
}

/**
 * Error thrown when a downloaded bundle fails integrity verification.
 */
export class IntegrityError extends Error {
    constructor(
        public readonly expected: string,
        public readonly actual: string,
    ) {
        super(
            `Bundle integrity check failed.\n` + `  Expected SHA-256: ${expected}\n` + `  Actual SHA-256:   ${actual}`,
        );
        this.name = "IntegrityError";
    }
}

/**
 * Fetch the SHA-256 hash sidecar for a versioned bundle.
 *
 * Returns the hex-encoded hash string if the sidecar exists, or `null`
 * if the server returns 404 or 403 (e.g. S3 bucket policy blocks the object).
 * Both are treated as "sidecar unavailable" for backward compatibility with
 * older bundles published before hash sidecars were introduced.
 *
 * Throws on other HTTP errors (500, network failures, etc.).
 */
export async function fetchBundleHash(
    baseUrl: string,
    version: string,
    bearerToken?: string,
    basePath?: string,
): Promise<string | null> {
    const url = buildHashUrl(baseUrl, version, basePath);

    const response = await fetch(url, authFetchOpts(bearerToken));

    if (response.status === 404 || response.status === 403) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch hash sidecar: ${response.status} ${response.statusText} from ${url}`);
    }

    const text = await response.text();
    // Parse sha256sum format: "<hex-hash>  <filename>\n"
    const hash = text.trim().split(/\s+/)[0];

    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
        throw new Error(`Invalid hash sidecar content from ${url}: expected 64-char hex SHA-256`);
    }

    return hash.toLowerCase();
}

/**
 * Verify the SHA-256 hash of a downloaded ZIP file against an expected hash.
 *
 * Throws `IntegrityError` if the hashes don't match.
 */
export async function verifyBundleHash(zipPath: string, expectedHash: string): Promise<void> {
    const content = await readFile(zipPath);
    const actualHash = createHash("sha256").update(content).digest("hex");

    if (actualHash !== expectedHash) {
        throw new IntegrityError(expectedHash, actualHash);
    }
}

/**
 * Fetch the agents index.json to discover available bundle versions.
 */
export async function fetchIndex(baseUrl: string, bearerToken?: string, basePath?: string): Promise<AgentsIndex> {
    const url = buildIndexUrl(baseUrl, basePath);

    const response = await fetch(url, authFetchOpts(bearerToken));
    if (!response.ok) {
        throw new Error(`Failed to fetch index: ${response.status} ${response.statusText} from ${url}`);
    }

    const index = (await response.json()) as AgentsIndex;

    if (!index.agents || !Array.isArray(index.agents)) {
        throw new Error('Invalid index.json: missing or invalid "agents" array');
    }

    return index;
}

/**
 * Get the latest version from an agents index.
 * Returns the last entry in the agents array (most recently added).
 */
export function getLatestVersion(index: AgentsIndex): string {
    if (index.agents.length === 0) {
        throw new Error("No versions available in index.json");
    }
    return index.agents[index.agents.length - 1].version;
}

/**
 * Download a versioned agents bundle from the given base URL.
 *
 * 1. Fetches agents/index.json to discover available versions.
 * 2. Downloads agents/<latest-version>/bundle.zip.
 * 3. Fetches agents/<version>/bundle.zip.sha256 and verifies the download.
 *
 * If `version` is provided, downloads that specific version instead of
 * the latest.
 *
 * If the hash sidecar is not found (older bundles), a warning is logged
 * and the download proceeds without verification.
 *
 * If the hash doesn't match, the downloaded ZIP is deleted and an
 * `IntegrityError` is thrown.
 */
export async function downloadBundle(
    baseUrl: string,
    version?: string,
    bearerToken?: string,
    basePath?: string,
): Promise<DownloadResult> {
    const requestType = version ? "specific" : "latest";
    let targetVersion = version ?? "latest";
    const bundleEndpoint = getBundleEndpointTelemetryValue(baseUrl);

    trackTelemetryEvent({
        action: "bundle_download_started",
        properties: {
            source: "url",
            bundleEndpoint,
            request: requestType,
            version: version ?? undefined,
        },
    });

    try {
        if (!version) {
            const index = await fetchIndex(baseUrl, bearerToken, basePath);
            targetVersion = getLatestVersion(index);
        }

        const url = buildBundleUrl(baseUrl, targetVersion, basePath);
        const tempDir = getTempDir();
        await mkdir(tempDir, { recursive: true });

        const zipPath = path.join(tempDir, `${targetVersion}.zip`);
        const response = await fetch(url, authFetchOpts(bearerToken));
        if (!response.ok) {
            throw new Error(`Failed to download bundle: ${response.status} ${response.statusText} from ${url}`);
        }
        const buffer = await response.arrayBuffer();
        await writeFile(zipPath, new Uint8Array(buffer));

        let sha256: string | null = null;

        try {
            const expectedHash = await fetchBundleHash(baseUrl, targetVersion, bearerToken, basePath);

            if (expectedHash) {
                await verifyBundleHash(zipPath, expectedHash);
                sha256 = expectedHash;
            } else {
                console.warn(`Warning: Hash file unavailable for version ${targetVersion}. Skipping integrity check.`);
            }
        } catch (error) {
            if (error instanceof IntegrityError) {
                await rm(zipPath, { force: true });
            }

            throw error;
        }

        trackTelemetryEvent({
            action: "bundle_download_succeeded",
            properties: {
                source: "url",
                bundleEndpoint,
                request: requestType,
                version: targetVersion,
            },
        });

        return { zipPath, version: targetVersion, sha256 };
    } catch (error) {
        trackTelemetryError("bundle_download_failed", error, {
            source: "url",
            bundleEndpoint,
            request: requestType,
            version: targetVersion,
        });
        throw error;
    }
}
