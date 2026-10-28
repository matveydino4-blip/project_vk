require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const { router: quizzesRoutes } = require("./routes/quizzes");
const roomsRoutes = require("./routes/rooms");
const registerRoomHandlers = require("./socket/roomManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/quizzes", quizzesRoutes);
app.use("/api/rooms", roomsRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Отдаём собранный фронтенд (папка public в корне проекта).
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

registerRoomHandlers(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Quiz app server listening on http://localhost:${PORT}`);
});
