<p align="center"><img src="assets/stacks-wordmark.svg" width="390" alt="stacks"></p>

# Stacks — Tab Organizer

Keep related tabs together in Chrome's top tab bar. Stacks groups tabs by website, shows each site's real logo, and lets you expand or collapse its tabs.

Version **0.7.3** includes the minimal **03 Tabs** app icon and an English interface. Automatic website stacks keep their website logos; custom groups keep their own text labels and colors.

## Install

Requires desktop Chrome 120 or later.

1. Download this repository with **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the **`extension`** folder inside the extracted project.
4. Pin **Stacks — Tab Organizer** from Chrome's extensions menu.

No build step, account, or companion app is required. To update an existing installation, replace the project files and click **Reload** on its extension card.

## Use

- Click the Stacks toolbar icon to organize the current window and collapse other stacks.
- Right-click that icon for automatic grouping, website logo tabs, and the option to park collapsed tabs in a minimized window.
- Each website stack gets a control tab with its original logo, name, and tab count. Click that tab to expand or collapse its stack.
- Expanded tabs have a native colored group label and underline. Right-click the label to change its text or color. Stacks remembers these settings for that website across windows and reloads.
- Manually created groups keep their own labels. Pinned tabs and shared groups are left alone.

Chrome offers nine group colors: grey, blue, red, yellow, green, pink, purple, cyan, and orange. Custom names support Unicode and emoji. The website control tab keeps the site's name and logo even when its group label is renamed.

### Collapsed tabs

With **Park collapsed tabs in a minimized window** enabled, original pages move to a minimized Chrome window and remain open. Expanding a stack brings the same tabs back. Closing its control tab brings its original pages back to the main window.

**Closing the parked-tabs window closes the pages it contains.** Use its **Return tabs to their windows** button to recover tabs instead.

Chrome does not report a click on an already active tab. If a collapsed control tab is the only available tab, use its **Expand and browse** button or the native group label when available. Stacks cannot recolor an individual native tab or draw overlapping thumbnails in Chrome's tab strip.

### Website matching and recovery

Tabs are matched by full hostname, ignoring `www.`. ChatGPT's old and new hostnames are treated as one website. Different service subdomains, such as Google Scholar and Google Docs, remain separate. Automatic grouping starts when a website has at least two eligible tabs; an existing stack can keep a single remaining tab.

Known stack members retain their original website identity and logo during supported sign-in redirects. Unrelated sign-in tabs are not adopted. Moving to a different ordinary website moves a tab out of its old stack.

If an older installation lost a website control tab, select a page in that group and use **Restore this stack's website logo tab**. Recovery requires an unambiguous match with the saved stack information.

## Privacy and permissions

Stacks runs locally. It has no backend, telemetry, remote code, or webpage content scripts. It does not send tab data to a server or store complete page URLs, conversation titles, page contents, or sign-in tokens.

Local storage contains settings, website identifiers, group styles, recovery metadata, and cached logo PNGs. Website logos are read from Chrome's favicon cache. A bundled Canvas favicon provides a fallback for that site's sign-in flow.

| Permission | Purpose |
| --- | --- |
| `tabs` | Read tab URLs to identify websites and move existing tabs |
| `tabGroups` | Create and manage native tab groups |
| `storage` | Save settings, styles, logo caches, and recovery metadata |
| `alarms` | Reconcile tab changes missed by browser events |
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

The package is written to `dist/stacks-0.7.3.zip`. Browser tests use isolated temporary profiles.

To regenerate the approved app icon, install Pillow (`python3 -m pip install Pillow`) and run `python3 scripts/icons.py`. This produces SVG brand assets and 16, 32, 48, and 128 px PNG extension icons from shared geometry. Website favicons are separate from the app icon.

### Project layout

- `extension/` — loadable Manifest V3 extension
- `extension/src/compact.js` — website control tabs and parked-tab behavior
- `extension/src/engine.js` — native group management
- `extension/src/cover-icon.js` — website favicon caching and category badges
- `extension/src/controls.js` — toolbar actions and English menus
- `assets/` — approved SVG brand mark and wordmark
- `tests/` — unit and isolated browser integration tests
- `scripts/` — checks, icon generation, and packaging

Built with Chrome's [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups), [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [action](https://developer.chrome.com/docs/extensions/reference/api/action) APIs.
