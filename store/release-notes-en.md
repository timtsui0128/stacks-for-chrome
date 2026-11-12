# Stacks 0.9.0

Resubmitted for review on 12 November 2026 as version **0.9.0** of the existing Chrome Web Store item `jgpebokkiodhcjjmflmhmoolimmaoldh`. At the user's request, the previous review was cancelled and its draft package replaced with the compact-stack performance fix. Chrome confirmed **Your extension was submitted for review**, with automatic publication after approval enabled. The saved description, privacy disclosures, reviewer instructions and all four screenshots were retained. The store icon and promotional images were also preserved. Published version 0.8.1 remains available until the update is published.

Resubmitted package SHA-256: `e33e97018e91f763ebad7873f78c67bf6394e60362d9e2b711f29039344556a0` (53,355 bytes).

The withdrawn package had SHA-256 `92bea91988b9efef3a7d173dfcd4e5550676ad44ba3599cd5ec478c0eaa36960`.

- Merge duplicate website stacks when their automatic ownership can be verified.
- Reconnect a surviving website-logo control tab to its native group after Chrome changes group and tab IDs. Explicit custom categories remain independent.
- Preserve the existing logo-click interaction when Chrome temporarily blocks tab edits during mouse-down: retry expansion, collapse and focus changes after release, and cancel if the user selects another page.
- Reduce compact-stack toggle latency by reusing the minimized holding window and each live stack's marker, and refreshing only the affected logo tab. Clean up unused holding windows when their source window closes or compact stacks are disabled; safely recreate a holding window if the user closes it while empty.
- Add Open, Saved and Backups to the existing 440 × 580 toolbar popup.
- Save a whole website or custom stack, keep its pages open or explicitly save and close, and reopen missing links later.
- Add local window backups and Undo for recent category moves.

No new permissions, host access, content scripts or remote services are added. Saved stacks and backups now retain complete URLs and titles locally; the dashboard privacy disclosures and public privacy policy were updated before submission.

Validation: 28 unit tests and all 14 browser scenarios passed, including a regression for temporary tab-edit locks and cancellation when the user changes focus. The new regression failed before the fix. Computer Use also verified expansion and collapse with a 600 ms held mouse click in an isolated Chrome for Testing window. Manifest, syntax and permission checks passed. Automated tests use isolated profiles and demonstration pages.

The performance regression failed before the fix and now verifies reuse of the same minimized window and markers, preservation of live tab IDs and unsaved text, recovery after manually closing the empty holding window, and cleanup after disabling stacks, closing a cover or closing its source window. All 14 browser scenarios were checked against the final performance code. In small isolated API-driven samples, repeated collapse took 36–68 ms after the fix versus 271–289 ms in two baseline runs, with one baseline outlier at 1,224 ms; six-stack samples fell from 195–253 ms to 42–50 ms. These measurements are not a guarantee for arbitrary user pages.

The resubmitted ZIP was verified byte-for-byte against the source. Compared with the withdrawn ZIP, only `src/background.js`, `src/compact.js` and `src/cover.js` changed. All UI markup, CSS, icon assets, popup code, manifest and permissions are byte-identical; the existing click controls and expand/collapse interaction are preserved.

## Submission

1. Updated the existing Stacks item; retained its extension ID and public, free distribution.
2. Cancelled the first 0.9.0 review, verified **Review cancelled**, and uploaded the replacement `stacks-0.9.0.zip` with the resubmitted SHA-256 recorded above. Verified draft version 0.9.0 and published version 0.8.1, with the same permissions.
3. Saved the description from `listing-en.txt`, replaced screenshots 3–4 from `screenshots/`, and updated the relevant privacy/permission fields and reviewer instructions.
4. Verified the updated root `PRIVACY.md` was publicly readable at the listing's existing GitHub privacy-policy URL.
5. Resubmitted for review with automatic publication after approval checked and verified Chrome's **Your extension was submitted for review** confirmation.

[Developer dashboard](https://chrome.google.com/webstore/devconsole/a02b655d-7aee-47b5-9093-afc281cb3efe/jgpebokkiodhcjjmflmhmoolimmaoldh/edit/status) · [Store listing](https://chromewebstore.google.com/detail/jgpebokkiodhcjjmflmhmoolimmaoldh)

Reference: https://developer.chrome.com/docs/webstore/update
