# Programmatic Chrome Extension Installation

Agent Manager can install the Agentman Chrome extension directly into Google Chrome - no developer mode, no manual drag-and-drop.

From the main menu, select **Install Chrome Extension**. The CLI handles the rest and tells you what to do next.

## How it works

Chrome supports an [External Extensions](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions#external_registry) mechanism: a small JSON file placed in a well-known directory tells Chrome to load a `.crx` file on next launch. Chrome reads this directory on every start and, if it finds a new entry, prompts the user once to approve the extension.

Agent Manager automates that process:

1. Copies the bundled `agentman.crx` to `~/.agentman/chrome-extension/agentman.crx`
2. Writes the registration JSON to the platform-specific External Extensions directory
3. Tells you to restart Chrome

## Platform support

| Platform | What happens |
|---|---|
| macOS | Fully automatic - JSON file written to `~/Library/Application Support/Google/Chrome/External Extensions/` |
| Linux | Fully automatic - JSON file written to `~/.config/google-chrome/External Extensions/` |
| Windows | The `.crx` is copied; manual registry steps are printed |

### Windows manual steps

Chrome on Windows uses the registry instead of a directory. After running the installer, follow the printed instructions:

1. Open Registry Editor (`regedit`)
2. Navigate to `HKEY_LOCAL_MACHINE\SOFTWARE\Google\Chrome\Extensions`
3. Create a key named `jfplibfgoojmkffdcglchjdkpliiljbh`
4. Add two string values:
   - `path` -> the `.crx` path shown in the output (for example, `C:\Users\you\.agentman\chrome-extension\agentman.crx`)
   - `version` -> `0.1.0`
5. Restart Chrome

## After installation

Once Chrome restarts, a notification appears at the top of the browser:

> **"Agentman - Rovo Agent Provisioner" has been added to Chrome**

Click **Add extension** to confirm. The extension icon (a robot) will appear in your toolbar.

If Chrome does not prompt you, open `chrome://extensions` to check whether the extension is listed. If it is listed but disabled, click **Enable**.

## The extension ID

The extension has a fixed, stable ID: `jfplibfgoojmkffdcglchjdkpliiljbh`

This ID is derived from the public key embedded in the extension's `manifest.json`. It does not change between versions or installation methods - which means Chrome recognises it as the same extension whether it was loaded unpacked during development or installed via this mechanism.

## The `.crx` file

The pre-built `agentman.crx` is included in the `@ai-agent-manager/cli` npm package under `assets/`. It is signed with a private RSA key (`agentman.pem`) that is gitignored. The CI pipeline regenerates the `.crx` at publish time using the `AGENTMAN_CRX_KEY` secret (base64-encoded PEM).

To rebuild the `.crx` locally:

```bash
cd chrome-extension
npm run build:crx
```

See [chrome-extension/README.md](../chrome-extension/README.md) for full build details.

## Relevant source files

| File | Role |
|---|---|
| `src/lib/chrome-extension-installer.ts` | Core installer - copies `.crx`, writes registration JSON, returns platform-specific result |
| `src/components/ChromeExtensionInstall.tsx` | TUI screen - spinner, success/manual/error states |
| `chrome-extension/build-crx.mjs` | Packs `dist/` into a signed `.crx` using the `crx` npm package |
| `chrome-extension/manifest.json` | Extension manifest - `key` field fixes the extension ID |
| `assets/agentman.crx` | Pre-built `.crx` bundled with the npm package (gitignored, generated at publish time) |