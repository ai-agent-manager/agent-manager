import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getTempDir } from "../config/paths.js";
import { assertSafeCacheSegment } from "../lib/path-segment.js";
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
 * Validate and canonicalise a source content root.
 *
 * A content root is the directory that owns a source's `index.json` and its
 * versioned subdirectories — the exact URL a discovery document declares. The
 * client appends nothing but the file names below, so a source is free to
 * publish at any path.
 *
 * Query strings and fragments are dropped: a directory is addressed by path,
 * and keeping them would let two spellings of one root look like two sources.
 */
export function canonicaliseContentRoot(contentRoot: string): string {
    const parsed = new URL(contentRoot);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Content root must use http or https: ${contentRoot}`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Content root must not contain credentials: ${contentRoot}`);
    }
    parsed.search = "";
    parsed.hash = "";
    return stripTrailingSlashes(parsed.toString());
}

/**
 * Build the URL for a source's index.json.
 */
export function buildIndexUrl(contentRoot: string): string {
    return `${canonicaliseContentRoot(contentRoot)}/index.json`;
}

function buildVersionedUrl(contentRoot: string, version: string, fileName: string): string {
    if (!version) {
        throw new Error("Bundle version must not be empty");
    }
    return `${canonicaliseContentRoot(contentRoot)}/${encodeURIComponent(version)}/${fileName}`;
}

/**
 * Build the URL for a versioned bundle zip.
 */
export function buildBundleUrl(contentRoot: string, version: string): string {
    return buildVersionedUrl(contentRoot, version, "bundle.zip");
}

/**
 * Build the URL for a bundle's SHA-256 hash sidecar file.
 */
export function buildHashUrl(contentRoot: string, version: string): string {
    return buildVersionedUrl(contentRoot, version, "bundle.zip.sha256");
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
    contentRoot: string,
    version: string,
    bearerToken?: string,
): Promise<string | null> {
    const url = buildHashUrl(contentRoot, version);

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
 * Fetch a source's index.json to discover available bundle versions.
 */
export async function fetchIndex(contentRoot: string, bearerToken?: string): Promise<AgentsIndex> {
    const url = buildIndexUrl(contentRoot);

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
 * Download a versioned bundle from a source's content root.
 *
 * 1. Fetches <root>/index.json to discover available versions.
 * 2. Downloads <root>/<latest-version>/bundle.zip.
 * 3. Fetches <root>/<version>/bundle.zip.sha256 and verifies the download.
 *
 * If `version` is provided, downloads that specific version instead of
 * the latest.
 *
 * `sourceKey` distinguishes the temp file, so two sources publishing the same
 * version number cannot overwrite each other's download in flight.
 *
 * If the hash sidecar is not found (older bundles), a warning is logged
 * and the download proceeds without verification.
 *
 * If the hash doesn't match, the downloaded ZIP is deleted and an
 * `IntegrityError` is thrown.
 */
export async function downloadBundle(
    contentRoot: string,
    version?: string,
    bearerToken?: string,
    sourceKey?: string,
): Promise<DownloadResult> {
    const root = canonicaliseContentRoot(contentRoot);
    const requestType = version ? "specific" : "latest";
    let targetVersion = version ?? "latest";
    const bundleEndpoint = getBundleEndpointTelemetryValue(root);

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
            const index = await fetchIndex(root, bearerToken);
            targetVersion = getLatestVersion(index);
        }

        const url = buildBundleUrl(root, targetVersion);
        const tempDir = getTempDir();
        await mkdir(tempDir, { recursive: true });

        // targetVersion comes from a remote index.json, so it reaches this
        // path.join before anything has verified the download.
        assertSafeCacheSegment(targetVersion, "Bundle version");
        const zipPath = path.join(tempDir, `${targetVersion}${sourceKey ? `-${sourceKey}` : ""}.zip`);
        const response = await fetch(url, authFetchOpts(bearerToken));
        if (!response.ok) {
            throw new Error(`Failed to download bundle: ${response.status} ${response.statusText} from ${url}`);
        }
        const buffer = await response.arrayBuffer();
        await writeFile(zipPath, new Uint8Array(buffer));

        let sha256: string | null = null;

        try {
            const expectedHash = await fetchBundleHash(root, targetVersion, bearerToken);

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
