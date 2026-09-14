/**
 * Windows-specific error handling utilities.
 * Provides actionable guidance for common Windows file system issues.
 */

/**
 * Enhance an error with Windows-specific guidance if applicable.
 * Returns the original error unchanged on non-Windows platforms.
 */
export function enhanceWindowsError(error: unknown, operation: string): Error {
  if (process.platform !== 'win32') {
    return error instanceof Error ? error : new Error(String(error));
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException)?.code;
  let enhancedMessage = message;

  if (code === 'EPERM' || code === 'EACCES' || message.includes('EPERM') || message.includes('EACCES')) {
    enhancedMessage = `${message}

Windows permission error detected during ${operation}. Try:
  1. Run terminal as Administrator
  2. Temporarily disable antivirus software
  3. Check if another process is using the file
  4. Ensure you have write permissions to the target directory`;
  } else if (code === 'EXDEV' || message.includes('EXDEV')) {
    enhancedMessage = `${message}

Cross-drive operation detected during ${operation}. Your temp directory and home directory
appear to be on different drives. Try:
  1. Set TEMP and TMP environment variables to same drive as home:
     set TEMP=%USERPROFILE%\\AppData\\Local\\Temp
     set TMP=%USERPROFILE%\\AppData\\Local\\Temp
  2. Or move your home directory to the same drive as temp`;
  } else if (code === 'ENOENT' && message.includes('spawn')) {
    enhancedMessage = `${message}

Windows executable not found during ${operation}. This may indicate:
  1. A required tool is not installed or not in PATH
  2. The command name needs a .exe extension on Windows`;
  }

  const enhancedError = new Error(enhancedMessage);
  enhancedError.cause = error;
  return enhancedError;
}
