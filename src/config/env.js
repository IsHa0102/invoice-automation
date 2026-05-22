/**
 * env.js — centralised environment variable config.
 * Reads from .env file via dotenv.
 */
import dotenv from "dotenv";

dotenv.config();

function readBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const ENV = {
  // eShop
  ESHOPBOX_BASE_URL: process.env.ESHOPBOX_BASE_URL || "https://auth.myeshopbox.com/auth/login",
  ESHOPBOX_INVOICE_URL: process.env.ESHOPBOX_INVOICE_URL || "https://billing.myeshopbox.com/portal/eshopbox/index#/invoices?filter_by=Status.Invoices",
  ESHOPBOX_EMAIL: process.env.ESHOPBOX_EMAIL || process.env.ESHOP_EMAIL,
  ESHOPBOX_PASSWORD: process.env.ESHOPBOX_PASSWORD,
  DOWNLOAD_PATH: process.env.DOWNLOAD_PATH || "./src/storage/downloaded",

  // Gmail IMAP (App Password) — new primary OTP method
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_APP_PASSWORD: process.env.EMAIL_APP_PASSWORD,
  IMAP_HOST: process.env.IMAP_HOST || "imap.gmail.com",
  IMAP_PORT: Number(process.env.IMAP_PORT || 993),
  IMAP_FROM_FILTER: process.env.IMAP_FROM_FILTER || "eshopbox",
  IMAP_SINCE_MINUTES: Number(process.env.IMAP_SINCE_MINUTES || 15),
  IMAP_MAX_ATTEMPTS: Number(process.env.IMAP_MAX_ATTEMPTS || 5),
  IMAP_POLL_INTERVAL_MS: Number(process.env.IMAP_POLL_INTERVAL_MS || 5000),

  // Legacy Gmail API (kept for backward compat, no longer required)
  GMAIL_CREDENTIALS_PATH: process.env.GMAIL_CREDENTIALS_PATH || "credentials.json",
  GMAIL_TOKEN_PATH: process.env.GMAIL_TOKEN_PATH || "token.json",
  GMAIL_DIGITAL_TOKEN_PATH: process.env.GMAIL_DIGITAL_TOKEN_PATH || "token-digital.json",
  GMAIL_OTP_QUERY: process.env.GMAIL_OTP_QUERY || "from:care@eshopbox.com newer_than:10m",

  // Dev overrides
  ESHOPBOX_DEV_OTP: process.env.ESHOPBOX_DEV_OTP,
  ESHOPBOX_MANUAL_OTP: readBoolean("ESHOPBOX_MANUAL_OTP", false),
  ESHOPBOX_HEADLESS: readBoolean("ESHOPBOX_HEADLESS", true),
  ESHOPBOX_SESSION_PATH: process.env.ESHOPBOX_SESSION_PATH || "eshopbox-session.json",
  ESHOPBOX_SKIP_DOWNLOAD: readBoolean("ESHOPBOX_SKIP_DOWNLOAD", false),

  // KwikEngage
  KWIKENGAGE_EMAIL:        process.env.KWIKENGAGE_EMAIL || "suditi@nubokind.com",
  KWIKENGAGE_PASSWORD:     process.env.KWIKENGAGE_PASSWORD,
  KWIKENGAGE_SESSION_PATH: process.env.KWIKENGAGE_SESSION_PATH || "kwikengage-session.json",

  // Google Drive
  DRIVE_TOKEN_PATH: process.env.DRIVE_TOKEN_PATH || "token-drive.json",
  DRIVE_FOLDER_ID:  process.env.DRIVE_FOLDER_ID || "",

  // Server
  UI_PORT: Number(process.env.UI_PORT || 3030),
};

export function validateEshopboxEnv() {
  const missing = [];
  if (!ENV.ESHOPBOX_EMAIL) missing.push("ESHOPBOX_EMAIL / ESHOP_EMAIL");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export function validateImapEnv() {
  const missing = [];
  if (!ENV.EMAIL_USER) missing.push("EMAIL_USER");
  if (!ENV.EMAIL_APP_PASSWORD) missing.push("EMAIL_APP_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`Missing IMAP environment variables: ${missing.join(", ")}`);
  }
}