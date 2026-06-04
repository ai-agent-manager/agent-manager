import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHomeDir, getPlatform } from "../../../src/lib/platform.js";
import {
  EXTENSION_ID,
  EXTENSION_VERSION,
  getCrxDestPath,
  getExternalExtensionsDir,
  installChromeExtension,
} from "../../../src/lib/chrome-extension-installer.js";

const MOCK_HOME = path.join("home", "testuser");

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../src/lib/platform.js", () => ({
  getPlatform: vi.fn(),
  getHomeDir: vi.fn(),
}));

const mockMkdir = vi.mocked(mkdir);
const mockCopyFile = vi.mocked(copyFile);
const mockWriteFile = vi.mocked(writeFile);
const mockExistsSync = vi.mocked(existsSync);
const mockGetPlatform = vi.mocked(getPlatform);
const mockGetHomeDir = vi.mocked(getHomeDir);

const FAKE_CRX_SOURCE = path.join("fake", "source", "agentman.crx");

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockGetHomeDir.mockReturnValue(MOCK_HOME);
});

describe("EXTENSION_ID", () => {
  it("is exactly 32 characters of a-p alphabet", () => {
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);
  });
});

describe("getExternalExtensionsDir", () => {
  it("returns macOS path on darwin", () => {
    mockGetPlatform.mockReturnValue("macos");

    expect(getExternalExtensionsDir()).toBe(
      path.join(MOCK_HOME, "Library", "Application Support", "Google", "Chrome", "External Extensions"),
    );
  });

  it("returns Linux path on linux", () => {
    mockGetPlatform.mockReturnValue("linux");

    expect(getExternalExtensionsDir()).toBe(path.join(MOCK_HOME, ".config", "google-chrome", "External Extensions"));
  });

  it("returns null on Windows", () => {
    mockGetPlatform.mockReturnValue("windows");

    expect(getExternalExtensionsDir()).toBeNull();
  });
});

describe("getCrxDestPath", () => {
  it("places the .crx inside ~/.agentman/chrome-extension/", () => {
    expect(getCrxDestPath()).toBe(path.join(MOCK_HOME, ".agentman", "chrome-extension", "agentman.crx"));
  });
});

describe("installChromeExtension on macOS", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("macos");
  });

  it("copies the .crx to ~/.agentman/chrome-extension/", async () => {
    await installChromeExtension(FAKE_CRX_SOURCE);

    expect(mockCopyFile).toHaveBeenCalledWith(
      FAKE_CRX_SOURCE,
      path.join(MOCK_HOME, ".agentman", "chrome-extension", "agentman.crx"),
    );
  });

  it("creates the External Extensions directory", async () => {
    await installChromeExtension(FAKE_CRX_SOURCE);

    expect(mockMkdir).toHaveBeenCalledWith(
      path.join(MOCK_HOME, "Library", "Application Support", "Google", "Chrome", "External Extensions"),
      { recursive: true },
    );
  });

  it("writes the correct JSON to <extensionId>.json", async () => {
    await installChromeExtension(FAKE_CRX_SOURCE);

    const expectedJsonPath = path.join(
      MOCK_HOME,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "External Extensions",
      `${EXTENSION_ID}.json`,
    );

    expect(mockWriteFile).toHaveBeenCalledWith(expectedJsonPath, expect.stringContaining('"external_crx"'), "utf-8");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.external_crx).toBe(path.join(MOCK_HOME, ".agentman", "chrome-extension", "agentman.crx"));
    expect(parsed.external_version).toBe(EXTENSION_VERSION);
  });

  it("returns status installed with correct paths", async () => {
    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("installed");
    if (result.status === "installed") {
      expect(result.crxPath).toBe(path.join(MOCK_HOME, ".agentman", "chrome-extension", "agentman.crx"));
      expect(result.jsonPath).toContain(EXTENSION_ID);
    }
  });
});

describe("installChromeExtension on Linux", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("linux");
  });

  it("writes the JSON to the Linux External Extensions path", async () => {
    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("installed");
    if (result.status === "installed") {
      expect(result.jsonPath).toContain(path.join(".config", "google-chrome", "External Extensions"));
    }
  });
});

describe("installChromeExtension on Windows", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("windows");
  });

  it("returns manual-required status", async () => {
    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("manual-required");
  });

  it("still copies the .crx before returning manual instructions", async () => {
    await installChromeExtension(FAKE_CRX_SOURCE);

    expect(mockCopyFile).toHaveBeenCalled();
  });

  it("does not write any JSON file", async () => {
    await installChromeExtension(FAKE_CRX_SOURCE);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("includes the extension ID in the manual instructions", async () => {
    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    if (result.status === "manual-required") {
      expect(result.instructions.join("\n")).toContain(EXTENSION_ID);
    }
  });
});

describe("installChromeExtension error handling", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("macos");
  });

  it("returns error status when .crx source file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain(FAKE_CRX_SOURCE);
    }
  });

  it("returns error status when mkdir throws", async () => {
    mockMkdir.mockRejectedValueOnce(new Error("Permission denied"));

    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toBe("Permission denied");
    }
  });

  it("returns error status when writeFile throws", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("Disk full"));

    const result = await installChromeExtension(FAKE_CRX_SOURCE);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toBe("Disk full");
    }
  });
});
