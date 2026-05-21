/**
 * imapService.js
 * Connects to Gmail via IMAP using App Password authentication.
 * Polls the inbox for new OTP emails and returns raw email content.
 */

import Imap from "node-imap";
import { simpleParser } from "mailparser";
import { ENV } from "../../config/env.js";
import { debug, error, log, warn } from "../../utils/logger.js";

// Tracks connection health for dashboard
const imapState = {
  connected: false,
  lastConnectAttempt: null,
  lastError: null,
  totalEmailsScanned: 0,
};

export function getImapState() {
  return { ...imapState };
}

/**
 * Fetch the latest N unread emails from Gmail IMAP that match a sender filter.
 * Returns array of parsed email objects: { subject, from, date, text, html, uid }
 */
export async function fetchRecentEmails({ maxResults = 5, fromFilter = null, sinceMinutes = 15 } = {}) {
  return new Promise((resolve, reject) => {
    imapState.lastConnectAttempt = new Date().toISOString();

    const imap = new Imap({
      user: ENV.EMAIL_USER,
      password: ENV.EMAIL_APP_PASSWORD,
      host: ENV.IMAP_HOST,
      port: ENV.IMAP_PORT,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000,
      authTimeout: 15000,
    });

    const emails = [];

    function done(err) {
      imapState.connected = false;
      if (err) {
        imapState.lastError = err.message;
        error(`IMAP error: ${err.message}`);
        return reject(err);
      }
      resolve(emails);
    }

    imap.once("ready", () => {
      imapState.connected = true;
      imapState.lastError = null;
      log("IMAP connection established");

      imap.openBox("INBOX", false, (err, box) => {
        if (err) return done(err);

        debug(`INBOX open — total: ${box.messages.total}, new: ${box.messages.new}`);

        // Build search criteria
        const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
        const sinceStr = since.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        const criteria = [["SINCE", sinceStr]];

        imap.search(criteria, (err, uids) => {
          if (err) return done(err);

          if (!uids || uids.length === 0) {
            debug(`No emails found in last ${sinceMinutes} minutes`);
            imap.end();
            return;
          }

          // Take the latest N
          const targetUids = uids.slice(-maxResults);
          debug(`Found ${uids.length} recent emails, fetching ${targetUids.length}`);

          const fetch = imap.fetch(targetUids, { bodies: "", markSeen: false });
          const pending = [];

          fetch.on("message", (msg, seqno) => {
            const chunks = [];
            let uid = null;

            msg.on("attributes", (attrs) => {
              uid = attrs.uid;
            });

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => chunks.push(chunk));
            });

            const p = new Promise((res) => {
              msg.once("end", async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  const parsed = await simpleParser(raw);
                  const fromAddr = parsed.from?.text || "";

                  if (fromFilter && !fromAddr.toLowerCase().includes(fromFilter.toLowerCase())) {
                    debug(`Skipping email from ${fromAddr} (filter: ${fromFilter})`);
                    return res(null);
                  }

                  imapState.totalEmailsScanned++;
                  res({
                    uid,
                    seqno,
                    subject: parsed.subject || "",
                    from: fromAddr,
                    date: parsed.date || new Date(),
                    text: parsed.text || "",
                    html: parsed.html || "",
                  });
                } catch (e) {
                  warn(`Failed to parse email seqno ${seqno}: ${e.message}`);
                  res(null);
                }
              });
            });

            pending.push(p);
          });

          fetch.once("error", done);

          fetch.once("end", async () => {
            const results = await Promise.all(pending);
            const valid = results.filter(Boolean);
            emails.push(...valid);
            debug(`Parsed ${valid.length} emails from IMAP`);
            imap.end();
          });
        });
      });
    });

    imap.once("error", done);
    imap.once("end", () => {
      imapState.connected = false;
      debug("IMAP connection closed");
    });

    imap.connect();
  });
}