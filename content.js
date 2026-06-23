// content.js
// Listens for native copy events on the page and forwards the copied
// text (plus a little context) to the background service worker so it
// can be stored as a Recall item.

(function () {
  // Avoid double-injection on pages with multiple frames re-running this.
  if (window.__recallContentScriptLoaded) return;
  window.__recallContentScriptLoaded = true;

  function getSelectedText(event) {
    // Prefer the actual clipboard data written by the browser, since it
    // reflects exactly what the user copied (handles inputs/textareas too).
    try {
      const cd = event.clipboardData;
      if (cd) {
        const text = cd.getData('text/plain');
        if (text && text.trim().length > 0) return text;
      }
    } catch (e) {
      // clipboardData not accessible in this context — fall back below.
    }

    const selection = window.getSelection ? window.getSelection().toString() : '';
    if (selection && selection.trim().length > 0) return selection;

    // Fallback for copy events fired on <input>/<textarea> where
    // window.getSelection() may not reflect the field's selection.
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      const { selectionStart, selectionEnd, value } = active;
      if (typeof selectionStart === 'number' && selectionEnd > selectionStart) {
        return value.substring(selectionStart, selectionEnd);
      }
    }
    return '';
  }

  document.addEventListener('copy', (event) => {
    const text = getSelectedText(event);
    if (!text || !text.trim()) return;

    // Cap absurdly large copies so storage stays light.
    const MAX_LEN = 20000;
    const trimmed = text.length > MAX_LEN ? text.slice(0, MAX_LEN) : text;

    chrome.runtime.sendMessage({
      type: 'RECALL_CLIPBOARD_ITEM',
      payload: {
        content: trimmed,
        sourceUrl: location.href,
        sourceTitle: document.title || '',
      },
    }).catch(() => {
      // Extension context may be invalidated (e.g., during reload) — ignore.
    });
  }, true);
})();
