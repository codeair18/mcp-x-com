# Security policy

## The browser profile is a secret

`X_BROWSER_PROFILE_DIR` (default `.auth/x-profile`) contains cookies and
localStorage that grant full access to the logged-in X account. Treat the
directory like a password:

- It is git-ignored (`.auth/`). **Never commit it**, never copy it into
  a repo, backup bucket or chat.
- Keep filesystem permissions restrictive; it lives outside any synced or
  shared folder ideally.
- To invalidate a possibly leaked session: log the session out from
  x.com → Settings → Security → Sessions, and delete the profile directory.

## Credentials

- The code never reads, types, stores or logs passwords or 2FA codes.
  Login happens manually in a headed browser (`npm run login`).
- There is deliberately no support for credential-based automation, CAPTCHA
  solving, stealth plugins or fingerprint spoofing.

## Logs and artifacts

- All logs go to stderr; the MCP protocol owns stdout.
- Logs never contain cookies, storage, request headers, page DOM or draft
  text. Draft posts are logged only as a short hash fingerprint plus length.
- Error screenshots are **off by default** and only written locally after
  opting in via `X_SAVE_ERROR_ARTIFACTS=true`. `artifacts/` is git-ignored;
  screenshots may contain private timeline content — review before sharing.

## Threat model

| Threat | Mitigation |
| --- | --- |
| **Prompt injection via page content** | Everything read from X (posts, bios, search results) is returned as data with an explicit "untrusted" note in tool descriptions. The server itself never derives actions from page text; agents must not either. |
| **Writing from the wrong account** | Each prepare records the active handle; execute re-reads it and fails with `ACCOUNT_CHANGED` on mismatch. |
| **Token replay** | Confirmation tokens are cryptographically random, stored only in RAM, expire after the TTL and are consumed on first use — including failed attempts. |
| **Selector drift** | All selectors are centralized; unexpected DOM states fail closed with `SELECTOR_DRIFT` instead of clicking the wrong element. |
| **Ambiguous write outcome** | Once a state-changing click happened, a verification failure yields `UNKNOWN_OUTCOME` and the server refuses to retry — preventing double posts/deletes. |
| **Runaway automation** | Writes are throttled (5 s spacing, 10/hour default), reads bounded (item caps, max 3 scrolls), retries limited to reads. |
| **Session theft** | Dedicated profile directory outside the repo, never logged, never uploaded. |

## Scope limits (by design)

- No CAPTCHA/2FA/anti-bot circumvention; `CHECKPOINT_REQUIRED` halts writes
  until a human resolves the checkpoint.
- No mass scraping or bulk automation; limits are intentionally low.
- No DMs, no private X endpoints, single account per server process.

## Reporting

This is a personal/local tool. If you find a vulnerability, open an issue or
contact the repository owner directly; do not include session material in
reports.
