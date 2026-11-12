# Stacks 0.9.0

Prepared on 12 November 2026. The 0.9.0 package has been uploaded as a draft update to the existing Chrome Web Store item `jgpebokkiodhcjjmflmhmoolimmaoldh`. The description, permission justifications and reviewer test instructions have been saved, and the public privacy policy is current. Screenshot 3–4 replacement and review submission are still pending; published version 0.8.1 remains available.

Uploaded package SHA-256: `92bea91988b9efef3a7d173dfcd4e5550676ad44ba3599cd5ec478c0eaa36960`.

- Merge duplicate website stacks when their automatic ownership can be verified.
- Reconnect a surviving website-logo control tab to its native group after Chrome changes group and tab IDs. Explicit custom categories remain independent.
- Preserve the existing logo-click interaction when Chrome temporarily blocks tab edits during mouse-down: retry expansion, collapse and focus changes after release, and cancel if the user selects another page.
- Add Open, Saved and Backups to the existing 440 × 580 toolbar popup.
- Save a whole website or custom stack, keep its pages open or explicitly save and close, and reopen missing links later.
- Add local window backups and Undo for recent category moves.

No new permissions, host access, content scripts or remote services are added. Saved stacks and backups now retain complete URLs and titles locally; update the dashboard privacy disclosures and the public privacy policy before submission.

Validation: 28 unit tests and all 14 browser scenarios passed, including a regression for temporary tab-edit locks and cancellation when the user changes focus. The new regression failed before the fix. Computer Use also verified expansion and collapse with a 600 ms held mouse click in an isolated Chrome for Testing window. Manifest, syntax and permission checks passed. Automated tests use isolated profiles and demonstration pages.

This addresses reproducible recovery, duplicate-stack and native logo-click cases. The logo assets and existing expand/collapse interface are unchanged.

## Submission

1. Update the existing Stacks item in the Chrome Web Store developer dashboard; do not create a new item or extension ID.
2. Upload `stacks-0.9.0.zip` as the extension package.
3. Update the description from `listing-en.txt`, screenshots from `screenshots/`, and the relevant privacy/permission fields from `review-notes-en.md`.
4. Publish the updated root `PRIVACY.md` at the listing's existing GitHub privacy-policy URL and verify it is publicly readable.
5. Submit for review. The currently published version remains available until the update is published.

Reference: https://developer.chrome.com/docs/webstore/update
