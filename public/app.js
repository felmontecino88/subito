// Inicialización de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const socket = io();
let localStream;
let peerConnections = {};
let myRole = "";
let myRoom = "";

// Variables PDF
let pdfDoc = null;
let pageNum = 1;
let autoSyncPdf = true;
const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const joinBtn = document.getElementById("joinBtn");
const videoInput = document.getElementById("videoInput");
const syncVideo = document.getElementById("syncVideo");
const pdfInput = document.getElementById("pdfInput");

let isSyncing = false;

// CAMBIO DE LAYOUTS DE PANTALLA
function changeLayout(layoutClass) {
  const room = document.getElementById("room");
  room.classList.remove("layout-1", "layout-2", "layout-3");
  room.classList.add(layoutClass);
}

joinBtn.onclick = async () => {
  myRoom = document.getElementById("roomId").value;
  myRole = document.getElementById("role").value;

  document.getElementById("setup").classList.add("hidden");
  document.getElementById("room").classList.remove("hidden");

  document.getElementById("roleBadge").innerText = myRole;
  document.getElementById("roomBadge").innerText = `Sala: ${myRoom}`;
  document.getElementById("myRoleTag").innerText = myRole;

  setupVideoSync();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
      video: { width: 320, height: 240 },
    });
  } catch (err) {
    console.warn("Audio/Video local no disponible:", err);
  }

  socket.emit("join-room", myRoom, myRole);
};

// --- MOTOR PDF.JS ---
pdfInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    const fileReader = new FileReader();
    fileReader.onload = function () {
      const typedarray = new Uint8Array(this.result);
      pdfjsLib.getDocument(typedarray).promise.then((pdf) => {
        pdfDoc = pdf;
        document.getElementById("pageCount").innerText = pdf.numPages;
        pageNum = 1;
        renderPage(pageNum);

        // Notificar cambio de página inicial
        if (myRole === "engineer" || myRole === "director") {
          emitPdfSync(pageNum);
        }
      });
    };
    fileReader.readAsArrayBuffer(file);
  }
};

function renderPage(num) {
  if (!pdfDoc) return;
  pdfDoc.getPage(num).then((page) => {
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = { canvasContext: ctx, viewport: viewport };
    page.render(renderContext);
    document.getElementById("pageNum").innerText = num;
  });
}

// --- EMITIR CAMBIO DE PÁGINA VÍA WEBSOCKETS ---
function emitPdfSync(page) {
  socket.emit("pdf-sync", {
    roomId: myRoom,
    page: page,
    senderRole: myRole,
  });
}

// Controladores de botones Pág Anterior / Siguiente (Solo una única declaración)
document.getElementById("prevPage").onclick = () => {
  if (pageNum <= 1) return;
  pageNum--;
  renderPage(pageNum);

  if (myRole === "engineer" || myRole === "director") {
    emitPdfSync(pageNum);
  }
};

document.getElementById("nextPage").onclick = () => {
  if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
  pageNum++;
  renderPage(pageNum);

  if (myRole === "engineer" || myRole === "director") {
    emitPdfSync(pageNum);
  }
};

// --- ESCUCHAR SINCRONIZACIÓN DE PDF REMOTA ---
socket.on("pdf-sync", (data) => {
  if (autoSyncPdf && pdfDoc) {
    if (data.page >= 1 && data.page <= pdfDoc.numPages) {
      pageNum = data.page;
      renderPage(pageNum);
    }
  }
});

document.getElementById("syncPdfCheck").onchange = (e) => {
  autoSyncPdf = e.target.checked;
};

// --- SINCRONIZACIÓN VIDEO ---
videoInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) syncVideo.src = URL.createObjectURL(file);
};

function setupVideoSync() {
  if (myRole === "engineer") {
    syncVideo.onplay = () => emitVideoSync("play");
    syncVideo.onpause = () => emitVideoSync("pause");
    syncVideo.onseeked = () => emitVideoSync("seek");
  }
}

function emitVideoSync(action) {
  if (isSyncing) return;
  socket.emit("video-sync", { action, currentTime: syncVideo.currentTime });
}

socket.on("video-sync", (data) => {
  if (myRole !== "engineer") {
    isSyncing = true;
    syncVideo.currentTime = data.currentTime;
    if (data.action === "play") syncVideo.play().catch(() => {});
    if (data.action === "pause") syncVideo.pause();
    setTimeout(() => {
      isSyncing = false;
    }, 200);
  }
});

// --- WEBRTC Y SALA ---
socket.on("user-connected", async ({ id, role }) => {
  const pc = createPeerConnection(id);
  peerConnections[id] = pc;
  if (localStream)
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: id, signal: offer });
});

socket.on("signal", async ({ from, signal }) => {
  let pc = peerConnections[from];
  if (!pc) {
    pc = createPeerConnection(from);
    peerConnections[from] = pc;
    if (localStream)
      localStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStream));
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
    if (e.candidate)
      socket.emit("signal", { to: id, signal: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    let container = document.getElementById(`peer-${id}`);
    if (!container) {
      container = document.createElement("div");
      container.id = `peer-${id}`;
      container.className = "peer-card";
      const remoteMedia = document.createElement("video");
      remoteMedia.autoplay = true;
      remoteMedia.srcObject = e.streams[0];
      container.appendChild(remoteMedia);
      document.getElementById("peersContainer").appendChild(container);
    }
  };
  return pc;
}
