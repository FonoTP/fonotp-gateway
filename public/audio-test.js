const elements = {
  playTone: document.querySelector("#playTone"),
  loopMicElement: document.querySelector("#loopMicElement"),
  loopMicContext: document.querySelector("#loopMicContext"),
  stopAll: document.querySelector("#stopAll"),
  outputState: document.querySelector("#outputState"),
  toneState: document.querySelector("#toneState"),
  elementLoopState: document.querySelector("#elementLoopState"),
  contextLoopState: document.querySelector("#contextLoopState"),
  meterFill: document.querySelector("#meterFill"),
  micValue: document.querySelector("#micValue"),
  loopbackAudio: document.querySelector("#loopbackAudio"),
  log: document.querySelector("#log")
};

const state = {
  audioContext: null,
  oscillator: null,
  gainNode: null,
  toneTimeoutId: null,
  stream: null,
  meterCleanup: null,
  streamSourceNode: null,
  loopbackGainNode: null,
  loopbackMode: null
};

function log(message, details) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  elements.log.textContent += `${line}${suffix}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setOutputState(status) {
  elements.outputState.textContent = status;
  elements.outputState.dataset.state = status;
}

async function getAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  return state.audioContext;
}

async function playTone() {
  stopToneOnly();

  const audioContext = await getAudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 523.25;
  gainNode.gain.value = 0.08;

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();

  state.oscillator = oscillator;
  state.gainNode = gainNode;
  elements.toneState.textContent = "Playing 523 Hz tone";
  setOutputState("tone");
  log("Started local test tone");

  state.toneTimeoutId = window.setTimeout(() => {
    stopToneOnly();
    elements.toneState.textContent = "Tone finished";
    setOutputState(state.stream ? "loopback" : "idle");
    log("Finished local test tone");
  }, 2000);
}

async function loopMicElement() {
  stopLoopbackOnly();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  state.stream = stream;
  elements.loopbackAudio.srcObject = stream;
  elements.loopbackAudio.muted = false;
  elements.loopbackAudio.volume = 1;

  try {
    await elements.loopbackAudio.play();
  } catch (error) {
    log("Loopback playback blocked", { error: error.message });
  }

  startMicMeter(stream);
  state.loopbackMode = "element";
  elements.elementLoopState.textContent = "Looping live mic to speakers";
  elements.contextLoopState.textContent = "Not running";
  setOutputState("loopback");
  log("Started audio-element mic loopback");
}

async function loopMicContext() {
  stopLoopbackOnly();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const audioContext = await getAudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1;
  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  state.stream = stream;
  state.streamSourceNode = sourceNode;
  state.loopbackGainNode = gainNode;
  state.loopbackMode = "context";

  startMicMeter(stream);
  elements.elementLoopState.textContent = "Not running";
  elements.contextLoopState.textContent = "Looping mic through AudioContext";
  setOutputState("loopback");
  log("Started AudioContext mic loopback");
}

function stopToneOnly() {
  if (state.toneTimeoutId) {
    clearTimeout(state.toneTimeoutId);
    state.toneTimeoutId = null;
  }

  state.oscillator?.stop?.();
  state.oscillator?.disconnect?.();
  state.gainNode?.disconnect?.();
  state.oscillator = null;
  state.gainNode = null;
}

function stopLoopbackOnly() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }

  state.stream = null;
  state.streamSourceNode?.disconnect?.();
  state.loopbackGainNode?.disconnect?.();
  state.streamSourceNode = null;
  state.loopbackGainNode = null;
  state.loopbackMode = null;
  state.meterCleanup?.();
  state.meterCleanup = null;
  elements.loopbackAudio.pause();
  elements.loopbackAudio.srcObject = null;
  elements.meterFill.style.width = "0%";
  elements.micValue.textContent = "0%";
}

function stopAll() {
  stopToneOnly();
  stopLoopbackOnly();
  elements.toneState.textContent = "Stopped";
  elements.elementLoopState.textContent = "Stopped";
  elements.contextLoopState.textContent = "Stopped";
  setOutputState("idle");
  log("Stopped all diagnostics");
}

function startMicMeter(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  let frameId = 0;

  const render = () => {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;

    for (const value of data) {
      const normalized = (value - 128) / 128;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / data.length);
    const percent = Math.min(100, Math.round(rms * 180));
    elements.meterFill.style.width = `${percent}%`;
    elements.micValue.textContent = `${percent}%`;
    frameId = requestAnimationFrame(render);
  };

  render();

  state.meterCleanup = () => {
    cancelAnimationFrame(frameId);
    source.disconnect();
    analyser.disconnect();
    audioContext.close().catch(() => {});
  };
}

elements.playTone.addEventListener("click", async () => {
  try {
    await playTone();
  } catch (error) {
    setOutputState("error");
    log("Tone test failed", { error: error.message });
  }
});

elements.loopMicElement.addEventListener("click", async () => {
  try {
    await loopMicElement();
  } catch (error) {
    setOutputState("error");
    log("Audio-element loopback failed", { error: error.message });
  }
});

elements.loopMicContext.addEventListener("click", async () => {
  try {
    await loopMicContext();
  } catch (error) {
    setOutputState("error");
    log("AudioContext loopback failed", { error: error.message });
  }
});

elements.stopAll.addEventListener("click", stopAll);

elements.loopbackAudio.addEventListener("play", () => {
  log("Loopback audio element started playback");
});

elements.loopbackAudio.addEventListener("pause", () => {
  log("Loopback audio element paused");
});

log("Audio diagnostics ready");
