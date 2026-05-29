/**
 * Background service worker for the Agentman Chrome Extension.
 *
 * Currently minimal — its main role is to relay messages between the popup
 * and content scripts if needed, and to handle extension lifecycle events.
 *
 * The popup communicates directly with the content script via
 * chrome.tabs.sendMessage, so the service worker doesn't need to do much
 * message routing. It's included for future extensibility (e.g. showing
 * badge counts, handling notifications).
 */

// Forward progress messages from content script to the popup.
// The popup registers its own listener, but if the popup is closed
// mid-provisioning, this ensures we don't lose state.
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'progress') {
    // Could update badge, store progress, etc.
    // For now, just let the message propagate to any listeners.
  }
  return false;
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[agentman] Extension installed');
  } else if (details.reason === 'update') {
    console.log(`[agentman] Extension updated to ${chrome.runtime.getManifest().version}`);
  }
});
