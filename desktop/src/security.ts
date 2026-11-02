import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

// Add documentation destinations individually after review. No host wildcards.
export const DOCUMENTATION_URLS: ReadonlySet<string> = new Set([
  'https://github.com/ai-agent-manager/agent-manager',
  'https://github.com/ai-agent-manager/agent-manager/blob/main/docs/web-ui.md',
]);
export function localNavigation(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}
export function externalDestination(value: string, activeAuthorization: (url: string) => boolean, allowLoopbackAuth = false): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return undefined;
    const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(allowLoopbackAuth && loopback)) return undefined;
    if (activeAuthorization(url.href)) return url.href;
    if (url.protocol === 'https:' && DOCUMENTATION_URLS.has(url.href)) return url.href;
  } catch { /* Untrusted destinations are denied. */ }
  return undefined;
}
export function trustedPickerSender(event: IpcMainInvokeEvent, window: BrowserWindow, origin: string, args: unknown[]): boolean {
  return args.length === 0 && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && !!event.senderFrame
    && localNavigation(event.senderFrame.url, origin);
}
