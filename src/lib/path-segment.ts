/**
 * Guard for values interpolated into cache paths.
 *
 * Lives outside both the downloader and the extractor because both need it and
 * the extractor also needs the downloader's URL canonicalisation — keeping it
 * here is what stops those two importing each other.
 */
export function assertSafeCacheSegment(value: string, label: string): void {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be a safe single path segment: ${value}`);
  }
}
