import wrtc from "@roamhq/wrtc";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AudioBridge } from "./audio-bridge.js";
import { WavFileWriter } from "./wav-file-writer.js";

const {
  RTCPeerConnection,
  RTCSessionDescription,
  nonstandard: { RTCAudioSink, RTCAudioSource }
} = wrtc;

const OUTBOUND_FRAME_SIZE = 480;

export class WebRtcGateway {
  constructor({ config, controlPlane, logger, sessionStore }) {
    this.config = config;
    this.controlPlane = controlPlane;
    this.logger = logger;
    this.sessionStore = sessionStore;
  }

  async createSession({ resolvedSession, offerSdp, caller, language, sttProvider }) {
    const wsEndpoint = resolvedSession.agent.runtimeUrl;
    this.assertServiceOriginAllowed(wsEndpoint);

    const gatewaySessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000);
    const reportToken = randomUUID();
    const { callSessionId } = await this.controlPlane.createCallSession({
      organizationId: resolvedSession.organization.id,
      platformUserId: resolvedSession.user.userId,
      agentId: resolvedSession.agent.id,
      runtimeSessionId: gatewaySessionId,
      language,
      sttProvider
    });

    const peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers
    });
    const outboundAudioSource = new RTCAudioSource();
    const outboundTrack = outboundAudioSource.createTrack();
    peerConnection.addTrack(outboundTrack);

    const audioBridge = new AudioBridge({
      sessionId: gatewaySessionId,
      wsUrl: wsEndpoint,
      startMessage: {
        sessionId: callSessionId
      },
      logger: this.logger
    });
    const downstreamRecording = await new WavFileWriter(
      join(this.config.recordingsDir, `${gatewaySessionId}-downstream.wav`)
    ).init();
    let inboundPcmFrames = 0;
    let outboundPcmFrames = 0;
    let lastAudioLogAt = Date.now();

    this.sessionStore.set(gatewaySessionId, {
      id: gatewaySessionId,
      peerConnection,
      outboundTrack,
      outboundAudioSource,
      audioBridge,
      downstreamRecording,
      reportToken,
      caller,
      language,
      sttProvider,
      resolvedSession,
      browserEventsChannel: null
    });

    await audioBridge.connect();
    audioBridge.onControlMessage((message) => {
      this.logger.info({ gatewaySessionId, message }, "Downstream control message");
      const session = this.sessionStore.get(gatewaySessionId);
      const channel = session?.browserEventsChannel;
      if (channel?.readyState === "open") {
        channel.send(JSON.stringify(message));
      }
    });
    audioBridge.onInboundAudio((samples) => {
      inboundPcmFrames += 1;
      downstreamRecording.appendSamples(samples);
      for (const chunk of splitSamples(samples, OUTBOUND_FRAME_SIZE)) {
        outboundAudioSource.onData({
          samples: chunk,
          bitsPerSample: 16,
          channelCount: 1,
          sampleRate: 48000,
          numberOfFrames: chunk.length
        });
      }

      if (Date.now() - lastAudioLogAt > 2000) {
        this.logger.info(
          { gatewaySessionId, inboundPcmFrames, outboundPcmFrames },
          "Audio bridge frame counters"
        );
        lastAudioLogAt = Date.now();
      }
    });

    peerConnection.ontrack = (event) => {
      const [remoteStreamTrack] = event.streams[0]?.getAudioTracks?.() ?? [];
      const track = remoteStreamTrack ?? event.track;

      if (track.kind !== "audio") {
        return;
      }

      const sink = new RTCAudioSink(track);
      sink.ondata = (frame) => {
        outboundPcmFrames += 1;
        audioBridge.sendPcmFrame(frame.samples);
      };

      this.sessionStore.set(gatewaySessionId, {
        ...this.sessionStore.get(gatewaySessionId),
        sink
      });
    };

    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;

      channel.onopen = () => {
        const session = this.sessionStore.get(gatewaySessionId);
        if (!session) {
          return;
        }

        this.sessionStore.set(gatewaySessionId, {
          ...session,
          browserEventsChannel: channel
        });

        channel.send(
          JSON.stringify({
            type: "gateway.session.ready",
            sessionId: gatewaySessionId,
            sttProvider,
            language
          })
        );
      };

      channel.onmessage = (rawEvent) => {
        try {
          const message = JSON.parse(rawEvent.data);
          if (message.type === "gateway.user_text") {
            audioBridge.sendControlMessage({
              type: "user_text",
              text: String(message.text || "")
            });
          }
        } catch (error) {
          this.logger.warn({ gatewaySessionId, err: error }, "Failed to parse browser control message");
        }
      };
    };

    peerConnection.onconnectionstatechange = async () => {
      const state = peerConnection.connectionState;
      this.logger.info({ gatewaySessionId, state }, "WebRTC connection state changed");

      if (["failed", "closed", "disconnected"].includes(state)) {
        await this.closeSession(gatewaySessionId, state);
      }
    };

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: offerSdp })
    );
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGatheringComplete(peerConnection);

    return {
      sessionId: gatewaySessionId,
      answerSdp: peerConnection.localDescription.sdp,
      expiresAt,
      reportToken
    };
  }

  async closeSession(sessionId, reason = "closed") {
    const session = this.sessionStore.get(sessionId);
    if (session) {
      session.sink?.stop?.();
      session.outboundTrack?.stop?.();
      session.audioBridge?.close?.();
      session.browserEventsChannel?.close?.();
      session.peerConnection?.close?.();
      await session.downstreamRecording?.close?.();
      this.sessionStore.delete(sessionId);
    }
  }

  getSession(sessionId) {
    return this.sessionStore.get(sessionId) ?? null;
  }

  async saveReport(sessionId, report) {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      const error = new Error("Gateway session not found");
      error.statusCode = 404;
      throw error;
    }

    if (report?.reportToken !== session.reportToken) {
      const error = new Error("Invalid report token");
      error.statusCode = 401;
      throw error;
    }

    const result = await this.controlPlane.persistCallReport({
      runtimeSessionId: sessionId,
      organizationId: session.resolvedSession.organization.id,
      platformUserId: session.resolvedSession.user.userId,
      agentId: session.resolvedSession.agent.id,
      caller: session.caller || "browser-client / unknown",
      status: report.status || "Completed",
      summary: report.summary || null,
      transcript: Array.isArray(report.transcript) ? report.transcript : [],
      startedAt: report.startedAt || new Date().toISOString(),
      endedAt: report.endedAt || new Date().toISOString(),
      charactersIn: Number(report.charactersIn) || 0,
      charactersOut: Number(report.charactersOut) || 0
    });

    await this.closeSession(sessionId, "reported");
    return result;
  }

  assertServiceOriginAllowed(wsUrl) {
    const parsed = new URL(wsUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;

    if (
      this.config.allowedServiceOrigins.length > 0 &&
      !this.config.allowedServiceOrigins.includes(origin)
    ) {
      const error = new Error(`Service origin ${origin} is not allowed`);
      error.statusCode = 403;
      throw error;
    }
  }
}

function splitSamples(samples, frameSize) {
  const chunks = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const chunk = samples.subarray(offset, offset + frameSize);
    if (chunk.length === frameSize) {
      chunks.push(new Int16Array(chunk));
    }
  }

  return chunks;
}

async function waitForIceGatheringComplete(peerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, 2000);

    function onStateChange() {
      if (peerConnection.iceGatheringState !== "complete") {
        return;
      }

      clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}
