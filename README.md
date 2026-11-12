<p align="center"><img src="assets/stacks-wordmark.svg" width="390" alt="stacks"></p>

# Stacks — Tab Organizer

Keep related tabs together in Chrome's top tab bar. Stacks groups tabs by website, shows each site's real logo, and lets you expand or collapse its tabs.

Version **0.9.0** adds **Open / Saved / Backups** to the same 440 × 580 toolbar popup. Save whole website or custom stacks, optionally close their pages after a successful save, reopen missing links, and undo category moves. Local backups help recover closed pages. Known duplicate automatic website stacks merge, and a surviving logo control tab can reconnect its group after Chrome changes group IDs. Automatic stacks keep their logos; custom stacks keep their own text labels and colors.

## Install

Requires desktop Chrome 127 or later.

1. Download this repository with **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the **`extension`** folder inside the extracted project.
4. Pin **Stacks — Tab Organizer** from Chrome's extensions menu.

No build step, account, or companion app is required. To update an existing installation, replace the project files and click **Reload** on its extension card.

## Use

- Click the Stacks toolbar icon to open the small custom-stack popup. Use **Organize websites** inside it to organize the current window and collapse other website stacks.
- Right-click that icon for **Open Stacks…**. Automatic grouping, website logos, parking and repair settings are inside **Website grouping**.
- Each website stack gets a control tab with its original logo, name, and tab count. Click that tab to expand or collapse its stack.
- Expanded tabs have a native colored group label and underline. Right-click the label to change its text or color. Stacks remembers these settings for that website across windows and reloads.
- Manually created groups keep their own labels. Pinned tabs and shared groups are left alone.

Chrome offers nine group colors: grey, blue, red, yellow, green, pink, purple, cyan, and orange. Custom names support Unicode and emoji. The website control tab keeps the site's name and logo even when its group label is renamed.

### Custom stacks

1. Click the Stacks toolbar icon to open the **440 × 580 px popup**. It opens over your current page without adding a tab.
2. Select tabs from one or more websites, then choose **New custom stack** and enter a name and color. Tabs from collapsed website stacks are included in the list.
3. To add tabs to an existing category, select them, choose the destination, and click **Move tabs**.
4. Choose a category from **View stack** to edit its name or color. Select its tabs and use **Return to automatic** when you want website grouping to handle them again.

Custom stacks appear as native groups in Chrome's top tab bar, with a text label and colored underline. Click the native group label to expand or collapse. Their tabs are excluded from automatic website grouping, including when navigating to another website. Website logos remain on automatic stacks; custom categories have no extra logo control tab.

The popup lists the source window's eligible tabs and parked members, with search and multi-selection. Selection is preserved while filtering, with a notice for selected tabs outside the current view and a **Clear selection** control. **New stack…** in the destination picker creates a category directly from the selected tabs. Existing manually created native groups are recognized. Pinned tabs, shared groups and incognito tabs are excluded. Empty categories are kept for reuse and can be deleted without closing any pages. Dragging a tab out of a custom native group also makes it eligible for automatic grouping again.

Categories and group associations are saved locally. The Open section manages live Chrome tabs; Saved and Backups keep local link snapshots.

### Save and reopen a stack

1. In **Open**, choose a custom stack or website under **View stack**, then click **Save stack for later**. You can also use **Saved → Save a stack**.
2. Choose a saved name. **Save & keep open** is the default. Select **Close these pages after saving** to use **Save & close tabs** instead.
3. In **Saved**, choose a saved copy, review its page list and click **Reopen missing pages**.

The extension writes the saved copy before closing anything. If the stack changes while the dialog is open or saving fails, its pages stay open. Reopening skips matching pages already in the destination window (including parked pages), preserving intentional duplicate counts. Existing pages keep their current groups. New custom-stack pages recover their name, color and order and remain excluded from automatic grouping; website stacks follow the current website grouping settings and colors.

Saved links survive Chrome and extension restarts. They do not contain unsaved form text, sign-in state or scroll position. Pinned tabs, shared groups, local files, browser pages and recognized sign-in-provider pages are excluded. Copies are stored on this device and are deleted if the extension is uninstalled.

### Backups and Undo

- **Backups → Back up now** saves the eligible pages and categories in the current window, including parked members.
- **Automatic local backups** is on by default. It maintains the latest window state, checkpoints changed states, and retains pre-close and pre-move snapshots. Up to 20 recent backups are kept across windows, subject to a 6 MB library budget. Identical snapshots are not duplicated; saved stacks are never evicted to make space.
- Select a backup to review its pages and reopen missing links in the current window. This never closes or replaces existing tabs. Backups only cover pages recorded while Stacks was running and are best-effort after abrupt browser termination.
- **Undo last move** restores the previous custom/automatic assignment using the same live tabs, preserving page state. It covers the last 10 popup category moves in the current Chrome session and refuses to overwrite a later manual regrouping.
- Turn automatic backups off to stop recording and clear the current recovery cache. Existing saved stacks and backups remain available and can be deleted individually.

### Collapsed tabs

With **Park collapsed tabs in a minimized window** enabled, original pages move to a minimized Chrome window and remain open. Expanding a stack brings the same tabs back. Closing its control tab brings its original pages back to the main window.

**Closing the parked-tabs window closes the pages it contains.** Use its **Return tabs to their windows** button to recover tabs instead.

Chrome does not report a click on an already active tab. If a collapsed control tab is the only available tab, use its **Expand and browse** button or the native group label when available. Stacks cannot recolor an individual native tab or draw overlapping thumbnails in Chrome's tab strip.

### Website matching and recovery

Tabs are matched by full hostname, ignoring `www.`. ChatGPT's old and new hostnames are treated as one website. Different service subdomains, such as Google Scholar and Google Docs, remain separate. Automatic grouping starts when a website has at least two eligible tabs; an existing stack can keep a single remaining tab.

Known stack members retain their original website identity and logo during supported sign-in redirects. Unrelated sign-in tabs are not adopted. Moving to a different ordinary website moves a tab out of its old stack.

If an older installation lost a website control tab, select a page in that group and use **Restore this stack's website logo tab**. Recovery requires an unambiguous match with the saved stack information.

## Privacy and permissions

Stacks runs locally. It has no backend, telemetry, remote code, or webpage content scripts. Saved stacks and backups store complete page URLs and titles on this device so they can be reopened. No tab data is sent to a server. Page contents, form entries, cookies and sign-in state are not read or backed up. URLs may themselves contain sensitive information; see [PRIVACY.md](PRIVACY.md).

Local storage contains settings, website identifiers, group styles, custom category names/colors and group membership IDs, saved stacks, backup snapshots, recovery metadata, and cached logo PNGs. Undo history is held in session storage. Website logos are read from Chrome's favicon cache. A bundled Canvas favicon provides a fallback for that site's sign-in flow.

| Permission | Purpose |
| --- | --- |
| `tabs` | Read URLs/titles to identify websites, organize live tabs, save links and reopen missing pages |
| `tabGroups` | Create and manage native tab groups |
| `storage` | Save settings, styles, logo caches, saved links, backup snapshots and recovery metadata |
| `alarms` | Reconcile tab changes and refresh local recovery snapshots |
| `contextMenus` | Provide toolbar settings |
| `favicon` | Read website icons from Chrome's local cache |

Internal browser pages, local files, and incognito windows are excluded from automatic grouping.

## Development

Node.js and Python 3 are used for development checks and packaging. The extension itself has no runtime dependencies.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

The package is written to `dist/stacks-0.9.0.zip`. Browser tests use isolated temporary profiles, including adjacent-stack collapse, duplicate automatic stacks, remapped group IDs, save/close/reopen, custom categorization, website logos, unsaved-page preservation and reload recovery.

To regenerate the approved app icon, install Pillow (`python3 -m pip install Pillow`) and run `python3 scripts/icons.py`. This produces SVG brand assets and 16, 32, 48, and 128 px PNG extension icons from shared geometry. Website favicons are separate from the app icon.

### Project layout

- `extension/` — loadable Manifest V3 extension
- `extension/src/compact.js` — website control tabs and parked-tab behavior
- `extension/src/engine.js` — native group management
- `extension/src/cover-icon.js` — website favicon caching and category badges
- `extension/src/controls.js` — toolbar actions and English menus
- `extension/src/custom.js` — custom categories and native group ownership
- `extension/manager.html` — compact toolbar popup with category editing and tab selection
- `assets/` — approved SVG brand mark and wordmark
- `tests/` — unit and isolated browser integration tests
- `scripts/` — checks, icon generation, and packaging

Built with Chrome's [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups), [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [action](https://developer.chrome.com/docs/extensions/reference/api/action) APIs.
