const elements = {
  token: document.querySelector("#token"),
  service: document.querySelector("#service"),
  endpoint: document.querySelector("#endpoint"),
  loadProfile: document.querySelector("#loadProfile"),
  connect: document.querySelector("#connect"),
  disconnect: document.querySelector("#disconnect"),
  clearLog: document.querySelector("#clearLog"),
  statusBadge: document.querySelector("#statusBadge"),
  userLabel: document.querySelector("#userLabel"),
  serviceLabel: document.querySelector("#serviceLabel"),
  sessionLabel: document.querySelector("#sessionLabel"),
  modeLabel: document.querySelector("#modeLabel"),
  meterFill: document.querySelector("#meterFill"),
  micValue: document.querySelector("#micValue"),
  log: document.querySelector("#log"),
  remoteAudio: document.querySelector("#remoteAudio")
};

const state = {
  peerConnection: null,
  localStream: null,
  sessionId: null,
  token: "",
  meterCleanup: null
};

function log(message, details) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  elements.log.textContent += `${line}${suffix}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setStatus(status) {
  elements.statusBadge.textContent = status;
  elements.statusBadge.dataset.state = status;
}

function authHeader(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function loadBootstrap() {
  const token = elements.token.value.trim();
  if (!token) {
    throw new Error("Enter a bearer token first");
  }

  setStatus("authorizing");
  state.token = token;
  const response = await fetch("/api/demo/bootstrap", {
    headers: authHeader(token)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? "Failed to load profile");
  }

  const data = await response.json();
  elements.userLabel.textContent = `${data.displayName} (${data.email})`;
  elements.service.innerHTML = "";

  for (const service of data.services) {
    const option = document.createElement("option");
    option.value = service.serviceKey;
    option.textContent = service.serviceKey;
    option.dataset.endpoint = service.wsEndpoint;
    elements.service.append(option);
  }

  syncSelectedService();
  setStatus("idle");
  log("Loaded authorized profile", {
    user: data.email,
    serviceCount: data.services.length
  });
}

function syncSelectedService() {
  const option = elements.service.selectedOptions[0];
  const endpoint = option?.dataset.endpoint ?? "";
  elements.endpoint.value = endpoint;
  elements.serviceLabel.textContent = option?.value ?? "None";
}

function setModeLabel(message) {
  elements.modeLabel.textContent = message;
}

async function attemptRemotePlayback(reason) {
  elements.remoteAudio.autoplay = true;
  elements.remoteAudio.muted = false;
  elements.remoteAudio.volume = 1;

  try {
    await elements.remoteAudio.play();
    log("Remote audio playback started", { reason });
  } catch (error) {
    log("Remote audio playback blocked", {
      reason,
      error: error.message
    });
    setModeLabel("Remote stream arrived, but browser playback was blocked. Press play on the audio control.");
  }
}

async function connect() {
  if (state.peerConnection) {
    return;
  }

  const token = elements.token.value.trim();
  const serviceKey = elements.service.value;
  const wsEndpoint = elements.endpoint.value.trim();

  if (!token || !serviceKey) {
    throw new Error("Load an authorized profile first");
  }

  setStatus("connecting");
  elements.connect.disabled = true;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
  state.localStream = stream;
  startMicMeter(stream);

  const peerConnection = new RTCPeerConnection();
  state.peerConnection = peerConnection;

  for (const track of stream.getTracks()) {
    peerConnection.addTrack(track, stream);
  }

  peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    elements.remoteAudio.srcObject = remoteStream;
    setModeLabel("Remote audio attached. Waiting for startup melody.");
    log("Remote audio stream attached");
    void attemptRemotePlayback("remote-track");
  };

  peerConnection.onconnectionstatechange = () => {
    const connectionState = peerConnection.connectionState;
    log("Peer connection state changed", { connectionState });
    if (connectionState === "connected") {
      setStatus("connected");
      elements.disconnect.disabled = false;
      setModeLabel("Connected. Startup melody should play first.");
      return;
    }

    if (["failed", "disconnected", "closed"].includes(connectionState)) {
      setStatus(connectionState === "failed" ? "error" : "idle");
      cleanupRtc(false);
    }
  };

  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true
  });
  await peerConnection.setLocalDescription(offer);
  await waitForIceGatheringComplete(peerConnection);

  const response = await fetch("/api/webrtc/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token)
    },
    body: JSON.stringify({
      offerSdp: peerConnection.localDescription.sdp,
      serviceKey,
      wsEndpoint
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? "Failed to create gateway session");
  }

  const data = await response.json();
  state.sessionId = data.sessionId;
  elements.sessionLabel.textContent = data.sessionId;
  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: data.answerSdp
  });

  log("Gateway session created", {
    sessionId: data.sessionId,
    expiresAt: data.expiresAt
  });
  setModeLabel("Session created. If you hear the melody, the downstream service is live.");
}

async function disconnect(shouldDelete = true) {
  const { sessionId, token } = state;
  cleanupRtc(true);

  if (!shouldDelete || !sessionId || !token) {
    return;
  }

  const response = await fetch(`/api/webrtc/session/${sessionId}`, {
    method: "DELETE",
    headers: authHeader(token)
  });

  if (!response.ok && response.status !== 404) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? "Failed to close gateway session");
  }

  log("Gateway session closed", { sessionId });
}

function cleanupRtc(resetSessionLabel) {
  state.peerConnection?.close();
  state.peerConnection = null;

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      track.stop();
    }
  }

  state.localStream = null;
  state.meterCleanup?.();
  state.meterCleanup = null;
  elements.remoteAudio.srcObject = null;
  elements.disconnect.disabled = true;
  elements.connect.disabled = false;
  elements.meterFill.style.width = "0%";
  elements.micValue.textContent = "0%";
  setModeLabel("Waiting to connect");
  setStatus("idle");

  if (resetSessionLabel) {
    elements.sessionLabel.textContent = "None";
    state.sessionId = null;
  }
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

async function waitForIceGatheringComplete(peerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return;
  }

  await new Promise((resolve) => {
    function onStateChange() {
      if (peerConnection.iceGatheringState !== "complete") {
        return;
      }

      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}

elements.loadProfile.addEventListener("click", async () => {
  try {
    await loadBootstrap();
  } catch (error) {
    setStatus("error");
    log("Profile load failed", { error: error.message });
  }
});

elements.service.addEventListener("change", syncSelectedService);

elements.connect.addEventListener("click", async () => {
  try {
    await connect();
  } catch (error) {
    log("Connect failed", { error: error.message });
    cleanupRtc(false);
    setStatus("error");
  }
});

elements.disconnect.addEventListener("click", async () => {
  try {
    await disconnect(true);
  } catch (error) {
    log("Disconnect failed", { error: error.message });
    setStatus("error");
  }
});

elements.clearLog.addEventListener("click", () => {
  elements.log.textContent = "";
});

elements.remoteAudio.addEventListener("loadedmetadata", () => {
  log("Remote audio metadata loaded");
  void attemptRemotePlayback("loadedmetadata");
});

elements.remoteAudio.addEventListener("play", () => {
  log("Remote audio element entered play state");
});

elements.remoteAudio.addEventListener("pause", () => {
  log("Remote audio element paused");
});

elements.remoteAudio.addEventListener("error", () => {
  const mediaError = elements.remoteAudio.error;
  log("Remote audio element error", {
    code: mediaError?.code ?? null
  });
});

elements.token.value = "demo-user-token";
setModeLabel("Load profile, then connect to hear the melody and delayed echo.");
log("Demo ready");
