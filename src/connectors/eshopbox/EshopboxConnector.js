import fs from 'fs';
import { BaseConnector } from '../base/BaseConnector.js';
import { runEshopboxWorkflow } from '../../workflows/eshopboxWorkflow.js';
import { ENV } from '../../config/env.js';

export class EshopboxConnector extends BaseConnector {
  constructor() {
    super({
      id: 'eshopbox',
      name: 'eShopBox',
      description: 'Fulfillment platform · GST invoices',
      supportsOtp: true,
      emoji: '📦',
      available: true,
    });
  }

  async run(params = {}) {
    return runEshopboxWorkflow(params.months || []);
  }

  getInfo() {
    const base = super.getInfo();
    const sessionExists = fs.existsSync(ENV.ESHOPBOX_SESSION_PATH || 'eshopbox-session.json');
    const gmailConfigured =
      fs.existsSync(ENV.GMAIL_CREDENTIALS_PATH) && fs.existsSync(ENV.GMAIL_TOKEN_PATH);
    return { ...base, sessionExists, gmailConfigured, email: ENV.ESHOPBOX_EMAIL || null };
  }
}
