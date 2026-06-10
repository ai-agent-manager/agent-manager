/**
 * Packs the built dist/ directory into a signed .crx file.
 *
 * Requires:
 *   - dist/ to already exist (run `npm run build` first)
 *   - AGENTMAN_CRX_KEY env var set to the base64-encoded PEM private key,
 *     OR agentman.pem present in this directory (local dev)
 *
 * Outputs: dist/agentman.crx
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import CRX from "crx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "dist");
const outputPath = resolve(distDir, "agentman.crx");

// Resolve private key: env var (base64-encoded PEM) or local file
let privateKey;
if (process.env.AGENTMAN_CRX_KEY) {
  privateKey = Buffer.from(process.env.AGENTMAN_CRX_KEY, "base64").toString("utf8");
  console.log("Using private key from AGENTMAN_CRX_KEY env var");
} else {
  const pemPath = resolve(__dirname, "agentman.pem");
  if (!existsSync(pemPath)) {
    console.error(
      "Error: no private key found.\n" +
        "Set AGENTMAN_CRX_KEY env var (base64-encoded PEM), or place agentman.pem in chrome-extension/.",
    );
    process.exit(1);
  }
  privateKey = readFileSync(pemPath, "utf8");
  console.log("Using private key from agentman.pem");
}

if (!existsSync(distDir)) {
  console.error("Error: dist/ directory not found. Run `npm run build` first.");
  process.exit(1);
}

const crx = new CRX({
  codebase: "agentman.crx",
  rootDirectory: distDir,
  privateKey,
});

await crx.load();
const crxBuffer = await crx.pack();
writeFileSync(outputPath, crxBuffer);

const sizeKb = Math.round(crxBuffer.length / 1024);
console.log(`\nPacked ${sizeKb} KB -> dist/agentman.crx`);
