/**
 * Windows-native ZIP extraction using PowerShell's Expand-Archive.
 * This is MUCH faster on Windows because PowerShell is a trusted Microsoft component,
 * and Windows Defender doesn't scan files extracted by PowerShell as aggressively.
 *
 * Falls back to streaming extraction on non-Windows platforms.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { extractZipStreaming } from './fast-extract.js';

const execFileAsync = promisify(execFile);

/**
 * Extract ZIP using the fastest method for the current platform.
 * On Windows: Use PowerShell Expand-Archive (trusted by Defender)
 * On Mac/Linux: Use streaming extraction
 */
export async function extractZipFast(zipPath: string, targetDir: string): Promise<void> {
  // Ensure target directory exists
  await mkdir(targetDir, { recursive: true });

  if (process.platform === 'win32') {
    // On Windows, use PowerShell's native extraction
    // This is trusted by Windows Defender and scans much faster
    try {
      // Use -EncodedCommand to prevent command injection.
      // Paths are passed via environment variables, which PowerShell reads
      // as literal strings without any script interpretation.
      const psScript = `
        $ProgressPreference = 'SilentlyContinue'
        Expand-Archive -LiteralPath $env:AGENTMAN_ZIP_PATH -DestinationPath $env:AGENTMAN_TARGET_DIR -Force
      `.trim();

      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from(psScript, 'utf16le').toString('base64')
      ], {
        maxBuffer: 50 * 1024 * 1024, // 50 MB buffer
        timeout: 300000, // 5 minute timeout for very large archives
        env: {
          ...process.env,
          AGENTMAN_ZIP_PATH: zipPath,
          AGENTMAN_TARGET_DIR: targetDir
        }
      });
      return;
    } catch {
      // If PowerShell fails, fall back to streaming
      return extractZipStreaming(zipPath, targetDir);
    }
  } else {
    // On Mac/Linux, use streaming extraction
    return extractZipStreaming(zipPath, targetDir);
  }
}
