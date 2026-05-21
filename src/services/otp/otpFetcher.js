/**
 * otpFetcher.js
 * Orchestrates Gmail API email fetching + OTP extraction.
 * Includes retry logic, timeout handling, and anti-replay protection.
 */

import { getGmailAuth } from "../gmail/gmailClient.js";
import { getOtpFromEmail } from "../gmail/getOtpFromEmail.js";
import { markOtpUsed, updateOtpStatus } from "./otpExtractor.js";
import { debug, error, log, warn } from "../../utils/logger.js";
import { ENV } from "../../config/env.js";

/**
 * Fetch and extract a fresh OTP via Gmail API.
 * Polls up to maxAttempts times with delayMs between attempts.
 *
 * @returns {Promise<{otp: string, entryId: number}>}
 * @throws if no OTP found after all retries
 */
export async function fetchOtpViaImap({
  maxAttempts = 5,
  delayMs = 5000,
  sinceMinutes = 15,
  fromFilter = "eshopbox",
} = {}) {
  log(`Starting OTP fetch via Gmail API (max ${maxAttempts} attempts, every ${delayMs / 1000}s)`);

  let auth;
  try {
    auth = await getGmailAuth();
  } catch (err) {
    throw new Error(`Gmail auth failed: ${err.message}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    debug(`OTP fetch attempt ${attempt}/${maxAttempts}`);

    try {
      const result = await getOtpFromEmail(auth);
      return result;
    } catch (err) {
      if (err.message.includes("No OTP emails found") || err.message.includes("OTP not found")) {
        debug(`No OTP yet on attempt ${attempt} — ${err.message}`);
      } else {
        error(`Gmail API attempt ${attempt} failed: ${err.message}`);
      }

      if (attempt < maxAttempts) {
        debug(`Waiting ${delayMs / 1000}s before retry...`);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(`No OTP found after ${maxAttempts} attempts`);
}

/**
 * Mark an OTP as successfully submitted
 */
export function confirmOtpUsed(otp, entryId) {
  markOtpUsed(otp);
  if (entryId) updateOtpStatus(entryId, "submitted");
  log(`OTP ${otp} confirmed used`);
}

/**
 * Mark an OTP submission as failed
 */
export function failOtp(otp, entryId, reason) {
  if (entryId) updateOtpStatus(entryId, `failed: ${reason}`);
  warn(`OTP ${otp} submission failed: ${reason}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}