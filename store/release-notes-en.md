# Stacks 0.9.0

Prepared on 12 November 2026. This update has not been uploaded or submitted for Chrome Web Store review.

- Merge duplicate website stacks when their automatic ownership can be verified.
- Reconnect a surviving website-logo control tab to its native group after Chrome changes group and tab IDs. Explicit custom categories remain independent.
- Add Open, Saved and Backups to the existing 440 × 580 toolbar popup.
- Save a whole website or custom stack, keep its pages open or explicitly save and close, and reopen missing links later.
- Add local window backups and Undo for recent category moves.

No new permissions, host access, content scripts or remote services are added. Saved stacks and backups now retain complete URLs and titles locally; update the dashboard privacy disclosures and the public privacy policy before submission.

Validation: 28 unit tests passed. All 13 browser scenarios were verified, with the five save/restore and reload scenarios passing two consecutive runs after asynchronous test waits were corrected. Tests use isolated profiles and demonstration pages.

This addresses reproducible recovery and duplicate-stack cases. The user's current Chrome profile has not been inspected or repaired in place.

## Submission

1. Update the existing Stacks item in the Chrome Web Store developer dashboard; do not create a new item or extension ID.
2. Upload `stacks-0.9.0.zip` as the extension package.
3. Update the description from `listing-en.txt`, screenshots from `screenshots/`, and the relevant privacy/permission fields from `review-notes-en.md`.
4. Publish the updated root `PRIVACY.md` at the listing's existing GitHub privacy-policy URL and verify it is publicly readable.
5. Submit for review. The currently published version remains available until the update is published.

Reference: https://developer.chrome.com/docs/webstore/update
