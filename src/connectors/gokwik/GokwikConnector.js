import fs from "fs";
import path from "path";
import { BaseConnector } from "../base/BaseConnector.js";
import { getGmailAuthForToken } from "../../services/gmail/gmailClient.js";
import { downloadInvoiceAttachments } from "../../services/gmail/gmailAttachmentFetcher.js";
import { ENV } from "../../config/env.js";
import { log } from "../../utils/logger.js";

const SENDERS      = ["billing@gokwik.in", "billing@gokwik.co"];
const DOWNLOAD_DIR = path.join(ENV.DOWNLOAD_PATH, "gokwik");
const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export class GokwikConnector extends BaseConnector {
  constructor() {
    super({
      id: "gokwik",
      name: "GoKwik",
      description: "Checkout platform · RTO invoices",
      emoji: "🛒",
      available: true,
    });
  }

  getInfo() {
    return {
      ...super.getInfo(),
      account: "digital@nubokind.com",
      tokenConfigured: fs.existsSync(ENV.GMAIL_DIGITAL_TOKEN_PATH),
      sender: SENDERS.join(", "),
    };
  }

  async run(params = {}) {
    const months = params.months?.length ? params.months : [];
    if (!months.length) throw new Error("No months specified for GoKwik invoice download");

    log(`[GoKwik] Fetching invoices for ${months.length} month(s) from ${SENDERS.join(", ")}`);
    const auth = await getGmailAuthForToken(ENV.GMAIL_DIGITAL_TOKEN_PATH);

    const files = await downloadInvoiceAttachments({
      auth,
      from: SENDERS,
      subjectContains: null,
      hasAttachment: false,
      subjectValidator: ({ month, subject }) => {
        const s = subject.toLowerCase();
        return s.includes("commission invoice") && s.includes(SHORT_MONTHS[month - 1].toLowerCase());
      },
      skipDateFilter: true,
      months,
      downloadDir: DOWNLOAD_DIR,
    });

    log(`[GoKwik] Done — ${files.length} file(s) downloaded`);
    return { downloaded: files };
  }
}
