import WebSocket from "ws";

const FRAME_TYPE_PCM = 0x01;
const FRAME_TYPE_PING = 0x02;

function int16ToBuffer(samples) {
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], index * 2);
  }
  return buffer;
}

function bufferToInt16Array(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2);
  }
  return samples;
}

export class AudioBridge {
  constructor({ sessionId, wsUrl, wsFactory = (url) => new WebSocket(url), logger }) {
    this.sessionId = sessionId;
    this.wsUrl = wsUrl;
    this.wsFactory = wsFactory;
    this.logger = logger;
    this.ws = null;
    this.controlMessageHandler = null;
  }

  async connect() {
    this.ws = this.wsFactory(this.wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.send(
      JSON.stringify({
        type: "gateway.session.started",
        sessionId: this.sessionId
      })
    );
  }

  onInboundAudio(handler) {
    this.ws.on("message", (raw, isBinary) => {
      if (!isBinary) {
        this.handleControlMessage(raw.toString());
        return;
      }

      if (!Buffer.isBuffer(raw) || raw.length < 1) {
        return;
      }

      const frameType = raw.readUInt8(0);
      if (frameType === FRAME_TYPE_PCM) {
        handler(bufferToInt16Array(raw.subarray(1)));
        return;
      }

      if (frameType === FRAME_TYPE_PING) {
        this.ws.send(Buffer.from([FRAME_TYPE_PING]));
      }
    });
  }

  onControlMessage(handler) {
    this.controlMessageHandler = handler;
  }

  sendPcmFrame(samples) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = int16ToBuffer(samples);
    const frame = Buffer.concat([Buffer.from([FRAME_TYPE_PCM]), payload]);
    this.ws.send(frame);
  }

  close() {
    if (!this.ws) {
      return;
    }

    this.ws.close();
    this.ws = null;
  }

  handleControlMessage(raw) {
    if (!this.controlMessageHandler) {
      return;
    }

    try {
      this.controlMessageHandler(JSON.parse(raw));
    } catch (error) {
      this.logger?.warn?.({ err: error }, "Failed to parse downstream control message");
    }
  }
}
