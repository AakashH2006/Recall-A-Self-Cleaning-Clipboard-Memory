// popup.js
const RECENT_KEY = 'recallRecentItems';
const VAULT_KEY = 'recallVaultItems';
const RECENT_TTL_MS = 24 * 60 * 60 * 1000;
const VAULT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;
const WARNING_WINDOW_MS = 60 * 60 * 1000;

const recentListEl = document.getElementById('recentList');
const vaultListEl = document.getElementById('vaultList');
const recentEmptyEl = document.getElementById('recentEmpty');
const vaultEmptyEl = document.getElementById('vaultEmpty');
const vaultCountEl = document.getElementById('vaultCount');
const recentTemplate = document.getElementById('recentItemTemplate');
const vaultTemplate = document.getElementById('vaultItemTemplate');

let tickHandle = null;

// ---------- storage ----------

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

// ---------- formatting ----------

function formatTimeRemaining(ms) {
  if (ms <= 0) return 'expired';
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs >= 1) return `${hrs}h ${mins}m left`;
  if (mins >= 1) return `${mins}m left`;
  return '<1m left';
}

function formatAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function renderSource(node, item) {
  const sourceBtn = node.querySelector('[data-role="source"]');
  const sourceText = node.querySelector('[data-role="sourceText"]');
  if (!item.sourceUrl) {
    sourceBtn.hidden = true;
    return;
  }
  sourceBtn.hidden = false;
  const domain = domainOf(item.sourceUrl) || item.sourceUrl;
  sourceText.textContent = item.type === 'addressbar'
    ? `Copied from address bar · ${domain}`
    : `Copied from ${domain}`;
  sourceBtn.onclick = (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: item.sourceUrl });
  };
}

// ---------- rendering ----------

async function renderRecent() {
  const items = (await getRecent()).filter((i) => i.expiresAt > Date.now());
  recentListEl.innerHTML = '';
  recentEmptyEl.hidden = items.length > 0;

  for (const item of items) {
    const node = recentTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.dataset.type = item.type;
    node.querySelector('[data-role="title"]').textContent = item.title;
    node.querySelector('[data-role="preview"]').textContent = item.content;
    updateRecentTimers(node, item);
    renderSource(node, item);
    wireRecentItem(node, item);
    recentListEl.appendChild(node);
  }
}

function updateRecentTimers(node, item) {
  const remaining = item.expiresAt - Date.now();
  node.querySelector('[data-role="time"]').textContent = formatTimeRemaining(remaining);
  const pct = Math.max(0, Math.min(100, (remaining / RECENT_TTL_MS) * 100));
  const fill = node.querySelector('[data-role="expiryFill"]');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('is-warning', remaining <= WARNING_WINDOW_MS);
}

async function renderVault() {
  const items = await getVault();
  vaultListEl.innerHTML = '';
  vaultEmptyEl.hidden = items.length > 0;
  vaultCountEl.textContent = String(items.length);

  for (const item of items) {
    const node = vaultTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.dataset.type = item.type;
    node.querySelector('[data-role="title"]').textContent = item.title;
    node.querySelector('[data-role="preview"]').textContent = item.content;
    node.querySelector('[data-role="time"]').textContent = `saved ${formatAgo(item.savedAt)}`;

    const idle = Date.now() - (item.lastUsedAt || item.savedAt);
    if (idle >= VAULT_INACTIVITY_MS) {
      node.querySelector('[data-role="nudge"]').hidden = false;
    }

    renderSource(node, item);
    wireVaultItem(node, item);
    vaultListEl.appendChild(node);
  }
}

// ---------- interactions ----------

function wireRecentItem(node, item) {
  const head = node.querySelector('.item-head');
  const body = node.querySelector('[data-role="body"]');

  head.addEventListener('click', () => {
    const isOpen = node.classList.toggle('is-open');
    body.hidden = !isOpen;
  });

  node.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(item.content);
    flashButton(e.currentTarget, 'Copied');
  });

  node.querySelector('[data-action="save"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await moveToVault(item.id);
    await renderRecent();
    await renderVault();
  });

  node.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const remaining = (await getRecent()).filter((i) => i.id !== item.id);
    await setRecent(remaining);
    await renderRecent();
  });
}

function wireVaultItem(node, item) {
  const head = node.querySelector('.item-head');
  const body = node.querySelector('[data-role="body"]');
  const titleEl = node.querySelector('[data-role="title"]');

  head.addEventListener('click', () => {
    const isOpen = node.classList.toggle('is-open');
    body.hidden = !isOpen;
  });

  node.querySelector('[data-action="copy"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(item.content);
    await touchVaultItem(item.id);
    flashButton(e.currentTarget, 'Copied');
  });

  node.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
    e.stopPropagation();
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.execCommand('selectAll', false, null);
  });

  titleEl.addEventListener('blur', async () => {
    if (titleEl.contentEditable !== 'true') return;
    titleEl.contentEditable = 'false';
    const newTitle = titleEl.textContent.trim() || item.title;
    titleEl.textContent = newTitle;
    const vault = await getVault();
    const target = vault.find((v) => v.id === item.id);
    if (target) {
      target.title = newTitle;
      await setVault(vault);
    }
  });

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.blur();
    }
  });

  node.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const remaining = (await getVault()).filter((v) => v.id !== item.id);
    await setVault(remaining);
    await renderVault();
  });
}

async function moveToVault(id) {
  const recent = await getRecent();
  const idx = recent.findIndex((i) => i.id === id);
  if (idx === -1) return;
  const [item] = recent.splice(idx, 1);
  await setRecent(recent);

  const vault = await getVault();
  vault.unshift({
    id: item.id,
    title: item.title,
    content: item.content,
    type: item.type,
    sourceUrl: item.sourceUrl,
    savedAt: Date.now(),
    lastUsedAt: Date.now(),
    inactivityNotified: false,
  });
  await setVault(vault);
}

async function touchVaultItem(id) {
  const vault = await getVault();
  const target = vault.find((v) => v.id === id);
  if (target) {
    target.lastUsedAt = Date.now();
    target.inactivityNotified = false;
    await setVault(vault);
  }
}

function flashButton(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 900);
}

// ---------- clipboard check (address bar / external copies) ----------
// Chrome only allows clipboard reads from a focused, user-facing
// document — a hidden/background context is blocked from this on
// purpose, so this has to run here in the popup, not in background.js.

const scanBtn = document.getElementById('scanClipboardBtn');
const scanStatusEl = document.getElementById('scanStatus');

function showScanStatus(text) {
  scanStatusEl.textContent = text;
  scanStatusEl.hidden = false;
  setTimeout(() => { scanStatusEl.hidden = true; }, 2200);
}

async function checkClipboard(isManual) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    if (isManual) showScanStatus("Couldn't read clipboard — try again, or check it isn't empty/an image.");
    return false;
  }

  if (!text || !text.trim()) {
    if (isManual) showScanStatus('Clipboard is empty.');
    return false;
  }

  const recent = await getRecent();
  const alreadyTop = recent[0] && recent[0].content === text;
  if (alreadyTop) {
    if (isManual) showScanStatus('Already in Recent.');
    return false;
  }

  await chrome.runtime.sendMessage({
    type: 'RECALL_CLIPBOARD_POLL',
    payload: { content: text },
  });
  await renderRecent();
  if (isManual) showScanStatus('Captured.');
  return true;
}

if (scanBtn) {
  scanBtn.addEventListener('click', () => checkClipboard(true));
}

// ---------- tabs ----------

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      const target = tab.dataset.tab;
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.panel === target);
      });
    });
  });
}

// ---------- live countdown tick ----------

function startTicking() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(async () => {
    const items = await getRecent();
    const live = items.filter((i) => i.expiresAt > Date.now());
    if (live.length !== items.length) {
      await renderRecent();
      return;
    }
    document.querySelectorAll('#recentList .item').forEach((node) => {
      const item = live.find((i) => i.id === node.dataset.id);
      if (item) updateRecentTimers(node, item);
    });
  }, 15000);
}

// ---------- init ----------

async function init() {
  wireTabs();
  await renderRecent();
  await renderVault();
  startTicking();
  checkClipboard(false); // silent best-effort catch of e.g. an address-bar copy made just before opening the popup
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[RECENT_KEY]) renderRecent();
  if (changes[VAULT_KEY]) renderVault();
});

init();
