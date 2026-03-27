export class ControlPlaneClient {
  constructor({ baseUrl, runtimeToken }) {
    this.baseUrl = baseUrl;
    this.runtimeToken = runtimeToken;
  }

  async resolveVoiceToken(voiceToken) {
    const response = await fetch(`${this.baseUrl}/api/internal/voice/resolve-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.runtimeToken}`
      },
      body: JSON.stringify({ voiceToken })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Failed to resolve voice token");
      error.statusCode = response.status;
      throw error;
    }

    return payload;
  }

  async persistCallReport(report) {
    const response = await fetch(`${this.baseUrl}/api/internal/voice/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.runtimeToken}`
      },
      body: JSON.stringify(report)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Failed to persist call report");
      error.statusCode = response.status;
      throw error;
    }

    return payload;
  }

  async createCallSession(input) {
    const response = await fetch(`${this.baseUrl}/api/internal/voice/callsessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.runtimeToken}`
      },
      body: JSON.stringify(input)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Failed to create call session");
      error.statusCode = response.status;
      throw error;
    }

    return payload;
  }
}
