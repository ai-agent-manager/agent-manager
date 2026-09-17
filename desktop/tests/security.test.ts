import { expect, it, vi } from 'vitest';
import { externalDestination, localNavigation, trustedPickerSender } from '../src/security.js';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

const origin = 'http://127.0.0.1:12345';
const auth = 'https://auth.example.com/authorize?state=test-state&code_challenge=test-challenge';
it('allows only exact active authorization URLs or individually approved documentation', () => {
  const active = vi.fn((url: string) => url === auth);
  expect(externalDestination(auth, active)).toBe(auth);
  for (const url of ['file:///example/private', 'javascript:alert(1)', 'data:text/html,test', 'agentman:run',
    'https://auth.example.com/authorize?state=forged', `${auth}&extra=1`, `${auth}#fragment`,
    'https://evil.example.com', 'https://user:secret@auth.example.com/authorize',
    'https://github.com/ai-agent-manager/agent-manager?redirect=bad', 'https://github.com.evil.example.com/ai-agent-manager/agent-manager']) {
    expect(externalDestination(url, active), url).toBeUndefined();
  }
  expect(externalDestination(auth, () => false)).toBeUndefined();
  expect(externalDestination('https://github.com/ai-agent-manager/agent-manager', () => false)).toBeDefined();
});
it('requires an explicit development opt-in for a live loopback HTTP prompt', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `http://${host}:8080/authorize?state=test`;
    expect(externalDestination(url, () => true)).toBeUndefined();
    expect(externalDestination(url, () => true, true)).toBe(url);
    expect(externalDestination(url, () => false, true)).toBeUndefined();
  }
  expect(externalDestination('http://auth.example.com/authorize', () => true, true)).toBeUndefined();
});
it('confines navigation to the exact local origin', () => {
  expect(localNavigation(`${origin}/#/installed`, origin)).toBe(true);
  for (const url of ['https://example.com', 'file:///example', 'javascript:alert(1)', 'about:blank',
    'http://localhost:12345/', 'http://127.0.0.1:12346/', 'http://user@127.0.0.1:12345/']) expect(localNavigation(url, origin), url).toBe(false);
});
it('accepts directory IPC only from the live expected main frame without arguments', () => {
  const frame = { url: `${origin}/#/` }, contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  expect(trustedPickerSender(event, window, origin, [])).toBe(true);
  expect(trustedPickerSender(event, window, origin, [{ path: '/example' }])).toBe(false);
  expect(trustedPickerSender({ ...event, senderFrame: { ...frame } } as IpcMainInvokeEvent, window, origin, [])).toBe(false);
  expect(trustedPickerSender({ ...event, sender: {} } as IpcMainInvokeEvent, window, origin, [])).toBe(false);
  frame.url = 'https://evil.example.com';
  expect(trustedPickerSender(event, window, origin, [])).toBe(false);
  frame.url = origin;
  expect(trustedPickerSender(event, { ...window, isDestroyed: () => true } as BrowserWindow, origin, [])).toBe(false);
});
