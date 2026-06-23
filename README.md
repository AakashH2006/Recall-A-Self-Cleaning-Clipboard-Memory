# Recall — A Self-Cleaning Clipboard Memory

Your clipboard remembers what's important and forgets what isn't.

Recall is a browser extension that keeps a temporary history of everything you copy. Items stick around for 24 hours and then quietly delete themselves — unless you move them to the Vault, where they stay for good.

## Features

- **Automatic clipboard history** — anything you copy on a webpage is saved instantly, no setup needed.
- **24-hour auto-expiry** — items clean themselves up after a day. No manual upkeep.
- **Smart auto-titles** — copied content is labeled automatically: `Link · domain.com`, `GitHub Repo · owner/repo`, `Code Snippet`, `Notes`, or a snippet of the text itself.
- **Source tracking** — every item remembers which page (or the address bar) it was copied from, with a clickable link back to it.
- **Duplicate detection** — copy the same thing twice and Recall just resets its 24h timer instead of cluttering your list with a repeat.
- **Expandable previews** — click any item to see the full content, copy it again, save it, or delete it.
- **The Vault** — a permanent space for things you don't want to lose. Items here never auto-expire.
- **Inactivity nudges** — if a Vault item sits untouched for 7+ days, Recall asks whether you still want to keep it.
- **Expiry warnings** — a one-time notification fires when a Recent item has under an hour left, so nothing important disappears by surprise.
- **Privacy-first** — everything lives in local browser storage. No accounts, no servers, no AI calls, nothing leaves your machine.

## How to use it

- **Copy normally.** Select text on any page and hit Ctrl+C (or Cmd+C). It shows up in the **Recent** tab right away.
- **Open the popup** to browse what you've copied, expand an item for a preview, and copy/save/delete it.
- **Save to Vault** for anything you don't want to lose to the 24h timer.
- **Rename** Vault items by clicking the rename button next to an entry.
- **Check clipboard** — see the section below on address-bar copies.

## Why there's a "Check clipboard" button

A page copy (selecting text and hitting Ctrl+C) fires a `copy` event that Recall listens for directly — that part is fully automatic.

The browser's **address bar isn't a webpage**, so nothing can listen there, and Chrome deliberately blocks extensions from silently reading the clipboard in the background (otherwise any extension could spy on everything you copy, anywhere). So address-bar copies need one extra step where Recall is *allowed* to check: while its own popup is open and focused.

That happens two ways:

1. **Automatically** — every time you open the Recall popup, it does one quiet clipboard check on open. If you just copied a URL from the address bar, it'll already be sitting in Recent by the time you look.
2. **Manually** — the **↻ Check clipboard** button forces another check without closing and reopening the popup. Useful if you copy something new while the popup is already open.

If the copied text exactly matches the URL of your current tab, Recall tags it as `Address Bar · domain.com` so you can tell it apart from a normal in-page copy.

## Source tracking, in detail

Every saved item — in Recent or the Vault — keeps a record of where it came from:

- **In-page copy** → the URL of the page you copied from, captured the moment you hit Ctrl+C.
- **Address-bar copy** → detected by matching the copied text against your active tab's URL (see above).

Expand any item and you'll see a row like:

```
↗ Copied from github.com
```

Click it to reopen that page in a new tab.

## Permissions, and why each one is needed

| Permission | What it's for |
|---|---|
| `storage` | Saving Recent and Vault items locally. |
| `alarms` | Periodically checking for expired items and idle Vault items. |
| `notifications` | The one-time expiry warning and Vault inactivity nudge. |
| `clipboardRead` | Letting the popup read the clipboard for the address-bar check, described above. |
| `tabs` | Reading the active tab's URL/title, used to tag the source of a copy and detect address-bar copies. |

No `host_permissions` are requested beyond the content script's own page access — Recall never makes network requests anywhere.

## Project structure

```
recall-extension/
├── manifest.json     Extension config (MV3)
├── content.js        Listens for copy events on every page
├── background.js     Stores items, runs the expiry/inactivity checks, handles messages
├── popup.html         Popup UI markup
├── popup.css          Popup styling
├── popup.js           Popup behavior: rendering, actions, the clipboard check
└── icons/             Toolbar/extension icons
```

## Known limitations

- Sites that render text in a `<canvas>` or block native selection (some web-based editors, Google Docs included) won't fire a normal `copy` event, so Recall can't see those copies.
- Address-bar capture only recognizes a copy as "from the address bar" when the copied text is an *exact* match for the current tab's URL.
- Recall only sees the clipboard while its own popup is open — there's no way around this without compromising the "no background clipboard spying" guarantee.
