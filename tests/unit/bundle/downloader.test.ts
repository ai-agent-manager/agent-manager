import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    buildIndexUrl,
    buildBundleUrl,
    buildHashUrl,
    getLatestVersion,
    fetchIndex,
    fetchBundleHash,
    verifyBundleHash,
    downloadBundle,
    IntegrityError,
    type AgentsIndex,
} from "../../../src/bundle/downloader.js";

const { trackTelemetryEvent, trackTelemetryError } = vi.hoisted(() => ({
    trackTelemetryEvent: vi.fn(),
    trackTelemetryError: vi.fn(),
}));

let mockTempDir = "";

vi.mock("../../../src/config/paths.js", () => ({
    getTempDir: () => mockTempDir,
}));

vi.mock("../../../src/telemetry.js", async () => {
    const actual = await vi.importActual<typeof import("../../../src/telemetry.js")>("../../../src/telemetry.js");

    return {
        ...actual,
        trackTelemetryEvent,
        trackTelemetryError,
    };
});

describe("buildIndexUrl", () => {
    it("appends /agents/index.json to a clean base URL", () => {
        expect(buildIndexUrl("https://example.com")).toBe("https://example.com/agents/index.json");
    });

    it("strips a single trailing slash", () => {
        expect(buildIndexUrl("https://example.com/")).toBe("https://example.com/agents/index.json");
    });

    it("strips multiple trailing slashes", () => {
        expect(buildIndexUrl("https://example.com///")).toBe("https://example.com/agents/index.json");
    });

    it("handles a base URL with a path", () => {
        expect(buildIndexUrl("https://cdn.example.com/my-org")).toBe(
            "https://cdn.example.com/my-org/agents/index.json",
        );
    });

    it("handles a base URL with a path and trailing slash", () => {
        expect(buildIndexUrl("https://cdn.example.com/my-org/")).toBe(
            "https://cdn.example.com/my-org/agents/index.json",
        );
    });

    it("handles localhost URLs", () => {
        expect(buildIndexUrl("http://localhost:3000")).toBe("http://localhost:3000/agents/index.json");
    });
});

describe("buildBundleUrl", () => {
    it("appends /agents/<version>/bundle.zip to a clean base URL", () => {
        expect(buildBundleUrl("https://example.com", "1.0.0")).toBe("https://example.com/agents/1.0.0/bundle.zip");
    });

    it("strips a single trailing slash", () => {
        expect(buildBundleUrl("https://example.com/", "2.1.0")).toBe("https://example.com/agents/2.1.0/bundle.zip");
    });

    it("strips multiple trailing slashes", () => {
        expect(buildBundleUrl("https://example.com///", "1.0.0-beta.1")).toBe(
            "https://example.com/agents/1.0.0-beta.1/bundle.zip",
        );
    });

    it("handles a base URL with a path", () => {
        expect(buildBundleUrl("https://cdn.example.com/my-org", "3.0.0")).toBe(
            "https://cdn.example.com/my-org/agents/3.0.0/bundle.zip",
        );
    });

    it("handles a base URL with a path and trailing slash", () => {
        expect(buildBundleUrl("https://cdn.example.com/my-org/", "1.2.3")).toBe(
            "https://cdn.example.com/my-org/agents/1.2.3/bundle.zip",
        );
    });

    it("handles localhost URLs", () => {
        expect(buildBundleUrl("http://localhost:3000", "0.1.0")).toBe("http://localhost:3000/agents/0.1.0/bundle.zip");
    });
});

describe("getLatestVersion", () => {
    it("returns the last version in the agents array", () => {
        const index: AgentsIndex = {
            lastUpdated: "2025-01-01T00:00:00",
            agents: [
                { version: "1.0.0", published: "2025-01-01T00:00:00" },
                { version: "1.1.0", published: "2025-02-01T00:00:00" },
                { version: "2.0.0", published: "2025-03-01T00:00:00" },
            ],
        };
        expect(getLatestVersion(index)).toBe("2.0.0");
    });

    it("returns the only version when there is one entry", () => {
        const index: AgentsIndex = {
            lastUpdated: "2025-01-01T00:00:00",
            agents: [{ version: "1.0.0", published: "2025-01-01T00:00:00" }],
        };
        expect(getLatestVersion(index)).toBe("1.0.0");
    });

    it("throws when the agents array is empty", () => {
        const index: AgentsIndex = {
            lastUpdated: "2025-01-01T00:00:00",
            agents: [],
        };
        expect(() => getLatestVersion(index)).toThrow("No versions available in index.json");
    });
});

describe("fetchIndex", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.clearAllMocks();
    });

    it("fetches and returns a valid index", async () => {
        const mockIndex: AgentsIndex = {
            lastUpdated: "2025-06-01T00:00:00",
            agents: [
                { version: "1.0.0", published: "2025-05-01T00:00:00" },
                { version: "1.1.0", published: "2025-06-01T00:00:00" },
            ],
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockIndex,
        });

        const result = await fetchIndex("https://example.com");
        expect(result.agents).toHaveLength(2);
        expect(result.agents[0].version).toBe("1.0.0");
        expect(result.agents[1].version).toBe("1.1.0");
        expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/agents/index.json", undefined);
    });

    it("throws on non-ok HTTP response", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
        });

        await expect(fetchIndex("https://example.com")).rejects.toThrow("Failed to fetch index: 404 Not Found");
    });

    it("throws when response has no agents array", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ lastUpdated: "2025-01-01T00:00:00" }),
        });

        await expect(fetchIndex("https://example.com")).rejects.toThrow(
            'Invalid index.json: missing or invalid "agents" array',
        );
    });

    it("throws when agents is not an array", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ lastUpdated: "2025-01-01T00:00:00", agents: "not-an-array" }),
        });

        await expect(fetchIndex("https://example.com")).rejects.toThrow(
            'Invalid index.json: missing or invalid "agents" array',
        );
    });
});

describe("downloadBundle telemetry", () => {
    const originalFetch = globalThis.fetch;
    let tempDir: string;
    const hash = createHash("sha256")
        .update(new Uint8Array([1, 2, 3]))
        .digest("hex");

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await mkdtemp(path.join(os.tmpdir(), "download-bundle-telemetry-test-"));
        mockTempDir = tempDir;
    });

    afterEach(async () => {
        globalThis.fetch = originalFetch;
        await rm(tempDir, { recursive: true, force: true });
    });

    it("tracks bundle download start and success", async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    lastUpdated: "2025-06-01T00:00:00",
                    agents: [{ version: "1.1.0", published: "2025-06-01T00:00:00" }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => `${hash}  1.1.0.zip\n`,
            });
        await downloadBundle("https://example.com");

        expect(trackTelemetryEvent).toHaveBeenNthCalledWith(1, {
            action: "bundle_download_started",
            properties: {
                source: "url",
                bundleEndpoint: "https://example.com",
                request: "latest",
                version: undefined,
            },
        });
        expect(trackTelemetryEvent).toHaveBeenNthCalledWith(2, {
            action: "bundle_download_succeeded",
            properties: {
                source: "url",
                bundleEndpoint: "https://example.com",
                request: "latest",
                version: "1.1.0",
            },
        });
        expect(trackTelemetryError).not.toHaveBeenCalled();
    });

    it("tracks bundle download failures with an error category wrapper", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Server Error",
        });

        await expect(downloadBundle("https://example.com", "1.2.0")).rejects.toThrow(
            "Failed to download bundle: 500 Server Error from https://example.com/agents/1.2.0/bundle.zip",
        );

        expect(trackTelemetryEvent).toHaveBeenCalledWith({
            action: "bundle_download_started",
            properties: {
                source: "url",
                bundleEndpoint: "https://example.com",
                request: "specific",
                version: "1.2.0",
            },
        });
        expect(trackTelemetryError).toHaveBeenCalledWith("bundle_download_failed", expect.any(Error), {
            source: "url",
            bundleEndpoint: "https://example.com",
            request: "specific",
            version: "1.2.0",
        });
    });
});

// ── buildHashUrl ─────────────────────────────────────────────────────────────

describe("buildHashUrl", () => {
    it("appends /agents/<version>/bundle.zip.sha256 to a clean base URL", () => {
        expect(buildHashUrl("https://example.com", "1.0.0")).toBe("https://example.com/agents/1.0.0/bundle.zip.sha256");
    });

    it("strips trailing slashes", () => {
        expect(buildHashUrl("https://example.com/", "2.1.0")).toBe(
            "https://example.com/agents/2.1.0/bundle.zip.sha256",
        );
    });

    it("handles a base URL with a path", () => {
        expect(buildHashUrl("https://cdn.example.com/my-org", "3.0.0")).toBe(
            "https://cdn.example.com/my-org/agents/3.0.0/bundle.zip.sha256",
        );
    });
});

// ── fetchBundleHash ──────────────────────────────────────────────────────────

describe("fetchBundleHash", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("returns parsed hash when sidecar exists", async () => {
        const expectedHash = "a".repeat(64);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => `${expectedHash}  1.0.0.zip\n`,
        });

        const result = await fetchBundleHash("https://example.com", "1.0.0");
        expect(result).toBe(expectedHash);
        expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/agents/1.0.0/bundle.zip.sha256", undefined);
    });

    it("returns null when sidecar returns 404", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
        });
        const result = await fetchBundleHash("https://example.com", "1.0.0");
        expect(result).toBeNull();
    });

    it("returns null when sidecar returns 403", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            statusText: "Forbidden",
        });

        const result = await fetchBundleHash("https://example.com", "1.0.0");
        expect(result).toBeNull();
    });

    it("throws on other HTTP errors", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
        });

        await expect(fetchBundleHash("https://example.com", "1.0.0")).rejects.toThrow(
            "Failed to fetch hash sidecar: 500 Internal Server Error",
        );
    });

    it("throws on invalid hash content", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => "not-a-valid-hash",
        });

        await expect(fetchBundleHash("https://example.com", "1.0.0")).rejects.toThrow("Invalid hash sidecar content");
    });

    it("normalises hash to lowercase", async () => {
        const upperHash = "A".repeat(64);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => `${upperHash}  1.0.0.zip\n`,
        });

        const result = await fetchBundleHash("https://example.com", "1.0.0");
        expect(result).toBe("a".repeat(64));
    });
});

// ── verifyBundleHash ─────────────────────────────────────────────────────────

describe("verifyBundleHash", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "verify-hash-test-"));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("passes when hash matches", async () => {
        const content = Buffer.from("test zip content");
        const zipPath = path.join(tempDir, "test.zip");
        await writeFile(zipPath, content);

        const expectedHash = createHash("sha256").update(content).digest("hex");

        // Should not throw
        await verifyBundleHash(zipPath, expectedHash);
    });

    it("throws IntegrityError when hash does not match", async () => {
        const content = Buffer.from("test zip content");
        const zipPath = path.join(tempDir, "test.zip");
        await writeFile(zipPath, content);

        const wrongHash = "b".repeat(64);

        await expect(verifyBundleHash(zipPath, wrongHash)).rejects.toThrow(IntegrityError);
    });

    it("error message includes both expected and actual hashes", async () => {
        const content = Buffer.from("test zip content");
        const zipPath = path.join(tempDir, "test.zip");
        await writeFile(zipPath, content);

        const actualHash = createHash("sha256").update(content).digest("hex");
        const wrongHash = "b".repeat(64);

        try {
            await verifyBundleHash(zipPath, wrongHash);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(IntegrityError);
            const integrityError = error as IntegrityError;
            expect(integrityError.expected).toBe(wrongHash);
            expect(integrityError.actual).toBe(actualHash);
            expect(integrityError.message).toContain(wrongHash);
            expect(integrityError.message).toContain(actualHash);
        }
    });
});

// ── downloadBundle ────────────────────────────────────────────────────────────

describe("downloadBundle", () => {
    const originalFetch = globalThis.fetch;
    let tempDir: string;

    // Minimal valid index
    const mockIndex: AgentsIndex = {
        lastUpdated: "2026-01-01T00:00:00",
        agents: [
            { version: "1.0.0", published: "2026-01-01T00:00:00" },
            { version: "2.0.0", published: "2026-02-01T00:00:00" },
        ],
    };

    // Stable fake zip content used across tests
    const fakeZipContent = Buffer.from("fake zip bytes");
    const fakeZipHash = createHash("sha256").update(fakeZipContent).digest("hex");

    beforeEach(async () => {
        globalThis.fetch = originalFetch;
        tempDir = await mkdtemp(path.join(os.tmpdir(), "download-bundle-test-"));
        mockTempDir = tempDir;
    });

    afterEach(async () => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
        await rm(tempDir, { recursive: true, force: true });
    });

    /**
     * Build a fetch mock that handles:
     *   - GET /agents/index.json  → mockIndex
     *   - GET /agents/<version>/bundle.zip  → fakeZipContent
     *   - GET /agents/<version>/bundle.zip.sha256  → hashResponse
     */
    function makeFetchMock(version: string, hashResponse: { status: number; body?: string }) {
        return vi.fn().mockImplementation((url: string) => {
            if (url.endsWith("/agents/index.json")) {
                return Promise.resolve({ ok: true, json: async () => mockIndex });
            }
            if (url.endsWith("/bundle.zip")) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    arrayBuffer: async () =>
                        fakeZipContent.buffer.slice(
                            fakeZipContent.byteOffset,
                            fakeZipContent.byteOffset + fakeZipContent.byteLength,
                        ),
                });
            }
            if (url.endsWith("/bundle.zip.sha256")) {
                if (hashResponse.status === 404) {
                    return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
                }
                if (hashResponse.status === 403) {
                    return Promise.resolve({ ok: false, status: 403, statusText: "Forbidden" });
                }
                if (hashResponse.status === 500) {
                    return Promise.resolve({ ok: false, status: 500, statusText: "Internal Server Error" });
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    text: async () => hashResponse.body ?? `${fakeZipHash}  ${version}.zip\n`,
                });
            }
            return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
        });
    }

    it("returns zipPath, version and sha256 when hash sidecar matches", async () => {
        globalThis.fetch = makeFetchMock("2.0.0", { status: 200 });

        const result = await downloadBundle("https://example.com");

        expect(result.version).toBe("2.0.0");
        expect(result.sha256).toBe(fakeZipHash);
        expect(result.zipPath).toContain("2.0.0.zip");
    });

    it("resolves the latest version from index when no version is specified", async () => {
        globalThis.fetch = makeFetchMock("2.0.0", { status: 200 });

        const result = await downloadBundle("https://example.com");

        // latest entry in mockIndex is 2.0.0
        expect(result.version).toBe("2.0.0");
        expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/agents/index.json", undefined);
    });

    it("uses the specified version and skips the index fetch", async () => {
        globalThis.fetch = makeFetchMock("1.0.0", { status: 200 });

        const result = await downloadBundle("https://example.com", "1.0.0");

        expect(result.version).toBe("1.0.0");
        // index.json must NOT have been fetched
        const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
        expect(calls).not.toContain("https://example.com/agents/index.json");
    });

    it("writes the zip to disk and it is readable", async () => {
        globalThis.fetch = makeFetchMock("2.0.0", { status: 200 });

        const result = await downloadBundle("https://example.com");

        const written = await readFile(result.zipPath);
        expect(written).toEqual(fakeZipContent);
    });

    it("returns sha256: null and keeps the zip when no hash sidecar exists (404)", async () => {
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        globalThis.fetch = makeFetchMock("2.0.0", { status: 404 });

        const result = await downloadBundle("https://example.com");

        expect(result.sha256).toBeNull();
        // zip must still exist on disk
        await expect(access(result.zipPath)).resolves.toBeUndefined();
        // warning must have been logged
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Hash file unavailable for version 2.0.0"));
    });

    it("returns sha256: null and keeps the zip when hash sidecar is forbidden (403)", async () => {
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        globalThis.fetch = makeFetchMock("2.0.0", { status: 403 });

        const result = await downloadBundle("https://example.com");

        expect(result.sha256).toBeNull();
        // zip must still exist on disk
        await expect(access(result.zipPath)).resolves.toBeUndefined();
        // warning must have been logged
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Hash file unavailable for version 2.0.0"));
    });

    it("deletes the zip and throws IntegrityError when hash does not match", async () => {
        const wrongHash = "c".repeat(64);
        globalThis.fetch = makeFetchMock("2.0.0", {
            status: 200,
            body: `${wrongHash}  2.0.0.zip\n`,
        });

        let caughtZipPath: string | undefined;
        try {
            await downloadBundle("https://example.com");
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(IntegrityError);
            const ie = error as IntegrityError;
            expect(ie.expected).toBe(wrongHash);
            expect(ie.actual).toBe(fakeZipHash);
            // Capture zipPath from the error context via a fresh call that returns the path
            // We can infer the zip path from tempDir
            caughtZipPath = path.join(tempDir, "2.0.0.zip");
        }

        // The corrupt zip must have been deleted
        await expect(access(caughtZipPath!)).rejects.toThrow();
    });

    it("rethrows non-integrity errors from fetchBundleHash and keeps the zip", async () => {
        globalThis.fetch = makeFetchMock("2.0.0", { status: 500 });

        await expect(downloadBundle("https://example.com")).rejects.toThrow(
            "Failed to fetch hash sidecar: 500 Internal Server Error",
        );

        // The zip should still be on disk (only IntegrityError triggers deletion)
        const zipPath = path.join(tempDir, "2.0.0.zip");
        await expect(access(zipPath)).resolves.toBeUndefined();
    });

    it("throws when the bundle HTTP request fails", async () => {
        globalThis.fetch = vi.fn().mockImplementation((url: string) => {
            if (url.endsWith("/agents/index.json")) {
                return Promise.resolve({ ok: true, json: async () => mockIndex });
            }
            return Promise.resolve({ ok: false, status: 403, statusText: "Forbidden" });
        });

        await expect(downloadBundle("https://example.com")).rejects.toThrow("Failed to download bundle: 403 Forbidden");
    });
});
