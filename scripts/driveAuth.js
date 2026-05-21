/**
 * driveAuth.js — One-time Google Drive OAuth2 authorization.
 *
 * Run once:  node scripts/driveAuth.js
 *
 * Starts a temporary local server, opens the Google consent page in your
 * browser, captures the auth code automatically, and saves token-drive.json.
 * No manual copy-pasting needed.
 */

import { google } from "googleapis";
import http        from "http";
import fs          from "fs";
import path        from "path";
import { exec }    from "child_process";
import { fileURLToPath } from "url";

const ROOT             = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS_PATH = path.join(ROOT, "credentials.json");
const TOKEN_PATH       = path.join(ROOT, "token-drive.json");

const PORT   = 9876;                           // temporary callback server port
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

function openBrowser(url) {
  // Windows: start, macOS: open, Linux: xdg-open
  const cmd = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) { /* silently ignored — user can open manually */ } });
}

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`\n❌ credentials.json not found at: ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  const raw   = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const creds = raw.installed || raw.web;
  if (!creds) { console.error("❌ Invalid credentials.json"); process.exit(1); }

  if (fs.existsSync(TOKEN_PATH)) {
    console.log("\n✅ token-drive.json already exists — Drive upload is enabled.");
    console.log("   Delete it and re-run this script to re-authorize.\n");
    process.exit(0);
  }

  // Use a loopback redirect URI — Google Desktop apps allow any port on localhost
  const redirectUri  = `http://localhost:${PORT}`;
  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n─────────────────────────────────────────────────────────");
  console.log("  Google Drive OAuth2 Setup — Nubokind Invoice Automation");
  console.log("─────────────────────────────────────────────────────────");
  console.log("\nOpening Google consent page in your browser…");
  console.log("Sign in with isha@nubokind.com and click Allow.\n");
  console.log("If the browser doesn't open, visit this URL manually:");
  console.log("  " + authUrl + "\n");

  openBrowser(authUrl);

  // Start a temporary server to capture the OAuth redirect
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url   = new URL(req.url, `http://localhost:${PORT}`);
      const code  = url.searchParams.get("code");
      const err   = url.searchParams.get("error");

      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h2 style="font-family:sans-serif;color:#ef4444">❌ Authorization failed: ${err}</h2><p>Close this tab and try again.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${err}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h2 style="font-family:sans-serif;color:#22c55e">✅ Authorized! You can close this tab.</h2><p>Return to the terminal to complete setup.</p>`);
        server.close();
        resolve(code);
      }
    });

    server.listen(PORT, "localhost", () => {
      console.log(`Waiting for Google to redirect back (listening on port ${PORT})…\n`);
    });

    // Timeout after 3 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization (3 min). Run the script again."));
    }, 180_000);
  });

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log("✅ token-drive.json saved!");
    console.log("   Google Drive upload is now enabled. Restart the automation server.\n");
  } catch (err) {
    console.error("❌ Failed to exchange code for token:", err.message);
    process.exit(1);
  }
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
