// background.js
// Owns all Recall data in chrome.storage.local and the timers that keep
// it clean: 24h expiry for Recent items, and a 7-day inactivity nudge
// for Vault items.

const RECENT_KEY = 'recallRecentItems';
const VAULT_KEY = 'recallVaultItems';

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const RECENT_TTL_MS = MS_DAY;
const VAULT_INACTIVITY_MS = 7 * MS_DAY;
const EXPIRY_WARNING_WINDOW_MS = MS_HOUR; // warn when <1h remains

const CHECK_ALARM = 'recall-periodic-check';

// ---------- storage helpers ----------

async function getRecent() {
  const { [RECENT_KEY]: items } = await chrome.storage.local.get(RECENT_KEY);
  return items || [];
}

async function setRecent(items) {
  await chrome.storage.local.set({ [RECENT_KEY]: items });
}

async function getVault() {
  const { [VAULT_KEY]: items } = await chrome.storage.local.get(VAULT_KEY);
  return items || [];
}

async function setVault(items) {
  await chrome.storage.local.set({ [VAULT_KEY]: items });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- smart title generation ----------

function detectType(content, isAddressBarCopy) {
  const trimmed = content.trim();

  if (isAddressBarCopy) return 'addressbar';

  // URL detection
  const urlMatch = trimmed.match(/^https?:\/\/\S+$/i);
  if (urlMatch) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.includes('github.com')) return 'github';
      return 'link';
    } catch (e) {
      // fall through
    }
  }

  // Code detection — multiple lines with common code punctuation/keywords
  const lines = trimmed.split('\n');
  const codeSignals = /[{};]|=>|\bfunction\b|\bdef \b|\bclass \b|\bconst \b|\bimport \b|<\/?\w+>/;
  if (lines.length > 1 && codeSignals.test(trimmed)) return 'code';
  if (lines.length === 1 && codeSignals.test(trimmed) && trimmed.length < 200) return 'code';

  // Meeting-notes-ish: multiple lines, looks like prose/list notes
  if (lines.length >= 3) return 'notes';

  return 'text';
}

function domainFromUrl(str) {
  try {
    return new URL(str).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function generateTitle(content, type, sourceTitle) {
  const trimmed = content.trim();

  switch (type) {
    case 'addressbar': {
      const domain = domainFromUrl(trimmed);
      return domain ? `Address Bar · ${domain}` : 'Address Bar';
    }
    case 'github': {
      const path = trimmed.replace(/^https?:\/\/github\.com\//i, '').split(/[?#]/)[0];
      return path ? `GitHub Repo · ${path.split('/').slice(0, 2).join('/')}` : 'GitHub Repo';
    }
    case 'link': {
      const domain = domainFromUrl(trimmed);
      return domain ? `Link · ${domain}` : 'Link';
    }
    case 'code':
      return 'Code Snippet';
    case 'notes':
      return sourceTitle ? `Notes · ${truncate(sourceTitle, 24)}` : 'Notes';
    default: {
      const firstLine = trimmed.split('\n')[0];
      return truncate(firstLine, 40) || 'Copied Text';
    }
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// ---------- core operations ----------

async function addClipboardItem({ content, sourceUrl, sourceTitle, isAddressBarCopy }) {
  const now = Date.now();
  const recent = await getRecent();

  // Duplicate detection: same content already present and unexpired —
  // reset its timer instead of creating a new entry.
  const existingIndex = recent.findIndex((item) => item.content === content);
  if (existingIndex !== -1) {
    const existing = recent[existingIndex];
    existing.createdAt = now;
    existing.expiresAt = now + RECENT_TTL_MS;
    existing.expiryNotified = false;
    // If we now know a more specific source (e.g. the page it came from),
    // and the existing entry doesn't have one, fill it in.
    if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
    recent.splice(existingIndex, 1);
    recent.unshift(existing);
    await setRecent(recent);
    return existing;
  }

  const type = detectType(content, isAddressBarCopy);
  const title = generateTitle(content, type, sourceTitle);

  const item = {
    id: makeId(),
    title,
    content,
    type,
    sourceUrl: sourceUrl || '',
    sourceTitle: sourceTitle || '',
    createdAt: now,
    expiresAt: now + RECENT_TTL_MS,
    expiryNotified: false,
  };

  recent.unshift(item);
  await setRecent(recent);
  return item;
}

async function pruneExpiredAndWarn() {
  const now = Date.now();
  const recent = await getRecent();
  const kept = [];

  for (const item of recent) {
    if (item.expiresAt <= now) {
      // expired — drop silently, this is the "self-cleaning" promise.
      continue;
    }
    const remaining = item.expiresAt - now;
    if (!item.expiryNotified && remaining <= EXPIRY_WARNING_WINDOW_MS) {
      notify(
        `"${item.title}" expires soon`,
        'This clipboard item will be auto-deleted in under an hour unless you save it to the Vault.'
      );
      item.expiryNotified = true;
    }
    kept.push(item);
  }

  if (kept.length !== recent.length || kept.some((k, i) => k !== recent[i])) {
    await setRecent(kept);
  }
}

async function checkVaultInactivity() {
  const now = Date.now();
  const vault = await getVault();
  let changed = false;

  for (const item of vault) {
    const lastUsed = item.lastUsedAt || item.savedAt;
    const idle = now - lastUsed;
    if (!item.inactivityNotified && idle >= VAULT_INACTIVITY_MS) {
      notify(
        `Still need "${item.title}"?`,
        "It's been sitting in your Vault untouched for a week. Open Recall to keep, archive, or remove it."
      );
      item.inactivityNotified = true;
      changed = true;
    }
  }

  if (changed) await setVault(vault);
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1,
  });
}

// ---------- address-bar / external copy detection ----------
// Background service workers and hidden documents cannot read the
// clipboard — Chrome blocks that for any non-focused context, on
// purpose, so an extension can't silently poll your clipboard. Capture
// instead happens from popup.js, which IS a focused, user-opened
// document, then reports here for the same tagging/storage logic the
// in-page copy path uses.

async function handleClipboardPoll(content) {
  let sourceUrl = '';
  let sourceTitle = '';
  let isAddressBarCopy = false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      sourceTitle = tab.title || '';
      const normalizedTabUrl = (tab.url || '').replace(/\/$/, '');
      const normalizedContent = content.trim().replace(/\/$/, '');
      if (tab.url && normalizedTabUrl === normalizedContent) {
        // The copied text is exactly the active tab's URL — almost
        // certainly an address-bar copy rather than in-page selection.
        sourceUrl = tab.url;
        isAddressBarCopy = true;
      }
    }
  } catch (e) {
    // "tabs" permission missing or no active tab — proceed without source.
  }

  await addClipboardItem({ content, sourceUrl, sourceTitle, isAddressBarCopy });
}

// ---------- message handling ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'RECALL_CLIPBOARD_ITEM') {
    addClipboardItem(message.payload).then((item) => sendResponse({ ok: true, item }));
    return true; // keep channel open for async response
  }
  if (message?.type === 'RECALL_CLIPBOARD_POLL') {
    handleClipboardPoll(message.payload.content).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// ---------- alarms ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) {
    pruneExpiredAndWarn();
    checkVaultInactivity();
  }
});
