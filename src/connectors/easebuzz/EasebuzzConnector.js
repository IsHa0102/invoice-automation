import fs from "fs";
import path from "path";
import { BaseConnector } from "../base/BaseConnector.js";
import { getGmailAuthForToken } from "../../services/gmail/gmailClient.js";
import { downloadInvoiceAttachments } from "../../services/gmail/gmailAttachmentFetcher.js";
import { ENV } from "../../config/env.js";
import { log } from "../../utils/logger.js";

const SENDER       = "info@easebuzz.com";
const DOWNLOAD_DIR = path.join(ENV.DOWNLOAD_PATH, "easebuzz");
const FULL_MONTHS  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export class EasebuzzConnector extends BaseConnector {
  constructor() {
    super({
      id: "easebuzz",
      name: "Easebuzz",
      description: "Payment gateway · payout invoices",
      emoji: "💳",
      available: true,
    });
  }

  getInfo() {
    return {
      ...super.getInfo(),
      account: "digital@nubokind.com",
      tokenConfigured: fs.existsSync(ENV.GMAIL_DIGITAL_TOKEN_PATH),
      sender: SENDER,
    };
  }

  async run(params = {}) {
    const months = params.months?.length ? params.months : [];
    if (!months.length) throw new Error("No months specified for Easebuzz invoice download");

    log(`[Easebuzz] Fetching invoices for ${months.length} month(s) from ${SENDER}`);
    const auth = await getGmailAuthForToken(ENV.GMAIL_DIGITAL_TOKEN_PATH);

    const files = await downloadInvoiceAttachments({
      auth,
      from: SENDER,
      subjectContains: ({ year, month }) => `"GST Invoice" ${FULL_MONTHS[month - 1]} ${year}`,
      skipDateFilter: true,
      months,
      downloadDir: DOWNLOAD_DIR,
    });

    log(`[Easebuzz] Done — ${files.length} file(s) downloaded`);
    return { downloaded: files };
  }
}
