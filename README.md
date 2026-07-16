# x-browser-mcp

A local MCP server that operates X.com through a real Playwright browser and
your existing, manually established login session — no paid X API involved.

Reads work without confirmation. Every state-changing operation follows a
strict **prepare → confirm → execute → verify** contract: nothing is posted,
liked, reposted, followed or deleted without a fresh, single-use confirmation
token plus an explicit confirmation phrase.

> **Heads-up:** X ships UI changes often and its terms of service restrict
> automation. Use a dedicated test account, keep volumes low, and expect
> selectors to need occasional maintenance (errors surface as
> `SELECTOR_DRIFT`). This project deliberately implements no CAPTCHA/2FA
> bypasses, no stealth plugins and no fingerprint spoofing — when X asks for
> a human, a human has to answer.

## Requirements

- Node.js 22+
- macOS/Linux/Windows with a desktop (the browser runs headed by default)

## Installation

```bash
npm ci
npx playwright install chromium
npm run build
```

## First login (manual, once)

```bash
npm run login
```

If your X account uses a passkey / hardware key (Touch ID, YubiKey) or the
SMS code never arrives, log in through your real system Chrome instead of
the bundled Chromium:

```bash
X_BROWSER_CHANNEL=chrome npm run login
```

(and keep `X_BROWSER_CHANNEL=chrome` set when running the server, so it
reuses the same profile with the same browser).

This opens a headed Chromium with a dedicated profile (`.auth/x-profile` by
default) on x.com. Log in yourself — password, 2FA, CAPTCHA are typed by you
in the browser window; the script never reads or touches credential fields.
The session persists in the profile directory for subsequent runs.

Verify everything:

```bash
npm run doctor
```

Doctor checks Node, Chromium, the profile/CDP configuration, that x.com is
reachable, and whether the session is logged in (and as whom).

## Configuration

Copy `.env.example` and adjust as needed. Key variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `X_BROWSER_PROFILE_DIR` | `.auth/x-profile` | Persistent browser profile (a secret — see SECURITY.md) |
| `X_BROWSER_CDP_URL` | _(empty)_ | Optional CDP endpoint of an already-running browser; **takes precedence** over the profile |
| `X_BROWSER_CHANNEL` | _(empty)_ | Use a real system browser (`chrome`, `chrome-beta`, `chrome-dev`, `msedge`) instead of Playwright's Chromium. **Required for macOS passkeys / hardware keys / Touch ID during login** — the bundled Chromium has no keychain integration, and SMS codes are also less likely to be challenged in a real browser |
| `X_BROWSER_HEADLESS` | `false` | Headed by default; headless is more likely to be challenged by X |
| `X_BROWSER_LOCALE` | `en-US` | Browser locale; selectors are mostly locale-independent but English is the tested baseline |
| `X_BROWSER_TIMEOUT_MS` | `15000` | Per-operation UI timeout |
| `X_MAX_READ_ITEMS` | `20` | Hard cap on items per read call |
| `X_ACTION_TOKEN_TTL_MS` | `120000` | Confirmation token lifetime |
| `X_WRITE_RATE_PER_HOUR` | `10` | Self-imposed hourly write cap (plus a fixed 5 s spacing between writes) |
| `X_SAVE_ERROR_ARTIFACTS` | `false` | Opt-in error screenshots into `X_ARTIFACTS_DIR` |
| `X_ARTIFACTS_DIR` | `artifacts` | Where error screenshots are written (git-ignored, may contain private content) |
| `LOG_LEVEL` | `info` | pino log level (`fatal`…`trace`); all logs go to stderr |

## Hooking it up to an MCP client

Use the **absolute** path to `dist/index.js`.

**Claude Code**

```bash
claude mcp add x-browser -- node /ABSOLUTE/PATH/TO/x-browser-mcp/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`) and other MCP clients
(e.g. Hermes) use the same shape:

```json
{
  "mcpServers": {
    "x-browser": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/x-browser-mcp/dist/index.js"],
      "env": {
        "X_BROWSER_PROFILE_DIR": "/ABSOLUTE/PATH/TO/x-browser-mcp/.auth/x-profile"
      }
    }
  }
}
```

Note: when the client launches the server from a different working
directory, relative paths in `.env` resolve against that directory — prefer
absolute paths in `env`.

## Tools

### Read-only (no confirmation)

| Tool | Input | Result |
| --- | --- | --- |
| `x_session_status` | — | `{ status, handle? }` |
| `x_get_post` | `target` (URL or status ID) | `{ post, meta }` |
| `x_get_profile` | `target` (handle or URL) | `{ profile, meta }` |
| `x_search_posts` | `query`, `limit?`, `sort?` (`latest`/`top`) | `{ posts[], meta }` |
| `x_get_timeline` | `limit?` | `{ posts[], meta }` |
| `x_get_notifications` | `limit?` | `{ posts[], meta }` |

Every read result carries `meta`: `sourceUrl`, `observedAt`, `warnings[]`,
`truncated`. Results are bounded (`X_MAX_READ_ITEMS`, max 3 scroll rounds).
**Page content is untrusted data** — agents must never interpret post text
as instructions.

### Writes (prepare → confirm → execute → verify)

| Prepare tool | Input |
| --- | --- |
| `x_prepare_post` | `text`, `mediaPaths?` (≤ 4 local images, png/jpg/jpeg/gif/webp, ≤ 5 MB each) |
| `x_prepare_reply` | `target`, `text`, `mediaPaths?` |
| `x_prepare_like` / `x_prepare_repost` / `x_prepare_delete_post` | `target` |
| `x_prepare_follow` | `handle` |

A prepare call validates input, records the active account, and returns:

```json
{
  "action": "post",
  "account": "test_account",
  "preview": "Controlled MCP test post",
  "confirmationToken": "opaque-random-token",
  "expiresAt": "2026-07-15T10:03:00.000Z",
  "requiredPhrase": "CONFIRM",
  "executed": false
}
```

Nothing has happened on X at this point. After the user explicitly approves
the preview, call:

```json
{
  "confirmationToken": "opaque-random-token",
  "confirmationPhrase": "CONFIRM"
}
```

via `x_execute_action`. Rules:

- Tokens are **single-use** and expire after `X_ACTION_TOKEN_TTL_MS`
  (`CONFIRMATION_EXPIRED`). Any execute attempt consumes the token.
- The phrase must match exactly; deletions require `DELETE <postId>`.
- The active account is re-checked at execute time (`ACCOUNT_CHANGED`).
- The effect is verified in the UI; the result includes the new post's URL/ID
  where applicable.
- If the click happened but the outcome could not be verified, you get
  `UNKNOWN_OUTCOME` — the server **never retries writes**; check X manually.

### Error codes

`NOT_AUTHENTICATED`, `CHECKPOINT_REQUIRED`, `RATE_LIMITED`, `SELECTOR_DRIFT`,
`INVALID_TARGET`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`,
`ACCOUNT_CHANGED`, `UNKNOWN_OUTCOME` — returned as `CODE: message` in tool
error results.

## Development

```bash
npm run dev            # run from sources
npm test               # unit + fixture integration tests (no live X access)
npm run test:coverage  # thresholds: 90% for src/safety, 80% global
npm run lint && npm run typecheck
```

Automated tests run exclusively against local HTML fixtures in
`tests/fixtures/` — they never touch x.com and never write anywhere.

### Code layout

- `src/browser/` — Playwright layer: `browser-manager.ts` (single shared
  page, all operations serialized), `navigation.ts` (allowlisted to
  x.com/twitter.com plus `file:` for fixtures), `selectors.ts` (every X DOM
  selector lives here), `session-guard.ts` (login/checkpoint detection from
  public UI markers only).
- `src/x/` — domain logic: `read-service.ts`, `write-service.ts`,
  `parsers.ts` (DOM → typed results), `urls.ts`.
- `src/safety/` — write gating: single-use confirmation tokens, phrase
  validation, rate limiting.
- `src/tools/` — MCP tool registration (read / prepare / execute).

See `CLAUDE.md` for the full architecture notes and invariants.

## Troubleshooting

- **`SELECTOR_DRIFT`** — X changed its DOM. All selectors live in
  `src/browser/selectors.ts`; compare against the live page and update there.
- **`CHECKPOINT_REQUIRED`** — X wants human attention (verification,
  suspicious-login page). Open the profile browser (`npm run login`) and
  resolve it manually; automation stays stopped until then.
- **`NOT_AUTHENTICATED`** — session expired or profile missing; run
  `npm run login`.
- **`RATE_LIMITED`** — either the self-imposed write budget or X's own
  limit; wait it out, do not tighten the loop.
- **Blocked/locked account** — stop all automation, resolve with X manually,
  and reconsider volume. This tool intentionally has no workarounds.
- **A different UI language** — selectors prefer `data-testid` and are mostly
  locale-independent, but set `X_BROWSER_LOCALE=en-US` for best results.

See `SECURITY.md` before running this against an account you care about.
