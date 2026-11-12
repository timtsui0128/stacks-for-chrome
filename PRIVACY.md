# Privacy Policy — Stacks — Tab Organizer

Effective date: 12 November 2026

Applies to: Stacks — Tab Organizer, version 0.9.0

Publisher: timtsui0128

Stacks organizes open browser tabs by website or by categories you create. It works within your Chrome browser. No Stacks account is required, and the extension has no backend server, advertising, analytics, telemetry, or remotely executed code.

## Information processed on your device

Stacks uses Chrome's extension APIs to read the information needed to organize your open tabs:

- Tab URLs and website hostnames, to identify websites and determine which stack a tab belongs to.
- Tab titles and website icons, to show recognizable entries in the popup and website control tabs.
- Tab, window and group identifiers; tab order, active/pinned state and group membership; and expanded/collapsed state, to move and restore the same open tabs.
- The category names, group labels, colors and settings you choose.

This information is processed locally for tab organization, search within the popup, icon display, saved stacks, backups and recovery. Stacks does not read webpage bodies, messages, documents, passwords, cookies or form fields. It does not request access to Chrome's browsing-history database. Complete URLs and titles can themselves contain personal information or tokens; saved stacks and backups keep these links on your device, not on a publisher server.

## What is stored

Chrome's local extension storage holds preferences, website identifiers, group labels and colors, custom categories, group membership and recovery identifiers, and cached website icon images. Saved stacks and local backup snapshots additionally store complete webpage URLs, titles, page order, category names and colors, and identifiers used to reconnect open tabs. Temporary session storage holds stack ownership, focus identifiers and up to ten recent category moves for Undo.

Saved stacks are created when you choose Save. Automatic local backups are enabled by default and maintain recovery snapshots of eligible open pages while Stacks is running, including checkpoints before detected closures and category moves. This is a local record of open-page states, not a query of Chrome's browsing-history database. Stacks excludes incognito and pinned tabs, shared groups, local files, browser/extension pages, URLs with embedded usernames or passwords, and recognized sign-in-provider URLs from these snapshots. Other URLs may still contain sensitive query parameters; Stacks does not inspect page contents to determine their sensitivity.

Stacks does not save webpage contents, form drafts, authentication state, navigation history or scroll position. Reopening a saved link loads the website again. Website icons are obtained through Chrome's favicon mechanism; Stacks does not use an external favicon service. A Canvas icon is also bundled with the extension as a fallback.

## Data transmission, sharing and sale

Stacks does not send tab information, category names, settings or usage data to the publisher or to an external server. It does not sell data, share data for advertising, or use data for profiling, creditworthiness or lending decisions. There are no analytics or advertising SDKs.

Your original webpages remain ordinary Chrome tabs and can continue making their own network requests, including while parked in a minimized window. Their websites' privacy policies still apply. Chrome's own browser, favicon, session restoration, synchronization and backup behavior is controlled by Google and your Chrome settings. Stacks does not provide its own cloud synchronization or backup service.

If you choose to open the project's GitHub page or contact the publisher there, GitHub processes that interaction under its own privacy policy. The extension does not automatically send browsing data to GitHub.

## Permissions

| Permission | Why Stacks uses it |
| --- | --- |
| `tabs` | Read open-tab URLs, titles and related metadata for website matching, popup search, saved stacks and local backups; reopen saved links and close pages only when requested. |
| `tabGroups` | Create, inspect, rename, recolor, expand and collapse native Chrome tab groups. |
| `storage` | Keep preferences, custom categories, icon caches, saved webpage links/titles and backup snapshots locally; keep Undo records in session storage. |
| `alarms` | Periodically reconcile groups and refresh local recovery snapshots if browser events were missed while the background worker was suspended. |
| `contextMenus` | Provide the toolbar's grouping, appearance and recovery controls. |
| `favicon` | Display website icons using Chrome's favicon mechanism. |

Stacks has no webpage host permissions and injects no content scripts. Incognito operation is disabled. Pinned tabs and shared groups are excluded from its automatic grouping workflow.

## Retention and your choices

Preferences, category names, style settings and cached metadata remain in your local Chrome profile until replaced, removed through the available controls, or cleared by removing the extension or its data. Some inactive group records are cleaned up during reconciliation; not every setting is automatically erased when you close a tab. The website icon cache is limited to 100 website entries.

Saved stacks remain until you delete them. Backups retain up to twenty recent snapshots across windows; older backups may be removed sooner to keep the library within a six-megabyte local storage budget. Saved stacks are never automatically removed to make space. Current recovery snapshots are replaced as tabs change. In Backups, you can turn off automatic backups (which clears the current recovery cache and leaves existing backup copies intact), make a manual backup, or delete individual backup copies. Undo history lasts only for the current Chrome session. Backups are best-effort and cannot recover pages from before Stacks started recording or after its local data is lost.

You can pause automatic grouping, move tabs out of custom stacks, delete empty custom categories, and change or remove labels through the extension and Chrome's group controls. Removing a tab from a custom category makes it eligible for automatic grouping again. Disabling the extension stops its operation but does not erase stored settings; uninstalling removes the extension's local storage. Chrome's own history, open tabs, saved groups or backups are separate from that extension storage.

Before disabling or uninstalling Stacks, return any parked tabs to their normal windows using **Return tabs to their windows** in the parked-tabs window. Closing that window closes the pages it contains. Saved stacks and backups retain links, not live page state. Uninstalling Stacks also deletes its local saved stacks and backups; this feature is not a cloud or external-device backup.

## Changes and contact

This policy will be updated when Stacks' data practices change. The effective date and applicable version appear above.

For privacy questions, contact the publisher through [the Stacks GitHub project](https://github.com/timtsui0128/stacks-for-chrome/issues). GitHub issues are public; do not include private browsing history, private URLs, account credentials or other sensitive information in a public issue.
