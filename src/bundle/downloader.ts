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

function stripTrailingSlashes(value: string): string {
    let end = value.length;

    while (end > 0 && value[end - 1] === "/") {
        end -= 1;
    }

    return value.slice(0, end);
}

/**
 * Build the URL for the agents index.json.
 */
export function buildIndexUrl(baseUrl: string): string {
    return `${stripTrailingSlashes(baseUrl)}/agents/index.json`;
}

/**
 * Build the URL for a versioned bundle zip.
 */
export function buildBundleUrl(baseUrl: string, version: string): string {
    return `${stripTrailingSlashes(baseUrl)}/agents/${version}/bundle.zip`;
}

/**
 * Build the URL for a bundle's SHA-256 hash sidecar file.
 */
export function buildHashUrl(baseUrl: string, version: string): string {
    return `${stripTrailingSlashes(baseUrl)}/agents/${version}/bundle.zip.sha256`;
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
export async function fetchBundleHash(baseUrl: string, version: string): Promise<string | null> {
    const url = buildHashUrl(baseUrl, version);

    const response = await fetch(url);

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
export async function fetchIndex(baseUrl: string): Promise<AgentsIndex> {
    const url = buildIndexUrl(baseUrl);

    const response = await fetch(url);
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
export async function downloadBundle(baseUrl: string, version?: string): Promise<DownloadResult> {
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
            const index = await fetchIndex(baseUrl);
            targetVersion = getLatestVersion(index);
        }

        const url = buildBundleUrl(baseUrl, targetVersion);
        const tempDir = getTempDir();
        await mkdir(tempDir, { recursive: true });

        const zipPath = path.join(tempDir, `${targetVersion}.zip`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download bundle: ${response.status} ${response.statusText} from ${url}`);
        }
        const buffer = await response.arrayBuffer();
        await writeFile(zipPath, new Uint8Array(buffer));

        let sha256: string | null = null;

        try {
            const expectedHash = await fetchBundleHash(baseUrl, targetVersion);

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
