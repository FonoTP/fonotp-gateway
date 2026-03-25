import wrtc from "@roamhq/wrtc";
import { randomUUID } from "node:crypto";
import { AudioBridge } from "./audio-bridge.js";

const {
  RTCPeerConnection,
  RTCSessionDescription,
  nonstandard: { RTCAudioSink, RTCAudioSource }
} = wrtc;

const OUTBOUND_FRAME_SIZE = 480;

export class WebRtcGateway {
  constructor({ config, db, logger, sessionStore }) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.sessionStore = sessionStore;
  }

  async createSession({ authSession, offerSdp, serviceKey, wsEndpointOverride }) {
    const selectedService = authSession.find((row) => row.service_key === serviceKey);
    if (!selectedService) {
      const error = new Error(`Service "${serviceKey}" is not authorized for this session`);
      error.statusCode = 403;
      throw error;
    }

    const wsEndpoint = wsEndpointOverride ?? selectedService.ws_endpoint;
    this.assertServiceOriginAllowed(wsEndpoint);

    const gatewaySessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000);

    const peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers
    });
    const outboundAudioSource = new RTCAudioSource();
    const outboundTrack = outboundAudioSource.createTrack();
    peerConnection.addTrack(outboundTrack);

    const audioBridge = new AudioBridge({
      sessionId: gatewaySessionId,
      wsUrl: wsEndpoint,
      logger: this.logger
    });
    let inboundPcmFrames = 0;
    let outboundPcmFrames = 0;
    let lastAudioLogAt = Date.now();

    this.sessionStore.set(gatewaySessionId, {
      id: gatewaySessionId,
      peerConnection,
      outboundTrack,
      outboundAudioSource,
      audioBridge,
      userId: selectedService.user_id,
      serviceKey
    });

    await audioBridge.connect();
    audioBridge.onControlMessage(async (message) => {
      this.logger.info({ gatewaySessionId, message }, "Downstream control message");
      await this.db.updateGatewaySessionStatus(gatewaySessionId, "active", {
        email: selectedService.email,
        displayName: selectedService.display_name,
        downstream: message
      });
    });
    audioBridge.onInboundAudio((samples) => {
      inboundPcmFrames += 1;
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

    peerConnection.onconnectionstatechange = async () => {
      const state = peerConnection.connectionState;
      this.logger.info({ gatewaySessionId, state }, "WebRTC connection state changed");

      if (state === "connected") {
        await this.db.updateGatewaySessionStatus(gatewaySessionId, "connected");
      }

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

    await this.db.createGatewaySession({
      id: gatewaySessionId,
      userId: selectedService.user_id,
      authSessionId: selectedService.session_id,
      serviceKey,
      wsEndpoint,
      status: "pending",
      expiresAt,
      metadata: {
        email: selectedService.email,
        displayName: selectedService.display_name,
        downstream: {
          mode: "connecting"
        }
      }
    });

    return {
      sessionId: gatewaySessionId,
      answerSdp: peerConnection.localDescription.sdp,
      expiresAt
    };
  }

  async closeSession(sessionId, reason = "closed") {
    const session = this.sessionStore.get(sessionId);
    if (session) {
      session.sink?.stop?.();
      session.outboundTrack?.stop?.();
      session.audioBridge?.close?.();
      session.peerConnection?.close?.();
      this.sessionStore.delete(sessionId);
    }

    await this.db.updateGatewaySessionStatus(sessionId, reason, { closedReason: reason });
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
