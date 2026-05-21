/**
 * gmailAttachmentFetcher.js
 * Generic service: searches Gmail for invoice emails from a given sender
 * and downloads PDF attachments for the requested months.
 */

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { log, warn } from "../../utils/logger.js";

function monthRange(year, month) {
  const after      = `${year}/${String(month).padStart(2, "0")}/01`;
  const nextMonth  = month === 12 ? 1 : month + 1;
  const nextYear   = month === 12 ? year + 1 : year;
  const before     = `${nextYear}/${String(nextMonth).padStart(2, "0")}/01`;
  return { after, before };
}

function collectPdfParts(payload, results = []) {
  if (!payload) return results;
  const isPdf =
    payload.mimeType === "application/pdf" ||
    (payload.filename && payload.filename.toLowerCase().endsWith(".pdf"));
  if (isPdf && payload.body?.attachmentId) {
    results.push(payload);
  }
  if (payload.parts) {
    for (const p of payload.parts) collectPdfParts(p, results);
  }
  return results;
}

/**
 * @param {object}          opts
 * @param {object}          opts.auth              - OAuth2 client from getGmailAuthForToken()
 * @param {string}          opts.from              - sender email to filter
 * @param {string|Function} [opts.subjectContains] - broad Gmail keyword(s), or fn({year,month})=>string
 * @param {Function}        [opts.subjectValidator] - fn({year,month,subject})=>bool — JS-side subject check
 * @param {boolean}         [opts.skipDateFilter]  - skip after:/before: date range
 * @param {boolean}         [opts.hasAttachment]   - include has:attachment in Gmail query (default true)
 * @param {Array}           opts.months            - [{ year, month }]
 * @param {string}          opts.downloadDir       - folder to save files
 * @returns {Promise<string[]>}
 */
export async function downloadInvoiceAttachments({ auth, from, subjectContains, subjectValidator, skipDateFilter = false, hasAttachment = true, months, downloadDir }) {
  const gmail = google.gmail({ version: "v1", auth });
  fs.mkdirSync(downloadDir, { recursive: true });

  const downloaded = [];

  for (const { year, month } of months) {
    const subjectKw = subjectContains == null
      ? ""
      : typeof subjectContains === "function"
        ? subjectContains({ year, month })
        : subjectContains;

    const subjectClause = subjectKw ? ` ${subjectKw}` : "";
    const dateClause    = skipDateFilter ? "" : (() => {
      const { after, before } = monthRange(year, month);
      return ` after:${after} before:${before}`;
    })();
    const fromClause = Array.isArray(from)
      ? `(${from.map(f => `from:${f}`).join(" OR ")})`
      : `from:${from}`;
    const attachClause = hasAttachment ? " has:attachment" : "";
    const query = `${fromClause}${subjectClause}${attachClause}${dateClause}`;
    log(`[GmailFetcher] Searching: ${query}`);

    const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 50, includeSpamTrash: true });
    const messages = listRes.data.messages || [];

    if (!messages.length) {
      warn(`[GmailFetcher] No emails found from ${from} — check sender address or Gmail account`);
      continue;
    }

    log(`[GmailFetcher] Found ${messages.length} email(s), applying filters…`);

    for (const { id: messageId } of messages) {
      const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });

      // JS-side subject check — handles apostrophes, spaces, any formatting Gmail can't tokenize
      if (subjectValidator) {
        const subjectHeader = msg.data.payload.headers?.find(h => h.name.toLowerCase() === "subject");
        const subject = subjectHeader?.value || "";
        log(`[GmailFetcher] Subject: "${subject}"`);
        if (!subjectValidator({ year, month, subject })) {
          log(`[GmailFetcher] Skipped (month filter)`);
          continue;
        }
      }

      const pdfParts = collectPdfParts(msg.data.payload);

      for (const part of pdfParts) {
        const filename = part.filename || `invoice-${from.split("@")[0]}-${year}-${String(month).padStart(2, "0")}.pdf`;
        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: part.body.attachmentId,
        });

        // Gmail API returns base64url — convert to standard base64
        const base64 = attRes.data.data.replace(/-/g, "+").replace(/_/g, "/");
        const buffer = Buffer.from(base64, "base64");
        const filePath = path.join(downloadDir, filename);
        fs.writeFileSync(filePath, buffer);
        log(`[GmailFetcher] Saved: ${filePath}`);
        downloaded.push(filePath);
      }
    }
  }

  return downloaded;
}
