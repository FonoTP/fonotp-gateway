import { randomUUID } from "node:crypto";
import { AuthError, extractBearerToken, requireAuthorizedServiceSession } from "./auth.js";

export async function registerRoutes(app, { db, gateway, config }) {
  app.get("/health", async () => ({
    status: "ok",
    service: "webrtc-gateway",
    requestId: randomUUID()
  }));

  app.get("/api/demo/bootstrap", async (request, reply) => {
    try {
      const token = extractBearerToken(request, config.authBearerPrefix);
      const bootstrap = await db.getAuthorizedServices(token);

      if (!bootstrap) {
        return reply.code(401).send({ error: "Session not found or not authorized" });
      }

      return {
        ...bootstrap,
        bearerPrefix: config.authBearerPrefix
      };
    } catch (error) {
      const statusCode = error instanceof AuthError ? error.statusCode : error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to bootstrap demo session");
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  app.post("/api/webrtc/session", async (request, reply) => {
    try {
      const authorizedSessions = await requireAuthorizedServiceSession(request, db, config);
      const { offerSdp, serviceKey, wsEndpoint } = request.body ?? {};

      if (!offerSdp || !serviceKey) {
        return reply.code(400).send({
          error: "offerSdp and serviceKey are required"
        });
      }

      const result = await gateway.createSession({
        authSession: authorizedSessions,
        offerSdp,
        serviceKey,
        wsEndpointOverride: wsEndpoint
      });

      return reply.code(201).send(result);
    } catch (error) {
      const statusCode = error instanceof AuthError ? error.statusCode : error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to create WebRTC gateway session");
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  app.delete("/api/webrtc/session/:sessionId", async (request, reply) => {
    try {
      const authorizedSessions = await requireAuthorizedServiceSession(request, db, config);
      const gatewaySession = await db.getGatewaySession(request.params.sessionId);

      if (!gatewaySession) {
        return reply.code(404).send({ error: "Gateway session not found" });
      }

      const isOwner = authorizedSessions.some((session) => session.user_id === gatewaySession.user_id);
      if (!isOwner) {
        return reply.code(403).send({ error: "Not authorized to close this gateway session" });
      }

      await gateway.closeSession(request.params.sessionId, "cancelled");
      return reply.code(204).send();
    } catch (error) {
      const statusCode = error instanceof AuthError ? error.statusCode : error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to close WebRTC gateway session");
      return reply.code(statusCode).send({ error: error.message });
    }
  });
}
