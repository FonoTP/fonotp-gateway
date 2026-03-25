import WebSocket, { WebSocketServer } from "ws";

const port = Number(process.env.MOCK_VOICE_PORT ?? 9000);
const host = process.env.MOCK_VOICE_HOST ?? "127.0.0.1";
const FRAME_TYPE_PCM = 0x01;
const FRAME_TYPE_PING = 0x02;
const SAMPLE_RATE = 48000;
const FRAME_SIZE = 480;
const ECHO_DELAY_FRAMES = 35;
const IDLE_CHIRP_INTERVAL_MS = 4000;

function createPcmFrame(samples) {
  const frame = Buffer.allocUnsafe(samples.length * 2 + 1);
  frame.writeUInt8(FRAME_TYPE_PCM, 0);

  for (let index = 0; index < samples.length; index += 1) {
    frame.writeInt16LE(samples[index], 1 + index * 2);
  }

  return frame;
}

function buildToneSamples(frequency, frameIndex, amplitude = 0.18) {
  const samples = new Int16Array(FRAME_SIZE);

  for (let sampleIndex = 0; sampleIndex < FRAME_SIZE; sampleIndex += 1) {
    const t = (frameIndex * FRAME_SIZE + sampleIndex) / SAMPLE_RATE;
    const value = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    samples[sampleIndex] = Math.round(value * 32767);
  }

  return samples;
}

function parsePcmFrame(buffer) {
  const sampleCount = Math.floor((buffer.length - 1) / 2);
  const samples = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(1 + index * 2);
  }

  return samples;
}

function scaleSamples(samples, gain) {
  const output = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.round(samples[index] * gain);
    output[index] = Math.max(-32768, Math.min(32767, value));
  }

  return output;
}

function averageLevel(samples) {
  let total = 0;

  for (let index = 0; index < samples.length; index += 1) {
    total += Math.abs(samples[index]);
  }

  return total / samples.length;
}

const wss = new WebSocketServer({ host, port });

wss.on("connection", (socket) => {
  let frameIndex = 0;
  let lastOutboundChirpAt = 0;
  let mode = "greeting";
  let greetingStep = 0;
  let inboundFrameCount = 0;
  let outboundFrameCount = 0;
  const echoQueue = [];
  const greetingPlan = [
    { frames: 18, frequency: 523.25, amplitude: 0.24 },
    { frames: 8, frequency: 0, amplitude: 0 },
    { frames: 18, frequency: 659.25, amplitude: 0.24 },
    { frames: 8, frequency: 0, amplitude: 0 },
    { frames: 20, frequency: 783.99, amplitude: 0.24 },
    { frames: 25, frequency: 0, amplitude: 0 },
    { frames: 22, frequency: 659.25, amplitude: 0.18 },
    { frames: 22, frequency: 523.25, amplitude: 0.18 }
  ];

  console.log("Mock voice client connected");

  socket.send(
    JSON.stringify({
      type: "mock.voice.connected",
      mode,
      message: "Mock voice service online. Greeting will play first, then delayed echo mode."
    })
  );

  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (mode === "greeting") {
      const step = greetingPlan[greetingStep];
      const samples =
        step.frequency === 0
          ? new Int16Array(FRAME_SIZE)
          : buildToneSamples(step.frequency, frameIndex, step.amplitude);

      socket.send(createPcmFrame(samples));
      outboundFrameCount += 1;
      step.frames -= 1;
      frameIndex += 1;

      if (step.frames <= 0) {
        greetingStep += 1;
      }

      if (greetingStep >= greetingPlan.length) {
        mode = "echo";
        socket.send(
          JSON.stringify({
            type: "mock.voice.mode",
            mode,
            message: "Greeting finished. Delayed echo mode is active. Speak and listen for your voice to return."
          })
        );
      }

      return;
    }

    if (echoQueue.length > ECHO_DELAY_FRAMES) {
      const delayedSamples = echoQueue.shift();
      socket.send(createPcmFrame(delayedSamples));
      outboundFrameCount += 1;
      frameIndex += 1;
      return;
    }

    if (Date.now() - lastOutboundChirpAt > IDLE_CHIRP_INTERVAL_MS) {
      lastOutboundChirpAt = Date.now();
      socket.send(createPcmFrame(buildToneSamples(392.0, frameIndex, 0.08)));
      outboundFrameCount += 1;
      frameIndex += 1;
    }
  }, 10);

  const statsInterval = setInterval(() => {
    console.log(
      `Mock voice stats inbound_frames=${inboundFrameCount} outbound_frames=${outboundFrameCount} mode=${mode} echo_queue=${echoQueue.length}`
    );
  }, 2000);

  socket.on("message", (raw, isBinary) => {
    if (!isBinary) {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "gateway.session.started") {
          console.log(`Gateway session started ${message.sessionId}`);
          socket.send(
            JSON.stringify({
              type: "mock.voice.session",
              sessionId: message.sessionId,
              mode,
              message: "Gateway session acknowledged by mock voice service."
            })
          );
        }
      } catch {}

      return;
    }

    if (!Buffer.isBuffer(raw) || raw.length < 1) {
      return;
    }

    const frameType = raw.readUInt8(0);
    if (frameType === FRAME_TYPE_PCM) {
      const samples = parsePcmFrame(raw);
      inboundFrameCount += 1;

      if (mode !== "echo") {
        return;
      }

      if (averageLevel(samples) < 250) {
        return;
      }

      echoQueue.push(scaleSamples(samples, 0.72));

      if (echoQueue.length === ECHO_DELAY_FRAMES + 1) {
        socket.send(
          JSON.stringify({
            type: "mock.voice.mode",
            mode,
            message: "Voice detected. Returning delayed echo."
          })
        );
      }

      return;
    }

    if (frameType === FRAME_TYPE_PING) {
      socket.send(Buffer.from([FRAME_TYPE_PING]));
    }
  });

  socket.on("close", () => {
    clearInterval(interval);
    clearInterval(statsInterval);
    console.log("Mock voice client disconnected");
  });
});

wss.on("listening", () => {
  console.log(`Mock voice service listening on ws://${host}:${port}`);
});
