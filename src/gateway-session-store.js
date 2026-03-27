export class GatewaySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  set(sessionId, session) {
    this.sessions.set(sessionId, session);
  }

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  values() {
    return this.sessions.values();
  }

  delete(sessionId) {
    this.sessions.delete(sessionId);
  }
}
