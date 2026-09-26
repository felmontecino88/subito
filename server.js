const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // Unirse a una sala (Room)
  socket.on("join-room", (roomId, role) => {
    socket.join(roomId);
    socket.role = role;
    socket.to(roomId).emit("user-connected", { id: socket.id, role });

    // Sincronización de Video (Solo el Ingeniero transmite la orden)
    socket.on("video-sync", (data) => {
      socket.to(roomId).emit("video-sync", data);
    });

    // Señalización WebRTC (Offer, Answer, ICE Candidates)
    socket.on("signal", (data) => {
      io.to(data.to).emit("signal", {
        from: socket.id,
        signal: data.signal,
      });
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Servidor corriendo en http://localhost:${PORT}`),
);
