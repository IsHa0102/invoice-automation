import { BaseConnector } from './base/BaseConnector.js';
import { EshopboxConnector } from './eshopbox/EshopboxConnector.js';
import { GokwikConnector } from './gokwik/GokwikConnector.js';
import { EasebuzzConnector } from './easebuzz/EasebuzzConnector.js';
import { KwikengageConnector } from './kwikengage/KwikengageConnector.js';

class StubConnector extends BaseConnector {
  constructor(cfg) {
    super({ ...cfg, available: false });
  }
  async run() {
    throw new Error(`${this.name} connector is not yet implemented`);
  }
}

const connectors = new Map();

// Active connectors
connectors.set('eshopbox',    new EshopboxConnector());
connectors.set('gokwik',      new GokwikConnector());
connectors.set('easebuzz',    new EasebuzzConnector());
connectors.set('kwikengage',  new KwikengageConnector());

// Upcoming connectors — visible in UI, not yet runnable
for (const cfg of [
  { id: 'amazon',     name: 'Amazon',     description: 'Seller Central · settlements',           emoji: '🛍️' },
  { id: 'shiprocket', name: 'Shiprocket', description: 'Shipping platform · logistics invoices', emoji: '🚀' },
  { id: 'razorpay',   name: 'Razorpay',   description: 'Payment gateway · receipts',             emoji: '💳' },
]) {
  connectors.set(cfg.id, new StubConnector(cfg));
}

export function getConnector(id) {
  return connectors.get(id) || null;
}

export function listConnectors() {
  return [...connectors.values()].map(c => c.getInfo());
}
