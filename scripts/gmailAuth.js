/**
 * gmailAuth.js — One-time Gmail OAuth2 authorization script.
 *
 * Run once:  node scripts/gmailAuth.js
 *
 * This opens a browser URL, you approve access,
 * paste the code back, and token.json is saved.
 * Never needs to be run again (token auto-refreshes).
 */

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CREDENTIALS_PATH = path.join(ROOT, "credentials.json");
const TOKEN_PATH = path.join(ROOT, "token.json");

// Gmail scopes needed — readonly is enough for OTP extraction
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`\n❌ credentials.json not found at: ${CREDENTIALS_PATH}`);
    console.error("Download it from Google Cloud Console → APIs & Services → Credentials\n");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const creds = raw.installed || raw.web;

  if (!creds) {
    console.error("❌ Invalid credentials.json format");
    process.exit(1);
  }

  const oAuth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris[0]
  );

  if (fs.existsSync(TOKEN_PATH)) {
    console.log("✅ token.json already exists.");
    console.log("   Delete it and re-run this script if you need to re-authorize.\n");
    process.exit(0);
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force refresh_token to be returned
  });

  console.log("\n─────────────────────────────────────────────────────");
  console.log("  Gmail OAuth2 Setup — Nubokind Invoice Automation");
  console.log("─────────────────────────────────────────────────────\n");
  console.log("1. Open this URL in your browser:\n");
  console.log("   " + authUrl);
  console.log("\n2. Sign in with isha@nubokind.com");
  console.log("3. Click Allow / Continue");
  console.log("4. Copy the authorization code from the page\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("5. Paste the authorization code here: ", async (code) => {
    rl.close();
    code = code.trim();

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log("\n✅ token.json saved successfully!");
      console.log("   You can now run: npm start\n");
    } catch (err) {
      console.error("\n❌ Failed to exchange code for token:", err.message);
      console.error("   Make sure you copied the full code and try again.\n");
      process.exit(1);
    }
  });
}

main();