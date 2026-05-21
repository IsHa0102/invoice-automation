/**
 * gmailClient.js
 * Loads OAuth2 credentials and token for Gmail API access.
 * Supports auto-refresh of expired tokens.
 */

import { google } from "googleapis";
import fs from "fs";
import { ENV } from "../../config/env.js";
import { debug, log } from "../../utils/logger.js";

function loadCredentials() {
  if (!fs.existsSync(ENV.GMAIL_CREDENTIALS_PATH)) {
    throw new Error(
      `credentials.json not found at: ${ENV.GMAIL_CREDENTIALS_PATH}\n` +
      `Run: node scripts/gmailAuth.js  to set up OAuth`
    );
  }

  const raw = JSON.parse(fs.readFileSync(ENV.GMAIL_CREDENTIALS_PATH, "utf8"));

  // Support both "installed" (Desktop app) and "web" credential types
  const creds = raw.installed || raw.web;
  if (!creds) {
    throw new Error("credentials.json format unrecognised — expected 'installed' or 'web' key");
  }

  return {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: creds.redirect_uris[0],
  };
}

export async function getGmailAuth() {
  const { client_id, client_secret, redirect_uri } = loadCredentials();

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  if (!fs.existsSync(ENV.GMAIL_TOKEN_PATH)) {
    throw new Error(
      `token.json not found at: ${ENV.GMAIL_TOKEN_PATH}\n` +
      `Run: node scripts/gmailAuth.js  to authorise Gmail access`
    );
  }

  debug(`Loading Gmail token from ${ENV.GMAIL_TOKEN_PATH}`);
  const token = JSON.parse(fs.readFileSync(ENV.GMAIL_TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);

  // Auto-save refreshed tokens
  oAuth2Client.on("tokens", (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(ENV.GMAIL_TOKEN_PATH, "utf8"));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(ENV.GMAIL_TOKEN_PATH, JSON.stringify(merged, null, 2));
    log("Gmail token auto-refreshed and saved");
  });

  return oAuth2Client;
}

export async function getGmailAuthForToken(tokenPath) {
  const { client_id, client_secret, redirect_uri } = loadCredentials();
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Token not found at: ${tokenPath}\n` +
      `Run: node scripts/gmailAuthDigital.js  to authorise this account`
    );
  }

  debug(`Loading Gmail token from ${tokenPath}`);
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oAuth2Client.setCredentials(token);

  oAuth2Client.on("tokens", (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
    log("Gmail token auto-refreshed and saved");
  });

  return oAuth2Client;
}

export function getOAuthClient() {
  const { client_id, client_secret, redirect_uri } = loadCredentials();
  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}