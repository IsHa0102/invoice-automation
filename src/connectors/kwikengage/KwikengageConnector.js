import fs from "fs";
import { BaseConnector } from "../base/BaseConnector.js";
import { runKwikengageWorkflow } from "../../workflows/kwikengageWorkflow.js";
import { ENV } from "../../config/env.js";

export class KwikengageConnector extends BaseConnector {
  constructor() {
    super({
      id: "kwikengage",
      name: "KwikEngage",
      description: "Engagement platform · subscription invoices",
      emoji: "💬",
      available: true,
    });
  }

  getInfo() {
    return {
      ...super.getInfo(),
      account: ENV.KWIKENGAGE_EMAIL || "suditi@nubokind.com",
      sessionExists: fs.existsSync(ENV.KWIKENGAGE_SESSION_PATH),
    };
  }

  async run(params = {}) {
    const months = params.months?.length ? params.months : [];
    if (!months.length) throw new Error("No months specified for KwikEngage invoice download");
    return runKwikengageWorkflow(months);
  }
}
