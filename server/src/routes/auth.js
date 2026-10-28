const express = require("express");
const db = require("../db");
const { makeId } = require("../utils/id");
const { hashPassword, verifyPassword, issueToken, requireAuth } = require("../auth");

const router = express.Router();

router.post("/register", (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Заполните email, имя и пароль" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
  }

  const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "Пользователь с таким email уже существует" });
  }

  const user = {
    id: makeId("user"),
    email: email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    name: name.trim(),
    role: "PARTICIPANT",
  };
  db.prepare(
    "INSERT INTO User (id, email, passwordHash, name, role) VALUES (@id, @email, @passwordHash, @name, @role)"
  ).run(user);

  const token = issueToken(user);
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Укажите email и пароль" });

  const user = db.prepare("SELECT * FROM User WHERE email = ?").get(email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Неверный email или пароль" });
  }

  const token = issueToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
