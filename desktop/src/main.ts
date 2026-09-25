import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { startUiServer } from '@ai-agent-manager/cli/ui-server';
import { externalDestination, localNavigation, trustedPickerSender } from './security.js';
import { shutdownOnce } from './lifecycle.js';

// Disable Chromium's telemetry-independent disk session persistence for the UI.
let window: BrowserWindow | undefined;
let quitting = false;
let closing = false;
let exitCode = 0;
let shutdown: (() => Promise<void>) | undefined;
const focus = () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };
function finishQuit() { quitting = true; if (exitCode) app.exit(exitCode); else app.quit(); }
function markClosing() {
  closing = true;
  if (window && !window.isDestroyed()) window.setTitle('Agent Manager — finishing operations…');
}

// Electron defaults app.name (and therefore the macOS menu bar, Dock tooltip, Cmd+Tab
// switcher, and any dialog left without an explicit title) to "Electron" until the app
// is packaged. Set it explicitly so dev runs (`electron .`) also read "Agent Manager".
app.setName('Agent Manager');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', focus); // Never interpret a second launch's URLs/arguments.
  app.on('activate', focus);
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (shutdown) void shutdown().catch(reportShutdown);
  });
  app.on('window-all-closed', () => { if (!quitting && shutdown) void shutdown().catch(reportShutdown); });
  void launch().catch(async (error) => {
    exitCode = 1;
    console.error('Agent Manager desktop startup failed:', error);
    dialog.showErrorBox('Agent Manager could not start', 'Build or reinstall the application and its web UI assets, then try again.');
    if (shutdown) { try { await shutdown(); return; } catch { /* Initialization failed; no usable window. */ } }
    finishQuit();
  });
}
function reportShutdown(error: unknown) {
  exitCode = 1;
  console.error('Agent Manager desktop shutdown failed:', error);
  dialog.showErrorBox('Agent Manager could not stop cleanly', 'An operation could not finish. Check your installations before restarting the application.');
  finishQuit();
}
async function launch() {
  // Register the drain before waiting for ready/startup.
  const started = (async () => {
    await app.whenReady();
    // Packaged builds already carry the icon in the app bundle/executable via electron-builder;
    // set it explicitly here so `electron .` dev runs also show the correct Dock/taskbar icon.
    if (!app.isPackaged) {
      const iconPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../build/icon.png');
      try {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) app.dock?.setIcon(icon);
      } catch { /* Missing dev icon is non-fatal. */ }
    }
    const cliRoot = path.dirname(fileURLToPath(import.meta.resolve('@ai-agent-manager/cli/package.json')));
    const staticDir = path.join(cliRoot, 'assets/web-ui');
    await access(path.join(staticDir, 'index.html'));
    const source = !app.isPackaged ? process.env.AGENTMAN_DESKTOP_SOURCE : undefined;
    return startUiServer({ port: 0, cwd: app.getPath('home'), staticDir, startupSource: source, onStopping: markClosing });
  })();
  const drain = shutdownOnce(started, finishQuit);
  shutdown = () => {
    markClosing();
    return drain();
  };
  const handle = await started;
  // The UI Quit action closes the HTTP server before Electron quits.
  handle.server.once('close', () => { if (!quitting) void shutdown!().catch(reportShutdown); });
  if (closing) return;
  const origin = new URL(handle.url).origin;
  const iconPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../build/icon.png');
  window = new BrowserWindow({ title: 'Agent Manager', width: 1240, height: 880, minWidth: 760, minHeight: 600, show: false,
    ...(app.isPackaged ? {} : { icon: iconPath }),
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false,
      devTools: !app.isPackaged, partition: 'agentman-ui',
      additionalArguments: [`--agentman-origin=${origin}`, `--agentman-version=${app.getVersion()}`] } });
  const current = window;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Agent Manager', submenu: [{ role: 'quit' as const }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  const contents = current.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on('will-download', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, url) => { if (!localNavigation(url, origin)) event.preventDefault(); });
  contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || !localNavigation(event.url, origin)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!localNavigation(url, origin)) event.preventDefault(); });
  // Chromium can commit about:blank without a cancellable navigation event.
  contents.on('did-navigate', (_event, url) => {
    if (!closing && !localNavigation(url, origin)) void current.loadURL(`${origin}/`).catch(reportShutdown);
  });
  current.on('page-title-updated', (event) => { if (closing) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    const destination = externalDestination(url, handle.isActiveAuthorizationUrl,
      !app.isPackaged && process.env.AGENTMAN_DESKTOP_ALLOW_LOOPBACK_AUTH === '1');
    if (destination) void shell.openExternal(destination).catch(() => {
      if (!current.isDestroyed()) void dialog.showMessageBox(current, { type: 'error', title: 'Agent Manager', message: 'Could not open the system browser. Try the sign-in link again.' });
    });
    return { action: 'deny' };
  });
  let picking = false;
  ipcMain.handle('agentman:pick-directory', async (event, ...args: unknown[]) => {
    if (!trustedPickerSender(event, current, origin, args) || picking) throw new Error('Directory request rejected.');
    picking = true;
    try {
      const result = await dialog.showOpenDialog(current, { title: 'Choose a repository', properties: ['openDirectory'] });
      if (!trustedPickerSender(event, current, origin, args)) throw new Error('Directory request rejected.');
      return result.canceled ? null : result.filePaths[0] ?? null;
    } finally { picking = false; }
  });
  current.on('close', (event) => {
    if (!quitting) { event.preventDefault(); void shutdown!().catch(reportShutdown); }
  });
  current.on('closed', () => ipcMain.removeHandler('agentman:pick-directory'));
  await current.loadURL(handle.url);
  if (!quitting && !current.isDestroyed()) current.show();
}
