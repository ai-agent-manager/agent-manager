import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHomeDir, getPlatform } from "./platform.js";

export const EXTENSION_ID = "jfplibfgoojmkffdcglchjdkpliiljbh";
export const EXTENSION_VERSION = "0.1.0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CRX_ASSET_PATH = path.resolve(__dirname, "../../assets/agentman.crx");

export type InstallResult =
  | { status: "installed"; crxPath: string; jsonPath: string }
  | { status: "manual-required"; instructions: string[] }
  | { status: "error"; message: string };

export function getExternalExtensionsDir(): string | null {
  const platform = getPlatform();
  const home = getHomeDir();

  switch (platform) {
    case "macos":
      return path.join(home, "Library", "Application Support", "Google", "Chrome", "External Extensions");
    case "linux":
      return path.join(home, ".config", "google-chrome", "External Extensions");
    case "windows":
      return null;
  }
}

export function getCrxDestPath(): string {
  return path.join(getHomeDir(), ".agentman", "chrome-extension", "agentman.crx");
}

export async function installChromeExtension(crxSourcePath: string = CRX_ASSET_PATH): Promise<InstallResult> {
  try {
    if (!existsSync(crxSourcePath)) {
      return {
        status: "error",
        message: `Chrome extension .crx not found at: ${crxSourcePath}`,
      };
    }

    const crxDest = getCrxDestPath();
    await mkdir(path.dirname(crxDest), { recursive: true });
    await copyFile(crxSourcePath, crxDest);

    const externalExtensionsDir = getExternalExtensionsDir();

    if (externalExtensionsDir === null) {
      return {
        status: "manual-required",
        instructions: buildWindowsInstructions(crxDest),
      };
    }

    await mkdir(externalExtensionsDir, { recursive: true });

    const jsonPath = path.join(externalExtensionsDir, `${EXTENSION_ID}.json`);
    const payload = {
      external_crx: crxDest,
      external_version: EXTENSION_VERSION,
    };

    await writeFile(jsonPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

    return {
      status: "installed",
      crxPath: crxDest,
      jsonPath,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildWindowsInstructions(crxPath: string): string[] {
  return [
    "Automatic installation is not supported on Windows.",
    "To install the Agentman Chrome extension manually:",
    "",
    "  Option A - Load unpacked (developer mode):",
    "    1. Open Chrome and go to chrome://extensions",
    '    2. Enable "Developer mode" (top-right toggle)',
    '    3. Click "Load unpacked" and select the extension directory',
    "",
    "  Option B - External Extensions via registry:",
    "    1. Open Registry Editor (regedit)",
    "    2. Navigate to: HKEY_LOCAL_MACHINE\\SOFTWARE\\Google\\Chrome\\Extensions",
    `    3. Create a key named: ${EXTENSION_ID}`,
    `    4. Add string value  path    ->  ${crxPath}`,
    `    5. Add string value  version ->  ${EXTENSION_VERSION}`,
    "    6. Restart Chrome",
  ];
}
