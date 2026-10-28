const express = require("express");
const db = require("../db");
const { makeId } = require("../utils/id");
const { generateRoomCode } = require("../utils/roomCode");
const { requireAuth } = require("../auth");
const { loadFullQuiz } = require("./quizzes");

const router = express.Router();
router.use(requireAuth);

// Организатор запускает новую комнату для своего квиза (переходит в лобби).
router.post("/", (req, res) => {
  const { quizId } = req.body || {};
  const quiz = db.prepare("SELECT * FROM Quiz WHERE id = ?").get(quizId);
  if (!quiz) return res.status(404).json({ error: "Квиз не найден" });
  if (quiz.ownerId !== req.user.id) return res.status(403).json({ error: "Это не ваш квиз" });

  const questionCount = db
    .prepare("SELECT COUNT(*) AS c FROM Question WHERE quizId = ?")
    .get(quiz.id).c;
  if (questionCount === 0) {
    return res.status(400).json({ error: "В квизе нет вопросов — сначала добавьте хотя бы один" });
  }

  const room = {
    id: makeId("room"),
    code: generateRoomCode(),
    quizId: quiz.id,
    hostId: req.user.id,
  };
  db.prepare("INSERT INTO Room (id, code, quizId, hostId) VALUES (@id, @code, @quizId, @hostId)").run(room);

  res.status(201).json({ room });
});

// Публичная информация о комнате по коду (используется участниками и для reconnect хоста).
// Не требует владения квизом — участник должен видеть, что комната существует.
router.get("/:code", (req, res) => {
  const room = db.prepare("SELECT * FROM Room WHERE code = ?").get(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  const quiz = db.prepare("SELECT id, title, category FROM Quiz WHERE id = ?").get(room.quizId);
  const participants = db
    .prepare("SELECT nickname, score FROM Participant WHERE roomId = ? ORDER BY score DESC")
    .all(room.id);
  res.json({ room: { ...room, quiz, participants, isHost: room.hostId === req.user.id } });
});

// Итоговые результаты завершённой комнаты.
router.get("/:code/results", (req, res) => {
  const room = db.prepare("SELECT * FROM Room WHERE code = ?").get(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  const leaderboard = db
    .prepare("SELECT nickname, score FROM Participant WHERE roomId = ? ORDER BY score DESC")
    .all(room.id);
  const quiz = db.prepare("SELECT id, title FROM Quiz WHERE id = ?").get(room.quizId);
  res.json({ room, quiz, leaderboard });
});

// История: квизы, которые я организовывал (с их комнатами), и квизы, в которых я участвовал.
router.get("/history/mine", (req, res) => {
  const hosted = db
    .prepare(
      `SELECT r.code, r.status, r.createdAt, r.finishedAt, q.title AS quizTitle
       FROM Room r JOIN Quiz q ON q.id = r.quizId
       WHERE r.hostId = ? ORDER BY r.createdAt DESC LIMIT 50`
    )
    .all(req.user.id);

  const participated = db
    .prepare(
      `SELECT r.code, r.status, p.nickname, p.score, q.title AS quizTitle, r.finishedAt
       FROM Participant p
       JOIN Room r ON r.id = p.roomId
       JOIN Quiz q ON q.id = r.quizId
       WHERE p.userId = ? ORDER BY p.joinedAt DESC LIMIT 50`
    )
    .all(req.user.id);

  res.json({ hosted, participated });
});

module.exports = router;
