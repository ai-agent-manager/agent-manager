/**
 * Content script for the Agentman Chrome Extension.
 *
 * Injected into studio.atlassian.com pages. Listens for messages from
 * the popup and performs DOM automation to provision Rovo agents.
 */

import { provisionAgent } from '../lib/provisioner.js';
import type {
  ContentMessage,
  ProvisionResult,
  PingResponse,
} from '../lib/types.js';

// Prevent double-injection
if (!(window as any).__agentmanContentScriptLoaded) {
  (window as any).__agentmanContentScriptLoaded = true;

  chrome.runtime.onMessage.addListener(
    (
      message: ContentMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: ProvisionResult | PingResponse) => void
    ) => {
      if (message.action === 'ping') {
        sendResponse({ ready: true });
        return false;
      }

      if (message.action === 'provision') {
        // Run provisioning asynchronously
        (async () => {
          try {
            await provisionAgent(message.config, (msg, step, total) => {
              // Send progress updates back to the popup via the background
              chrome.runtime.sendMessage({
                type: 'progress',
                step,
                total,
                message: msg,
              });
            });
            sendResponse({ success: true });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, error: errorMsg });
          }
        })();

        // Return true to indicate we'll send the response asynchronously
        return true;
      }

      return false;
    }
  );
}
