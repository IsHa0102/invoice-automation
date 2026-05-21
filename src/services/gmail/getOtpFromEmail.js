/**
 * getOtpFromEmail.js
 * Fetches recent emails from Gmail API and extracts OTP.
 * Uses the same otpExtractor logic as the IMAP path.
 */

import { google } from "googleapis";
import { ENV } from "../../config/env.js";
import { debug, log, warn } from "../../utils/logger.js";
import { extractOtpFromEmail, isOtpUsed, recordOtp } from "../otp/otpExtractor.js";

/**
 * Fetch recent emails matching the OTP query and extract OTP.
 * @param {object} auth - OAuth2 client from getGmailAuth()
 * @returns {Promise<{otp: string, entryId: number}>}
 */
export async function getOtpFromEmail(auth) {
  const gmail = google.gmail({ version: "v1", auth });

  debug(`Searching Gmail for OTP — query: ${ENV.GMAIL_OTP_QUERY}`);

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 10,
    q: ENV.GMAIL_OTP_QUERY,
  });

  if (!res.data.messages || res.data.messages.length === 0) {
    throw new Error("No OTP emails found matching query: " + ENV.GMAIL_OTP_QUERY);
  }

  debug(`Found ${res.data.messages.length} candidate emails`);

  for (const msg of res.data.messages) {
    const msgData = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = msgData.data.payload?.headers || [];
    const subject = headers.find(h => h.name === "Subject")?.value || "";
    const from = headers.find(h => h.name === "From")?.value || "";
    const dateStr = headers.find(h => h.name === "Date")?.value || "";

    // Extract body text
    let text = "";
    let html = "";

    function extractParts(parts) {
      if (!parts) return;
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          text += Buffer.from(part.body.data, "base64").toString("utf8");
        } else if (part.mimeType === "text/html" && part.body?.data) {
          html += Buffer.from(part.body.data, "base64").toString("utf8");
        } else if (part.parts) {
          extractParts(part.parts);
        }
      }
    }

    // Handle simple (non-multipart) emails
    if (msgData.data.payload?.body?.data) {
      const decoded = Buffer.from(msgData.data.payload.body.data, "base64").toString("utf8");
      if (msgData.data.payload.mimeType === "text/html") {
        html = decoded;
      } else {
        text = decoded;
      }
    }

    extractParts(msgData.data.payload?.parts);

    // Also try snippet as fallback
    const snippet = msgData.data.snippet || "";

    const email = {
      uid: msg.id,
      subject,
      from,
      date: dateStr ? new Date(dateStr) : new Date(),
      text: text || snippet,
      html,
    };

    debug(`Checking email: "${subject}" from ${from}`);

    const result = extractOtpFromEmail(email);
    if (!result) continue;

    const { otp, source, emailDate } = result;

    if (isOtpUsed(otp)) {
      debug(`OTP ${otp} already used — skipping`);
      continue;
    }

    const entry = recordOtp({ otp, source, emailDate, uid: msg.id, status: "extracted" });
    log(`OTP extracted via Gmail API: ${otp} (from: ${source})`);
    return { otp, entryId: entry.id };
  }

  throw new Error("OTP not found in any recent emails");
}