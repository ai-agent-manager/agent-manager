import { contextBridge, ipcRenderer } from 'electron';
// This compiles to standalone CommonJS: sandboxed Electron preloads cannot load ESM.
const value = (name: string) => process.argv.filter((arg) => arg.startsWith(`--${name}=`)).at(-1)?.split('=').slice(1).join('=');
if (process.isMainFrame && location.origin === value('agentman-origin')) {
  contextBridge.exposeInMainWorld('agentmanDesktop', Object.freeze({
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('agentman:pick-directory'),
    version: value('agentman-version') ?? '',
  }));
}
