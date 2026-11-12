# Stacks 0.9.0

Submitted for review on 12 November 2026 as an update to the existing Chrome Web Store item `jgpebokkiodhcjjmflmhmoolimmaoldh`. The dashboard confirmed **Pending review**, with automatic publication after approval enabled. The description, permission justifications and reviewer test instructions were saved, the public privacy policy was verified, and screenshots 3–4 were replaced with the prepared 0.9.0 images. The store icon, promotional images and screenshots 1–2 were preserved. Published version 0.8.1 remains available until the update is published.

Uploaded package SHA-256: `92bea91988b9efef3a7d173dfcd4e5550676ad44ba3599cd5ec478c0eaa36960`.

- Merge duplicate website stacks when their automatic ownership can be verified.
- Reconnect a surviving website-logo control tab to its native group after Chrome changes group and tab IDs. Explicit custom categories remain independent.
- Preserve the existing logo-click interaction when Chrome temporarily blocks tab edits during mouse-down: retry expansion, collapse and focus changes after release, and cancel if the user selects another page.
- Add Open, Saved and Backups to the existing 440 × 580 toolbar popup.
- Save a whole website or custom stack, keep its pages open or explicitly save and close, and reopen missing links later.
- Add local window backups and Undo for recent category moves.

No new permissions, host access, content scripts or remote services are added. Saved stacks and backups now retain complete URLs and titles locally; the dashboard privacy disclosures and public privacy policy were updated before submission.

Validation: 28 unit tests and all 14 browser scenarios passed, including a regression for temporary tab-edit locks and cancellation when the user changes focus. The new regression failed before the fix. Computer Use also verified expansion and collapse with a 600 ms held mouse click in an isolated Chrome for Testing window. Manifest, syntax and permission checks passed. Automated tests use isolated profiles and demonstration pages.

This addresses reproducible recovery, duplicate-stack and native logo-click cases. The logo assets and existing expand/collapse interface are unchanged.

## Submission

1. Updated the existing Stacks item; retained its extension ID and public, free distribution.
2. Uploaded `stacks-0.9.0.zip` with the SHA-256 recorded above.
3. Saved the description from `listing-en.txt`, replaced screenshots 3–4 from `screenshots/`, and updated the relevant privacy/permission fields and reviewer instructions.
4. Verified the updated root `PRIVACY.md` was publicly readable at the listing's existing GitHub privacy-policy URL.
5. Submitted for review with automatic publication after approval enabled and verified the dashboard's **Pending review** status.

[Developer dashboard](https://chrome.google.com/webstore/devconsole/a02b655d-7aee-47b5-9093-afc281cb3efe/jgpebokkiodhcjjmflmhmoolimmaoldh/edit/status) · [Store listing](https://chromewebstore.google.com/detail/jgpebokkiodhcjjmflmhmoolimmaoldh)

Reference: https://developer.chrome.com/docs/webstore/update
