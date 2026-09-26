const socket = io();
let localStream;
let peerConnections = {};
let myRole = "";
let myRoom = "";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const joinBtn = document.getElementById("joinBtn");
const videoInput = document.getElementById("videoInput");
const syncVideo = document.getElementById("syncVideo");

// Variable para evitar bucles infinitos de sincronización entre ventanas
let isSyncing = false;

joinBtn.onclick = async () => {
  myRoom = document.getElementById("roomId").value;
  myRole = document.getElementById("role").value;

  document.getElementById("setup").classList.add("hidden");
  document.getElementById("room").classList.remove("hidden");

  // Configurar eventos del video SOLO después de definir el rol
  setupVideoSync();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
      video: { width: 480, height: 360 },
    });
  } catch (err) {
    console.warn(
      "No se detectó cámara/micrófono, continuando solo con datos...",
      err,
    );
  }

  socket.emit("join-room", myRoom, myRole);
};

// Cargar video local
videoInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    syncVideo.src = URL.createObjectURL(file);
  }
};

// --- FUNCIÓN DE SINCRONIZACIÓN DE VIDEO ---
function setupVideoSync() {
  if (myRole === "engineer") {
    // Si soy el ingeniero, transmito cada acción que hago sobre el reproductor
    syncVideo.onplay = () => emitVideoSync("play");
    syncVideo.onpause = () => emitVideoSync("pause");
    syncVideo.onseeked = () => emitVideoSync("seek");
  }
}

function emitVideoSync(action) {
  if (isSyncing) return;
  socket.emit("video-sync", {
    action: action,
    currentTime: syncVideo.currentTime,
  });
}

// ESCUCHAR COMANDOS DE VIDEO (Talento y Directora)
socket.on("video-sync", (data) => {
  // Solo los clientes que NO son ingeniero acatan la orden
  if (myRole !== "engineer") {
    isSyncing = true; // Bloquea disparos accidentales

    syncVideo.currentTime = data.currentTime;

    if (data.action === "play") {
      syncVideo
        .play()
        .catch((e) =>
          console.log("El navegador requiere interacción previa para Play", e),
        );
    } else if (data.action === "pause") {
      syncVideo.pause();
    }

    setTimeout(() => {
      isSyncing = false;
    }, 200);
  }
});

// --- LÓGICA WEBRTC (AUDIO/VIDEO CONEXIÓN) ---
socket.on("user-connected", async ({ id, role }) => {
  const pc = createPeerConnection(id);
  peerConnections[id] = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: id, signal: offer });
});

socket.on("signal", async ({ from, signal }) => {
  let pc = peerConnections[from];
  if (!pc) {
    pc = createPeerConnection(from);
    peerConnections[from] = pc;
    if (localStream) {
      localStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStream));
    }
  }

  if (signal.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, signal: answer });
  } else if (signal.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(signal));
  }
});

function createPeerConnection(id) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", { to: id, signal: { candidate: e.candidate } });
    }
  };

  pc.ontrack = (e) => {
    let container = document.getElementById(`peer-${id}`);
    if (!container) {
      container = document.createElement("div");
      container.id = `peer-${id}`;
      const remoteMedia = document.createElement("video");
      remoteMedia.autoplay = true;
      remoteMedia.srcObject = e.streams[0];
      container.appendChild(remoteMedia);
      document.getElementById("peersContainer").appendChild(container);
    }
  };

  return pc;
}
