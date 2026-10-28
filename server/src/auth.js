const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET не задан: в продакшне нельзя использовать dev-секрет");
}
const JWT_SECRET = process.env.JWT_SECRET || "dev_super_secret_change_me";
const TOKEN_TTL = "7d";

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

// Middleware: требует валидный Bearer-токен, кладёт req.user = { id, email, name }
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, email, name, role FROM User WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Недействительный или истёкший токен" });
  }
}

// Тот же принцип, но для Socket.IO handshake (используется хостом комнаты).
function verifySocketToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db.prepare("SELECT id, email, name, role FROM User WHERE id = ?").get(payload.sub) || null;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth, verifySocketToken, JWT_SECRET };
