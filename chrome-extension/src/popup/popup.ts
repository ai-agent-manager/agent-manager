import type {
  AgentSummary,
  AgentDetail,
  ProvisionProgress,
  ProvisionResult,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_BASE = 'http://127.0.0.1:19876';
const STORAGE_KEY_TOKEN = 'agentman_token';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const screenConnect = document.getElementById('screen-connect')!;
const screenAgents = document.getElementById('screen-agents')!;
const screenProvisioning = document.getElementById('screen-provisioning')!;
const screenResult = document.getElementById('screen-result')!;

const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const connectError = document.getElementById('connect-error')!;

const btnDisconnect = document.getElementById('btn-disconnect') as HTMLButtonElement;
const bundleInfo = document.getElementById('bundle-info')!;
const agentList = document.getElementById('agent-list')!;
const noStudioTab = document.getElementById('no-studio-tab')!;

const provisioningAgentName = document.getElementById('provisioning-agent-name')!;
const progressFill = document.getElementById('progress-fill')!;
const progressMessage = document.getElementById('progress-message')!;
const progressStep = document.getElementById('progress-step')!;

const resultSuccess = document.getElementById('result-success')!;
const resultError = document.getElementById('result-error')!;
const resultSuccessName = document.getElementById('result-success-name')!;
const resultErrorMessage = document.getElementById('result-error-message')!;
const btnBackToAgents = document.getElementById('btn-back-to-agents') as HTMLButtonElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentToken = '';
let agents: AgentSummary[] = [];

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------

function showScreen(screen: HTMLElement): void {
  [screenConnect, screenAgents, screenProvisioning, screenResult].forEach(
    (s) => s.classList.add('hidden')
  );
  screen.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Server communication
// ---------------------------------------------------------------------------

async function serverFetch(path: string, token: string): Promise<Response> {
  return fetch(`${SERVER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_BASE}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function fetchAgents(token: string): Promise<AgentSummary[]> {
  const res = await serverFetch('/agents', token);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid token');
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

async function fetchAgentDetail(token: string, dirName: string): Promise<AgentDetail> {
  const res = await serverFetch(`/agents/${encodeURIComponent(dirName)}`, token);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid token');
    if (res.status === 404) throw new Error(`Agent '${dirName}' not found`);
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

async function fetchBundleInfo(token: string): Promise<{ version: string; published: string }> {
  const res = await serverFetch('/bundle/info', token);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Find an Atlassian Studio tab
// ---------------------------------------------------------------------------

/**
 * Pick the Studio tab to provision into.
 *
 * Strategy (most specific → fallback):
 *   1. The currently-active tab in the currently-focused window, if it's
 *      a Studio tab. This is what the user sees when they click the
 *      extension icon, so it's almost always what they mean.
 *   2. Any active Studio tab in any window.
 *   3. The first Studio tab anywhere.
 *
 * Without step (1), Chrome's `chrome.tabs.query({url: ...})` returns
 * tabs in an unspecified order across all windows. With multiple Studio
 * tabs open (e.g. different workspaces, or a leftover tab on the
 * "Getting started" page) the popup would silently send the provision
 * request to the wrong tab and the content script would time out
 * looking for elements that don't exist in its DOM.
 */
async function findStudioTab(): Promise<chrome.tabs.Tab | null> {
  const STUDIO_URL = 'https://studio.atlassian.com/*';

  const activeInFocusedWindow = await chrome.tabs.query({
    url: STUDIO_URL,
    active: true,
    currentWindow: true,
  });
  if (activeInFocusedWindow.length > 0) return activeInFocusedWindow[0];

  const activeAnywhere = await chrome.tabs.query({
    url: STUDIO_URL,
    active: true,
  });
  if (activeAnywhere.length > 0) return activeAnywhere[0];

  const anyStudioTab = await chrome.tabs.query({ url: STUDIO_URL });
  return anyStudioTab.length > 0 ? anyStudioTab[0] : null;
}

// ---------------------------------------------------------------------------
// Connect flow
// ---------------------------------------------------------------------------

async function connect(): Promise<void> {
  const token = tokenInput.value.trim();
  if (!token) {
    showError(connectError, 'Please enter a token.');
    return;
  }

  btnConnect.disabled = true;
  connectError.classList.add('hidden');

  try {
    // First check if server is reachable
    const healthy = await checkHealth();
    if (!healthy) {
      showError(connectError, 'Cannot reach agentman server. Is it running?');
      btnConnect.disabled = false;
      return;
    }

    // Validate token by fetching agents
    agents = await fetchAgents(token);
    currentToken = token;

    // Save token for session persistence
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token });

    // Fetch bundle info
    try {
      const info = await fetchBundleInfo(token);
      bundleInfo.textContent = `Bundle: ${info.version.slice(0, 7)} (${info.published.slice(0, 10)}) — ${agents.length} agent${agents.length !== 1 ? 's' : ''}`;
    } catch {
      bundleInfo.textContent = `${agents.length} agent${agents.length !== 1 ? 's' : ''} available`;
    }

    renderAgentList();
    showScreen(screenAgents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    showError(connectError, msg);
    btnConnect.disabled = false;
  }
}

function disconnect(): void {
  currentToken = '';
  agents = [];
  chrome.storage.local.remove(STORAGE_KEY_TOKEN);
  tokenInput.value = '';
  btnConnect.disabled = false;
  showScreen(screenConnect);
}

// ---------------------------------------------------------------------------
// Agent list
// ---------------------------------------------------------------------------

function renderAgentList(): void {
  agentList.innerHTML = '';

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = 'agent-card';

    const avatar = document.createElement('div');
    avatar.className = 'agent-avatar';
    avatar.textContent = agent.avatar ?? '\uD83E\uDD16';

    const info = document.createElement('div');
    info.className = 'agent-info';

    const name = document.createElement('div');
    name.className = 'agent-name';
    name.textContent = agent.name;

    const desc = document.createElement('div');
    desc.className = 'agent-description';
    desc.textContent = agent.description;

    info.appendChild(name);
    info.appendChild(desc);

    const action = document.createElement('div');
    action.className = 'agent-action';

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-small';
    btn.textContent = 'Provision';
    btn.addEventListener('click', () => provisionAgent(agent));
    action.appendChild(btn);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(action);
    agentList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Provisioning flow
// ---------------------------------------------------------------------------

async function provisionAgent(agent: AgentSummary): Promise<void> {
  // Check for a Studio tab
  const studioTab = await findStudioTab();
  if (!studioTab || !studioTab.id) {
    noStudioTab.classList.remove('hidden');
    // Auto-hide after 5 seconds
    setTimeout(() => noStudioTab.classList.add('hidden'), 5000);
    return;
  }

  noStudioTab.classList.add('hidden');

  // Show provisioning screen
  provisioningAgentName.textContent = agent.name;
  progressFill.style.width = '0%';
  progressMessage.textContent = 'Fetching agent configuration...';
  progressStep.textContent = '';
  showScreen(screenProvisioning);

  try {
    // Fetch full agent config
    const detail = await fetchAgentDetail(currentToken, agent.dirName);

    progressMessage.textContent = 'Starting provisioning...';

    // Ensure the content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: studioTab.id },
        files: ['content/content.js'],
      });
    } catch {
      // Content script may already be injected via manifest — that's fine
    }

    // Brief delay for content script to initialise
    await sleep(500);

    // Listen for progress updates from the content script
    const progressListener = (
      message: ProvisionProgress,
      sender: chrome.runtime.MessageSender
    ) => {
      if (message.type === 'progress' && sender.tab?.id === studioTab.id) {
        const pct = Math.round((message.step / message.total) * 100);
        progressFill.style.width = `${pct}%`;
        progressMessage.textContent = message.message;
        progressStep.textContent = `Step ${message.step} of ${message.total}`;
      }
    };

    chrome.runtime.onMessage.addListener(progressListener);

    // Send provision request to content script
    const result = await new Promise<ProvisionResult>((resolve) => {
      chrome.tabs.sendMessage(
        studioTab.id!,
        { action: 'provision', config: detail.config },
        (response: ProvisionResult) => {
          resolve(response ?? { success: false, error: 'No response from content script' });
        }
      );
    });

    chrome.runtime.onMessage.removeListener(progressListener);

    // If provisioning failed, enrich the error with the URL the popup
    // actually targeted. With multiple Studio tabs open it's easy to
    // accidentally send the request to the wrong tab, in which case the
    // content script times out looking for buttons that don't exist in
    // its DOM. Surfacing the tab URL makes that obvious.
    const finalResult: ProvisionResult = !result.success && result.error
      ? {
          success: false,
          error: `${result.error}\n\nTarget tab: ${studioTab.url ?? '(unknown URL)'}`,
        }
      : result;

    // Show result
    showResult(finalResult, agent.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Provisioning failed';
    showResult({ success: false, error: msg }, agent.name);
  }
}

function showResult(result: ProvisionResult, agentName: string): void {
  showScreen(screenResult);

  if (result.success) {
    resultSuccess.classList.remove('hidden');
    resultError.classList.add('hidden');
    resultSuccessName.textContent = `"${agentName}" has been created in Atlassian Studio.`;
  } else {
    resultSuccess.classList.add('hidden');
    resultError.classList.remove('hidden');
    resultErrorMessage.textContent = result.error ?? 'Unknown error';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.classList.remove('hidden');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnConnect.addEventListener('click', connect);
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect();
});
btnDisconnect.addEventListener('click', disconnect);
btnBackToAgents.addEventListener('click', () => {
  showScreen(screenAgents);
});

// ---------------------------------------------------------------------------
// Initialise — try to reconnect with saved token
// ---------------------------------------------------------------------------

(async () => {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_TOKEN);
    const savedToken = stored[STORAGE_KEY_TOKEN] as string | undefined;
    if (savedToken) {
      tokenInput.value = savedToken;
      await connect();
    }
  } catch {
    // No saved token or connection failed — stay on connect screen
  }
})();
