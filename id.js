-- Схема базы данных квиз-приложения (SQLite).
-- Провайдер SQLite выбран для того, чтобы прототип запускался локально
-- одной командой без поднятия отдельного сервера БД. Для перехода в
-- продакшн на PostgreSQL меняется только слой доступа к данным в db.js —
-- структура таблиц ниже сохраняется 1:1.

CREATE TABLE IF NOT EXISTS User (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'PARTICIPANT', -- ORGANIZER | PARTICIPANT (условное значение по умолчанию)
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Quiz (
  id                   TEXT PRIMARY KEY,
  ownerId              TEXT NOT NULL REFERENCES User(id),
  title                TEXT NOT NULL,
  category             TEXT NOT NULL DEFAULT 'Общее',
  timeLimitPerQuestion INTEGER NOT NULL DEFAULT 20,
  createdAt            TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Question (
  id         TEXT PRIMARY KEY,
  quizId     TEXT NOT NULL REFERENCES Quiz(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'TEXT',   -- TEXT | IMAGE
  choiceType TEXT NOT NULL DEFAULT 'SINGLE', -- SINGLE | MULTIPLE
  text       TEXT NOT NULL,
  imageUrl   TEXT,
  timeLimit  INTEGER NOT NULL DEFAULT 20,
  "order"    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS AnswerOption (
  id         TEXT PRIMARY KEY,
  questionId TEXT NOT NULL REFERENCES Question(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  isCorrect  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Room (
  id                     TEXT PRIMARY KEY,
  code                   TEXT UNIQUE NOT NULL,
  quizId                 TEXT NOT NULL REFERENCES Quiz(id),
  hostId                 TEXT NOT NULL REFERENCES User(id),
  status                 TEXT NOT NULL DEFAULT 'LOBBY', -- LOBBY | RUNNING | FINISHED
  currentQuestionIndex   INTEGER NOT NULL DEFAULT -1,
  currentQuestionStartAt TEXT,
  createdAt              TEXT NOT NULL DEFAULT (datetime('now')),
  finishedAt             TEXT
);

CREATE TABLE IF NOT EXISTS Participant (
  id       TEXT PRIMARY KEY,
  roomId   TEXT NOT NULL REFERENCES Room(id) ON DELETE CASCADE,
  userId   TEXT REFERENCES User(id),
  nickname TEXT NOT NULL,
  score    INTEGER NOT NULL DEFAULT 0,
  joinedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(roomId, nickname)
);

CREATE TABLE IF NOT EXISTS Submission (
  id                TEXT PRIMARY KEY,
  participantId     TEXT NOT NULL REFERENCES Participant(id) ON DELETE CASCADE,
  questionId        TEXT NOT NULL REFERENCES Question(id),
  selectedOptionIds TEXT NOT NULL, -- JSON-массив id выбранных вариантов
  isCorrect         INTEGER NOT NULL DEFAULT 0,
  pointsAwarded     INTEGER NOT NULL DEFAULT 0,
  answeredAt        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(participantId, questionId)
);

CREATE INDEX IF NOT EXISTS idx_question_quiz ON Question(quizId);
CREATE INDEX IF NOT EXISTS idx_option_question ON AnswerOption(questionId);
CREATE INDEX IF NOT EXISTS idx_room_quiz ON Room(quizId);
CREATE INDEX IF NOT EXISTS idx_participant_room ON Participant(roomId);
CREATE INDEX IF NOT EXISTS idx_submission_participant ON Submission(participantId);
