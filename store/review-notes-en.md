# Chrome Web Store submission fields

Prepared for Stacks — Tab Organizer 0.9.0 on 12 November 2026. The sections below are copy-ready review text, not additional store-description text.

## Single purpose

Organize open Chrome tabs into collapsible website stacks and user-defined categories so users can find, save and recover related page links directly in the tab bar and a compact toolbar popup.

## Permission justifications

### tabs

Stacks reads open-tab URLs and titles to match tabs by website, display and search the tab list, and let users organize the same existing pages. Saved stacks and backups retain complete page URLs and titles locally to reopen missing links. Save and close removes pages only after a successful save and explicit user choice. It uses tab/window/group identifiers and tab state to group, move and restore tabs, including the optional minimized parking window. This processing is local; tab data is not transmitted to the publisher or a server. Stacks does not access Chrome's browsing-history database or scrape webpage bodies.

### tabGroups

Stacks creates and maintains native Chrome tab groups, reads their members and state, and applies user-selected names and colors. It expands and collapses groups and distinguishes user-defined groups from automatically managed website stacks.

### storage

Stacks stores preferences, website/group styles, custom category names and colors, membership/recovery identifiers and cached website icon images in local extension storage. Saved stacks and backups additionally retain full URLs, titles, page order, names and colors. Session storage holds temporary group ownership, focus identifiers and up to ten Undo records. The extension does not use chrome.storage.sync or maintain an external database.

### alarms

A periodic alarm reconciles open tabs and stack associations when Chrome tab events may have been missed while the Manifest V3 service worker was suspended. It also refreshes local recovery snapshots when automatic backups are enabled. It is used only to maintain the tab-organizing feature, not to contact a remote service or track users.

### contextMenus

Stacks adds commands to its toolbar icon's context menu for organizing tabs, expanding/collapsing stacks, changing website-grouping settings and restoring a missing website-logo control tab.

### favicon

Stacks reads website icons through Chrome's favicon mechanism to show recognizable logos in website control tabs and the compact tab list. It does not send URLs to a third-party favicon service.

## Remote code

Select: **No, I am not using remote code.**

All executable JavaScript and styles are packaged with the extension. There are no remotely hosted scripts, dynamically downloaded executable modules, content scripts, analytics SDKs or external API endpoints. Website favicon images are data, not executable code.

## Data usage disclosure

Disclose local handling accurately; do not describe the extension as accessing no user data. Under the current dashboard categories, the relevant types are:

- **Web history:** open-tab URLs and website hostnames, used locally for grouping, popup search, saved stacks and recovery. Automatic backups are enabled by default and retain recent open-page snapshots. Stacks does not query Chrome’s history API; it does retain recent URL snapshots for the user-visible backup feature.
- **Website content:** limited tab metadata such as webpage titles and website icon images, used locally to identify tabs; saved stacks and backups persist page titles alongside links. The extension does not read page bodies, chats, documents, form entries or cookies.

Custom names and colors are user-provided organization settings stored locally. This does not add a purpose beyond tab organization. Interpret any changed dashboard category wording against the actual access described above and in the privacy policy.

The current implementation supports the certifications that user data is not sold or transferred to third parties, is not used or transferred for purposes unrelated to the extension's single purpose, and is not used or transferred for creditworthiness or lending. The publisher should make those certifications based on the final submitted build and their own practices.

## Test instructions

No account, credentials or payment are required to test Stacks. Website login is not required; any ordinary public webpages can be used.

1. Install the package on desktop Chrome 127 or later and pin its toolbar icon.
2. Open two ordinary pages from each of two websites (for example two GitHub pages and two arXiv pages). Leave one additional page open outside those websites.
3. Open the Stacks popup and click **Organize websites**. Check the website-name/logo control tabs and native groups in the top tab strip.
4. Activate a website control tab to expand its pages. After a member page is active, activate that website control tab again to collapse it. Chrome cannot signal a repeat click on an already active tab; the control page also provides **Expand and browse**.
5. Right-click the Stacks toolbar icon, open **Website grouping**, and enable **Park collapsed tabs in a minimized window** to reproduce the compact website-stack screenshots. Collapsed pages remain live in the minimized window. Expand a stack and confirm that the same tabs return.
6. In the popup, select pages from different websites. Choose **New stack**, enter **Literature review**, choose **Purple** and save. These pages form a custom native group and remain excluded from automatic website grouping.
7. Search or switch **View stack** with tabs selected. Selection is retained; a message indicates selected tabs outside the view.
8. Select a custom stack under **View stack** and use **Edit stack** to change its name/color. Select its pages and use **Return to automatic** to release them.
9. In Saved, choose Save a stack, select a website or custom stack and save while keeping its pages open. Preview the saved item, close one of its original pages and choose Reopen missing pages; only that missing link should open. Repeating the action should not create duplicates.
10. Explicitly choose Close these pages after saving to test save-and-close. Reload the extension and confirm the saved copy remains. Reopening loads links, not form drafts or scroll position.
11. In Backups, choose Back up now, review the saved pages, then test reopening missing links. Disable Automatic local backups to stop recording; existing saved copies remain.
12. Move pages between custom stacks and use Undo last move to restore the same live tabs.
13. Before removing the extension, use **Return tabs to their windows** in the parking window. Do not close that window while it contains pages you want to keep.

## Source audit supporting these statements

- `extension/manifest.json`: Manifest V3; six listed permissions; no host permissions or content scripts; incognito disabled; extension-local script and connect policy.
- `extension/src/custom.js`: URLs/titles are returned for the current popup view; local records store category names/colors and membership IDs.
- `extension/src/engine.js` and `compact.js`: local and session storage for group recovery, site identifiers, tab/window IDs, counters and state.
- `extension/src/cover-icon.js`: local favicon/bundled image processing; at most 100 cached website PNG entries; no external favicon provider.
- `extension/src/background.js`: serialized local browser-event handling and a one-minute reconciliation alarm.
- `extension/src/library.js`: local saved stacks, up to 20 backup snapshots within a 6 MB library budget, save-before-close, missing-link restoration and session-scoped Undo. No network endpoints.

## Official references checked

- [Listing fields and image sizes](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy fields and permission justification](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Local data handling must be disclosed](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

These notes summarize the current implementation; they do not represent an approval or a review decision by Google.
