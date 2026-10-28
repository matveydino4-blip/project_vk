const express = require("express");
const db = require("../db");
const { makeId } = require("../utils/id");
const { requireAuth } = require("../auth");

const router = express.Router();
router.use(requireAuth);

function loadFullQuiz(quizId) {
  const quiz = db.prepare("SELECT * FROM Quiz WHERE id = ?").get(quizId);
  if (!quiz) return null;
  const questions = db
    .prepare('SELECT * FROM Question WHERE quizId = ? ORDER BY "order" ASC')
    .all(quizId);
  const optionsStmt = db.prepare("SELECT id, text, isCorrect FROM AnswerOption WHERE questionId = ?");
  quiz.questions = questions.map((q) => ({
    ...q,
    options: optionsStmt.all(q.id).map((o) => ({ ...o, isCorrect: !!o.isCorrect })),
  }));
  return quiz;
}

// Список квизов текущего пользователя
router.get("/", (req, res) => {
  const quizzes = db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM Question WHERE quizId = q.id) AS questionCount
       FROM Quiz q WHERE ownerId = ? ORDER BY updatedAt DESC`
    )
    .all(req.user.id);
  res.json({ quizzes });
});

// Создать пустой квиз
router.post("/", (req, res) => {
  const { title, category, timeLimitPerQuestion } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Укажите название квиза" });

  const quiz = {
    id: makeId("quiz"),
    ownerId: req.user.id,
    title: title.trim(),
    category: (category || "Общее").trim(),
    timeLimitPerQuestion: Number(timeLimitPerQuestion) > 0 ? Number(timeLimitPerQuestion) : 20,
  };
  db.prepare(
    `INSERT INTO Quiz (id, ownerId, title, category, timeLimitPerQuestion)
     VALUES (@id, @ownerId, @title, @category, @timeLimitPerQuestion)`
  ).run(quiz);

  res.status(201).json({ quiz: loadFullQuiz(quiz.id) });
});

function ownedQuizOr404(req, res) {
  const quiz = db.prepare("SELECT * FROM Quiz WHERE id = ?").get(req.params.id);
  if (!quiz) {
    res.status(404).json({ error: "Квиз не найден" });
    return null;
  }
  if (quiz.ownerId !== req.user.id) {
    res.status(403).json({ error: "Это не ваш квиз" });
    return null;
  }
  return quiz;
}

router.get("/:id", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;
  res.json({ quiz: loadFullQuiz(quiz.id) });
});

router.put("/:id", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;
  const { title, category, timeLimitPerQuestion } = req.body || {};
  db.prepare(
    `UPDATE Quiz SET title = ?, category = ?, timeLimitPerQuestion = ?, updatedAt = datetime('now') WHERE id = ?`
  ).run(
    title?.trim() || quiz.title,
    category?.trim() || quiz.category,
    Number(timeLimitPerQuestion) > 0 ? Number(timeLimitPerQuestion) : quiz.timeLimitPerQuestion,
    quiz.id
  );
  res.json({ quiz: loadFullQuiz(quiz.id) });
});

router.delete("/:id", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;
  db.prepare("DELETE FROM Quiz WHERE id = ?").run(quiz.id);
  res.status(204).end();
});

// ---- Вопросы ----

router.post("/:id/questions", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;

  const { type, choiceType, text, imageUrl, timeLimit, options } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "Укажите текст вопроса" });
  if (!Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: "Нужно минимум 2 варианта ответа" });
  }
  if (!options.some((o) => o.isCorrect)) {
    return res.status(400).json({ error: "Отметьте хотя бы один правильный вариант" });
  }

  const maxOrderRow = db
    .prepare('SELECT COALESCE(MAX("order"), -1) AS m FROM Question WHERE quizId = ?')
    .get(quiz.id);

  const question = {
    id: makeId("q"),
    quizId: quiz.id,
    type: type === "IMAGE" ? "IMAGE" : "TEXT",
    choiceType: choiceType === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
    text: text.trim(),
    imageUrl: imageUrl || null,
    timeLimit: Number(timeLimit) > 0 ? Number(timeLimit) : quiz.timeLimitPerQuestion,
    order: maxOrderRow.m + 1,
  };
  db.prepare(
    `INSERT INTO Question (id, quizId, type, choiceType, text, imageUrl, timeLimit, "order")
     VALUES (@id, @quizId, @type, @choiceType, @text, @imageUrl, @timeLimit, @order)`
  ).run(question);

  const insertOption = db.prepare(
    "INSERT INTO AnswerOption (id, questionId, text, isCorrect) VALUES (?, ?, ?, ?)"
  );
  for (const opt of options) {
    if (!opt.text || !opt.text.trim()) continue;
    insertOption.run(makeId("opt"), question.id, opt.text.trim(), opt.isCorrect ? 1 : 0);
  }

  db.prepare("UPDATE Quiz SET updatedAt = datetime('now') WHERE id = ?").run(quiz.id);
  res.status(201).json({ quiz: loadFullQuiz(quiz.id) });
});

router.put("/:id/questions/:questionId", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;
  const question = db
    .prepare("SELECT * FROM Question WHERE id = ? AND quizId = ?")
    .get(req.params.questionId, quiz.id);
  if (!question) return res.status(404).json({ error: "Вопрос не найден" });

  const { type, choiceType, text, imageUrl, timeLimit, options } = req.body || {};
  db.prepare(
    `UPDATE Question SET type = ?, choiceType = ?, text = ?, imageUrl = ?, timeLimit = ? WHERE id = ?`
  ).run(
    type === "IMAGE" ? "IMAGE" : "TEXT",
    choiceType === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
    text?.trim() || question.text,
    imageUrl || null,
    Number(timeLimit) > 0 ? Number(timeLimit) : question.timeLimit,
    question.id
  );

  if (Array.isArray(options)) {
    db.prepare("DELETE FROM AnswerOption WHERE questionId = ?").run(question.id);
    const insertOption = db.prepare(
      "INSERT INTO AnswerOption (id, questionId, text, isCorrect) VALUES (?, ?, ?, ?)"
    );
    for (const opt of options) {
      if (!opt.text || !opt.text.trim()) continue;
      insertOption.run(makeId("opt"), question.id, opt.text.trim(), opt.isCorrect ? 1 : 0);
    }
  }

  db.prepare("UPDATE Quiz SET updatedAt = datetime('now') WHERE id = ?").run(quiz.id);
  res.json({ quiz: loadFullQuiz(quiz.id) });
});

router.delete("/:id/questions/:questionId", (req, res) => {
  const quiz = ownedQuizOr404(req, res);
  if (!quiz) return;
  db.prepare("DELETE FROM Question WHERE id = ? AND quizId = ?").run(req.params.questionId, quiz.id);
  db.prepare("UPDATE Quiz SET updatedAt = datetime('now') WHERE id = ?").run(quiz.id);
  res.json({ quiz: loadFullQuiz(quiz.id) });
});

module.exports = { router, loadFullQuiz };
