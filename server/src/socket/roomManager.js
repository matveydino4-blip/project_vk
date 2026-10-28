const db = require("../db");
const { makeId } = require("../utils/id");
const { calculatePoints } = require("../utils/scoring");
const { verifySocketToken } = require("../auth");

// Таймеры автозакрытия вопроса по комнатам: code -> Timeout
const questionTimers = new Map();

// Комнаты, в которых текущий вопрос уже закрыт (показан правильный ответ),
// но ведущий ещё не перешёл к следующему. Ответы в этот момент не принимаются.
const closedQuestions = new Set();

// Небольшой запас на сетевую задержку при проверке, успел ли участник ответить.
const ANSWER_GRACE_MS = 500;

function roomChannel(code) {
  return `room:${code}`;
}

function getRoom(code) {
  return db.prepare("SELECT * FROM Room WHERE code = ?").get(code);
}

function getQuestions(quizId) {
  return db.prepare('SELECT * FROM Question WHERE quizId = ? ORDER BY "order" ASC').all(quizId);
}

function getOptions(questionId) {
  return db.prepare("SELECT id, text FROM AnswerOption WHERE questionId = ?").all(questionId);
}

function getLeaderboard(roomId) {
  return db
    .prepare("SELECT nickname, score FROM Participant WHERE roomId = ? ORDER BY score DESC, nickname ASC")
    .all(roomId);
}

function publicRoomState(room) {
  const quiz = db.prepare("SELECT id, title, category FROM Quiz WHERE id = ?").get(room.quizId);
  const participants = db
    .prepare("SELECT nickname, score FROM Participant WHERE roomId = ? ORDER BY joinedAt ASC")
    .all(room.id);
  return { code: room.code, status: room.status, quiz, participants };
}

module.exports = function registerRoomHandlers(io) {
  io.on("connection", (socket) => {
    // Организатор подключается к своей комнате как хост (панель управления).
    socket.on("host:join", ({ code, token }, ack) => {
      const user = verifySocketToken(token);
      const room = getRoom(code);
      if (!user || !room || room.hostId !== user.id) {
        return ack?.({ ok: false, error: "Нет доступа к этой комнате" });
      }
      socket.join(roomChannel(code));
      socket.data.role = "host";
      socket.data.roomCode = code;
      ack?.({ ok: true, room: publicRoomState(room) });
    });

    // Участник подключается по коду комнаты + никнейму (без обязательной регистрации).
    // Если передан token авторизованного пользователя, участие связывается с его аккаунтом
    // для отображения в истории — но регистрация не обязательна для игры.
    socket.on("participant:join", ({ code, nickname, token }, ack) => {
      const room = getRoom(code);
      if (!room) return ack?.({ ok: false, error: "Комната не найдена" });
      if (room.status === "FINISHED") return ack?.({ ok: false, error: "Квиз уже завершён" });
      const clean = (nickname || "").trim().slice(0, 24);
      if (!clean) return ack?.({ ok: false, error: "Введите имя участника" });

      const authedUser = token ? verifySocketToken(token) : null;

      let participant = db
        .prepare("SELECT * FROM Participant WHERE roomId = ? AND nickname = ?")
        .get(room.id, clean);

      if (!participant) {
        if (room.status === "RUNNING") {
          return ack?.({ ok: false, error: "Квиз уже начался, дождитесь следующего запуска" });
        }
        participant = {
          id: makeId("p"),
          roomId: room.id,
          userId: authedUser ? authedUser.id : null,
          nickname: clean,
          score: 0,
        };
        db.prepare(
          "INSERT INTO Participant (id, roomId, userId, nickname, score) VALUES (@id, @roomId, @userId, @nickname, @score)"
        ).run(participant);
      } else if (authedUser && !participant.userId) {
        db.prepare("UPDATE Participant SET userId = ? WHERE id = ?").run(authedUser.id, participant.id);
      }

      socket.join(roomChannel(code));
      socket.data.role = "participant";
      socket.data.roomCode = code;
      socket.data.participantId = participant.id;

      io.to(roomChannel(code)).emit("room:update", publicRoomState(room));
      ack?.({ ok: true, participantId: participant.id, room: publicRoomState(room) });
    });

    // Хост запускает квиз: комната переходит в RUNNING и показывается первый вопрос.
    socket.on("host:start", ({ code }, ack) => {
      const room = requireHost(socket, code, ack);
      if (!room) return;
      const questions = getQuestions(room.quizId);
      if (questions.length === 0) return ack?.({ ok: false, error: "В квизе нет вопросов" });

      db.prepare(
        "UPDATE Room SET status = 'RUNNING', currentQuestionIndex = 0, currentQuestionStartAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?"
      ).run(room.id);

      broadcastQuestion(io, code);
      ack?.({ ok: true });
    });

    // Хост вручную переходит к следующему вопросу (или завершает квиз, если вопросы закончились).
    socket.on("host:next", ({ code }, ack) => {
      const room = requireHost(socket, code, ack);
      if (!room) return;
      advanceQuestion(io, code);
      ack?.({ ok: true });
    });

    // Хост досрочно закрывает текущий вопрос (не дожидаясь таймера) и показывает результаты по нему.
    socket.on("host:reveal", ({ code }, ack) => {
      const room = requireHost(socket, code, ack);
      if (!room) return;
      closeCurrentQuestion(io, code);
      ack?.({ ok: true });
    });

    // Хост принудительно завершает квиз.
    socket.on("host:end", ({ code }, ack) => {
      const room = requireHost(socket, code, ack);
      if (!room) return;
      finishRoom(io, code);
      ack?.({ ok: true });
    });

    // Участник отправляет ответ на текущий активный вопрос.
    socket.on("participant:answer", ({ code, questionId, selectedOptionIds }, ack) => {
      const room = getRoom(code);
      const participantId = socket.data.participantId;
      if (!room || !participantId) return ack?.({ ok: false, error: "Нет активной сессии" });
      if (room.status !== "RUNNING") return ack?.({ ok: false, error: "Вопрос сейчас не активен" });

      const questions = getQuestions(room.quizId);
      const question = questions[room.currentQuestionIndex];
      if (!question || question.id !== questionId || closedQuestions.has(code)) {
        return ack?.({ ok: false, error: "Этот вопрос уже закрыт" });
      }

      const already = db
        .prepare("SELECT 1 FROM Submission WHERE participantId = ? AND questionId = ?")
        .get(participantId, questionId);
      if (already) return ack?.({ ok: false, error: "Ответ уже принят" });

      const options = db
        .prepare("SELECT id, isCorrect FROM AnswerOption WHERE questionId = ?")
        .all(questionId);
      const correctIds = options.filter((o) => o.isCorrect).map((o) => o.id).sort();
      const chosen = Array.isArray(selectedOptionIds) ? [...selectedOptionIds].sort() : [];
      const isCorrect =
        chosen.length === correctIds.length && chosen.every((id, i) => id === correctIds[i]);

      const startedAt = new Date(room.currentQuestionStartAt + "Z").getTime();
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > question.timeLimit * 1000 + ANSWER_GRACE_MS) {
        return ack?.({ ok: false, error: "Время на ответ истекло" });
      }
      const points = calculatePoints({
        isCorrect,
        timeLimitMs: question.timeLimit * 1000,
        elapsedMs,
      });

      db.prepare(
        `INSERT INTO Submission (id, participantId, questionId, selectedOptionIds, isCorrect, pointsAwarded)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(makeId("sub"), participantId, questionId, JSON.stringify(chosen), isCorrect ? 1 : 0, points);

      db.prepare("UPDATE Participant SET score = score + ? WHERE id = ?").run(points, participantId);

      // Важно: считаем ответы только от участников ЭТОЙ комнаты. Один и тот же квиз
      // (и, соответственно, id вопросов) может запускаться в нескольких комнатах,
      // поэтому подсчёт без привязки к roomId смешал бы прогресс разных запусков.
      const answeredCount = db
        .prepare(
          `SELECT COUNT(*) AS c FROM Submission s
           JOIN Participant p ON p.id = s.participantId
           WHERE s.questionId = ? AND p.roomId = ?`
        )
        .get(questionId, room.id).c;
      const participantCount = countParticipants(room.id);

      io.to(roomChannel(code)).emit("question:progress", { answeredCount, participantCount });
      ack?.({ ok: true, isCorrect, points });

      // Если ответили все — закрываем вопрос досрочно, не дожидаясь таймера.
      if (answeredCount >= participantCount) {
        closeCurrentQuestion(io, code);
      }
    });

    socket.on("disconnect", () => {
      // Специально не удаляем участника из БД при разрыве соединения —
      // это позволяет переподключиться (например, после потери сети) без потери очков.
    });
  });
};

function requireHost(socket, code, ack) {
  const room = getRoom(code);
  if (!room || socket.data.role !== "host" || socket.data.roomCode !== code) {
    ack?.({ ok: false, error: "Нет доступа к этой комнате" });
    return null;
  }
  return room;
}

function broadcastQuestion(io, code) {
  const room = getRoom(code);
  const questions = getQuestions(room.quizId);
  const question = questions[room.currentQuestionIndex];
  if (!question) return finishRoom(io, code);

  const payload = {
    index: room.currentQuestionIndex,
    total: questions.length,
    id: question.id,
    type: question.type,
    choiceType: question.choiceType,
    text: question.text,
    imageUrl: question.imageUrl,
    timeLimit: question.timeLimit,
    startedAt: room.currentQuestionStartAt,
    options: getOptions(question.id), // без isCorrect — участники не должны видеть ответ заранее
  };
  closedQuestions.delete(code);
  io.to(roomChannel(code)).emit("question:show", payload);
  io.to(roomChannel(code)).emit("question:progress", { answeredCount: 0, participantCount: countParticipants(room.id) });

  clearTimer(code);
  const timer = setTimeout(() => closeCurrentQuestion(io, code), question.timeLimit * 1000 + 300);
  questionTimers.set(code, timer);
}

function countParticipants(roomId) {
  return db.prepare("SELECT COUNT(*) AS c FROM Participant WHERE roomId = ?").get(roomId).c;
}

function closeCurrentQuestion(io, code) {
  clearTimer(code);
  const room = getRoom(code);
  if (!room || room.status !== "RUNNING") return;

  const questions = getQuestions(room.quizId);
  const question = questions[room.currentQuestionIndex];
  if (!question || closedQuestions.has(code)) return; // уже закрыт — не рассылаем повторно
  closedQuestions.add(code);

  const options = db
    .prepare("SELECT id, text, isCorrect FROM AnswerOption WHERE questionId = ?")
    .all(question.id);

  io.to(roomChannel(code)).emit("question:closed", {
    questionId: question.id,
    options: options.map((o) => ({ ...o, isCorrect: !!o.isCorrect })),
    leaderboard: getLeaderboard(room.id),
    isLastQuestion: room.currentQuestionIndex >= questions.length - 1,
  });
}

function advanceQuestion(io, code) {
  clearTimer(code);
  const room = getRoom(code);
  if (!room) return;
  const questions = getQuestions(room.quizId);
  const nextIndex = room.currentQuestionIndex + 1;

  if (nextIndex >= questions.length) {
    return finishRoom(io, code);
  }

  db.prepare(
    "UPDATE Room SET currentQuestionIndex = ?, currentQuestionStartAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?"
  ).run(nextIndex, room.id);
  broadcastQuestion(io, code);
}

function finishRoom(io, code) {
  clearTimer(code);
  const room = getRoom(code);
  if (!room || room.status === "FINISHED") return;
  closedQuestions.delete(code);
  db.prepare("UPDATE Room SET status = 'FINISHED', finishedAt = datetime('now') WHERE id = ?").run(room.id);
  io.to(roomChannel(code)).emit("quiz:ended", { leaderboard: getLeaderboard(room.id) });
}

function clearTimer(code) {
  const t = questionTimers.get(code);
  if (t) {
    clearTimeout(t);
    questionTimers.delete(code);
  }
}
