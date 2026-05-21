/**
 * otpExtractor.js
 * Extracts OTP codes from email content.
 * Supports HTML and plain-text emails.
 * Prevents stale/duplicate OTP reuse.
 */

import { debug, error, log, warn } from "../../utils/logger.js";

// Track used OTPs to prevent replay
const usedOtps = new Set();

// History of extracted OTPs for dashboard
const otpHistory = [];
const MAX_HISTORY = 50;

const OTP_PATTERNS = [
  /\b(\d{6})\b(?=.*(?:otp|code|verify|verification|one.?time|token|login))/gi,
  /(?:otp|code|verification code|one.?time password)[^\d]{0,20}(\d{6})/gi,
  /(?:your|the)\s+(?:otp|code|verification)[^\d]{0,30}(\d{6})/gi,
  /\b(\d{6})\b/g, // fallback: any 6-digit number
];

/**
 * Strip HTML tags from a string
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to extract a 6-digit OTP from the given text body.
 * Returns the OTP string or null.
 */
function extractOtpFromText(text) {
  if (!text || text.trim().length === 0) return null;

  // Try patterns from most specific to least specific
  for (const pattern of OTP_PATTERNS) {
    pattern.lastIndex = 0; // reset for global regex
    const match = pattern.exec(text);
    if (match) {
      // Group 1 if capture group exists, otherwise full match
      const otp = match[1] || match[0];
      if (/^\d{6}$/.test(otp.trim())) {
        return otp.trim();
      }
    }
  }

  return null;
}

/**
 * Extract OTP from a parsed email object { text, html, subject, from, date, uid }
 * Returns { otp, source, emailDate, uid } or null
 */
export function extractOtpFromEmail(email) {
  const sources = [];

  // Try plain text first
  if (email.text) {
    sources.push({ content: email.text, source: "text" });
  }

  // Try stripped HTML
  if (email.html) {
    sources.push({ content: stripHtml(email.html), source: "html" });
  }

  // Also check subject
  if (email.subject) {
    sources.push({ content: email.subject, source: "subject" });
  }

  for (const { content, source } of sources) {
    const otp = extractOtpFromText(content);
    if (otp) {
      debug(`OTP "${otp}" extracted from email ${source} — from: ${email.from}, subject: "${email.subject}"`);
      return { otp, source, emailDate: email.date, uid: email.uid };
    }
  }

  warn(`Could not extract OTP from email: "${email.subject}" from ${email.from}`);
  return null;
}

/**
 * Check if an OTP has already been used
 */
export function isOtpUsed(otp) {
  return usedOtps.has(otp);
}

/**
 * Mark an OTP as used
 */
export function markOtpUsed(otp) {
  usedOtps.add(otp);
  debug(`OTP ${otp} marked as used`);
}

/**
 * Record an OTP in the history store
 */
export function recordOtp({ otp, source, emailDate, uid, used = false, status = "extracted" }) {
  const entry = {
    id: Date.now(),
    otp,
    source,
    emailDate: emailDate ? new Date(emailDate).toISOString() : null,
    uid,
    used,
    status,
    recordedAt: new Date().toISOString(),
  };
  otpHistory.unshift(entry);
  if (otpHistory.length > MAX_HISTORY) otpHistory.pop();
  return entry;
}

/**
 * Update the status of an OTP history entry by id
 */
export function updateOtpStatus(id, status) {
  const entry = otpHistory.find((e) => e.id === id);
  if (entry) {
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
  }
}

/**
 * Return the OTP history for dashboard consumption
 */
export function getOtpHistory() {
  return [...otpHistory];
}

/**
 * Clear all history and used OTPs (for testing)
 */
export function resetOtpState() {
  usedOtps.clear();
  otpHistory.length = 0;
}