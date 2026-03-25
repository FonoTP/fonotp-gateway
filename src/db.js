import pg from "pg";

const { Pool } = pg;

export class Database {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      application_name: "fonotp-webrtc-gateway"
    });
  }

  async close() {
    await this.pool.end();
  }

  async getAuthorizedSession(token, now = new Date()) {
    const query = `
      select
        s.id as session_id,
        s.user_id,
        s.expires_at,
        u.email,
        u.display_name,
        sa.service_key,
        sa.ws_endpoint,
        sa.allowed as service_allowed
      from user_sessions s
      join users u on u.id = s.user_id
      join service_authorizations sa on sa.user_id = s.user_id
      where s.token_hash = crypt($1, s.token_hash)
        and s.revoked_at is null
        and s.expires_at > $2
        and sa.allowed = true
    `;

    const { rows } = await this.pool.query(query, [token, now]);
    return rows;
  }

  async getAuthorizedServices(token, now = new Date()) {
    const rows = await this.getAuthorizedSession(token, now);
    if (rows.length === 0) {
      return null;
    }

    const [{ user_id: userId, email, display_name: displayName, expires_at: expiresAt }] = rows;
    return {
      userId,
      email,
      displayName,
      expiresAt,
      services: rows.map((row) => ({
        serviceKey: row.service_key,
        wsEndpoint: row.ws_endpoint
      }))
    };
  }

  async getGatewaySession(sessionId) {
    const query = `
      select
        id,
        user_id,
        service_key,
        ws_endpoint,
        status,
        expires_at
      from gateway_sessions
      where id = $1
    `;
    const { rows } = await this.pool.query(query, [sessionId]);
    return rows[0] ?? null;
  }

  async createGatewaySession(input) {
    const query = `
      insert into gateway_sessions (
        id,
        user_id,
        auth_session_id,
        service_key,
        ws_endpoint,
        status,
        expires_at,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    `;

    const values = [
      input.id,
      input.userId,
      input.authSessionId,
      input.serviceKey,
      input.wsEndpoint,
      input.status,
      input.expiresAt,
      input.metadata
    ];
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }

  async updateGatewaySessionStatus(sessionId, status, metadata = null) {
    const query = `
      update gateway_sessions
      set status = $2,
          metadata = coalesce($3, metadata),
          updated_at = now()
      where id = $1
    `;
    await this.pool.query(query, [sessionId, status, metadata]);
  }
}
