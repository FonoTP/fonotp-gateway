import { randomUUID } from "node:crypto";

export async function registerRoutes(app, { controlPlane, gateway, config }) {
  app.get("/health", async () => ({
    status: "ok",
    service: "webrtc-gateway",
    requestId: randomUUID()
  }));

  app.post("/api/soniox-temporary-key", async (request, reply) => {
    if (!config.sonioxApiKey) {
      return reply.code(500).send({ error: "SONIOX_API_KEY is required for Soniox STT." });
    }

    try {
      const response = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.sonioxApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          usage_type: "transcribe_websocket",
          expires_in_seconds: 60
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return reply.code(response.status).send({
          error: payload?.error_message || payload?.error || "Failed to create Soniox temporary key."
        });
      }

      return {
        apiKey: payload.api_key,
        model: config.sonioxRealtimeModel
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to create Soniox temporary key");
      return reply.code(500).send({ error: error.message || "Unexpected Soniox key error." });
    }
  });

  app.post("/api/webrtc/session", async (request, reply) => {
    try {
      const { voiceToken, offerSdp, caller, language = "en", sttProvider = "openai" } = request.body ?? {};

      if (!voiceToken || !offerSdp) {
        return reply.code(400).send({
          error: "voiceToken and offerSdp are required"
        });
      }

      const resolvedSession = await controlPlane.resolveVoiceToken(voiceToken);
      const result = await gateway.createSession({
        resolvedSession,
        offerSdp,
        caller,
        language,
        sttProvider
      });

      return reply.code(201).send({
        ...result,
        language,
        sttProvider,
        agent: {
          id: resolvedSession.agent.id,
          name: resolvedSession.agent.name,
          voice: resolvedSession.agent.ttsVoice,
          model: resolvedSession.agent.llmType
        }
      });
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to create WebRTC gateway session");
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  app.post("/api/webrtc/session/:sessionId/report", async (request, reply) => {
    try {
      const result = await gateway.saveReport(request.params.sessionId, request.body ?? {});
      return reply.code(201).send(result);
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to persist WebRTC gateway report");
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  app.delete("/api/webrtc/session/:sessionId", async (request, reply) => {
    try {
      await gateway.closeSession(request.params.sessionId, "cancelled");
      return reply.code(204).send();
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      request.log.error({ err: error }, "Failed to close WebRTC gateway session");
      return reply.code(statusCode).send({ error: error.message });
    }
  });
}
