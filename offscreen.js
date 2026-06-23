// offscreen.js
// Service workers have no DOM, so they can't call navigator.clipboard.
// This hidden offscreen document polls the clipboard instead and reports
// changes back to background.js. This is what catches copies that don't
// fire a page 'copy' event — e.g. the address bar, or other apps.

let lastSeen = '';

async function pollClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim() && text !== lastSeen) {
      lastSeen = text;
      chrome.runtime.sendMessage({
        type: 'RECALL_CLIPBOARD_POLL',
        payload: { content: text },
      }).catch(() => {});
    }
  } catch (e) {
    // Clipboard empty, non-text (e.g. an image), or transiently unreadable.
  }
}

setInterval(pollClipboard, 1500);
pollClipboard();
