/**
 * BaseConnector — abstract base class for all platform integrations.
 * Every connector must extend this and implement run().
 */
export class BaseConnector {
  constructor({ id, name, description = '', supportsOtp = false, emoji = '🔌', available = true }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.supportsOtp = supportsOtp;
    this.emoji = emoji;
    this.available = available;
  }

  /**
   * Execute the connector's main workflow.
   * @param {object} params  Platform-specific run parameters
   */
  async run(params = {}) {
    throw new Error(`${this.constructor.name}.run() is not implemented`);
  }

  /** Return info for dashboard API — subclasses can extend this. */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      supportsOtp: this.supportsOtp,
      emoji: this.emoji,
      available: this.available,
    };
  }
}
