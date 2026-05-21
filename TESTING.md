# Eshopbox Workflow Testing

## App Shape

This repository is a Node.js automation project, not a frontend/backend web app. It drives the external Eshopbox app with Playwright and reads OTP emails through the Gmail API.

- Frontend pages/components: none in this repo; the UI is `https://auth.myeshopbox.com/auth/login`.
- Backend APIs/routes/controllers: none in this repo.
- Auth provider/service: Eshopbox email OTP, with Gmail API used to fetch the OTP.
- OTP generation: performed by Eshopbox externally.
- OTP verification/session creation: performed by Eshopbox externally in the browser.
- Database/Supabase tables: none found in this repo.
- Worker/cron: `src/scheduler/cron.js` exists but is empty and not required.

## Ports Used

No local ports are used. The workflow opens a Playwright browser and navigates to Eshopbox.

## Required Files And Secrets

Required:

- `.env` with `ESHOPBOX_EMAIL`

Required for automatic OTP fetching:

- `credentials.json`: Google OAuth client credentials with Gmail API access.
- `token.json`: OAuth token for the Gmail inbox receiving Eshopbox OTPs.

Optional local testing fallback:

- `ESHOPBOX_MANUAL_OTP=true` lets you type the OTP in the terminal.
- `ESHOPBOX_DEV_OTP=123456` bypasses Gmail fetching and enters that OTP automatically. This only works if it matches the real OTP expected by Eshopbox.

## Install

```bash
npm.cmd install
npx.cmd playwright install chromium
```

PowerShell on this machine blocks the `npm.ps1` shim, so use `npm.cmd` and `npx.cmd`.

## Run

```bash
npm.cmd run eshopbox
```

Equivalent:

```bash
node scripts/runEshopbox.js
```

## Exact URL To Open

You do not need to open a local URL. The automation opens:

```text
https://auth.myeshopbox.com/auth/login
```

## Test Email Flow

1. Confirm `.env` contains `ESHOPBOX_EMAIL`.
2. For automatic OTP, place valid `credentials.json` and `token.json` in the project root.
3. Run `npm.cmd run eshopbox`.
4. Browser opens Eshopbox.
5. Automation enters the email.
6. Eshopbox sends an OTP.
7. Automation tries to fetch OTP from Gmail.
8. If Gmail is not configured and `ESHOPBOX_MANUAL_OTP=true`, enter the OTP in the terminal.
9. Automation submits the OTP.
10. Session state is saved to `eshopbox-session.json`.
11. Automation navigates to Billing and tries to download the invoice.

## Known Issues

- Eshopbox selectors may need adjustment if the live UI text differs from `Continue`, `Verify`, `Billing`, or `Download`.
- Gmail OTP fetch cannot work until valid Google OAuth files are added.
- No local database or Supabase connection exists in this repo.
- Invoice download may require manual navigation once if the Billing route cannot be located from the current UI.
