/**
 * Windows-native ZIP extraction using PowerShell's Expand-Archive.
 * This is MUCH faster on Windows because PowerShell is a trusted Microsoft component,
 * and Windows Defender doesn't scan files extracted by PowerShell as aggressively.
 *
 * Falls back to streaming extraction on non-Windows platforms.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { extractZipStreaming } from './fast-extract.js';

const execAsync = promisify(exec);

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
      // Suppress progress output with $ProgressPreference
      const psCommand = `$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force`;
      await execAsync(`powershell.exe -NoProfile -Command "${psCommand}"`, {
        maxBuffer: 50 * 1024 * 1024, // 50 MB buffer
        timeout: 300000, // 5 minute timeout for very large archives
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
