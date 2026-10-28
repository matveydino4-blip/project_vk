// Сквозной тест: поднимаем сервер на временной БД и проходим квиз целиком —
// организатор, комната, два участника, ответы, таймер, лидерборд.
// Запуск: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quizroom-"));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: { ...process.env, PORT, DATABASE_FILE: path.join(tmpDir, "test.db"), JWT_SECRET: "test" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Сервер не запустился");
});

after(() => {
  server?.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(p, method = "GET", body, token) {
  const res = await fetch(URL + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const once = (s, ev) => new Promise((res) => s.once(ev, res));

test("полный цикл квиза", async () => {
  const reg = await api("/api/auth/register", "POST", { email: "org@test.ru", password: "secret123", name: "Org" });
  assert.equal(reg.status, 201);
  const token = reg.body.token;

  const quiz = (await api("/api/quizzes", "POST", { title: "Тест", timeLimitPerQuestion: 1 }, token)).body.quiz;
  for (const text of ["Вопрос 1", "Вопрос 2"]) {
    const r = await api(`/api/quizzes/${quiz.id}/questions`, "POST",
      { text, timeLimit: 1, options: [{ text: "A", isCorrect: true }, { text: "B" }] }, token);
    assert.equal(r.status, 201);
  }

  const { room } = (await api("/api/rooms", "POST", { quizId: quiz.id }, token)).body;
  assert.match(room.code, /^\d{6}$/);

  const host = io(URL), p1 = io(URL), p2 = io(URL);
  try {
    assert.ok((await emit(host, "host:join", { code: room.code, token })).ok);
    assert.equal((await emit(p1, "host:join", { code: room.code, token: "чужой" })).ok, false, "чужой токен не пускает в хост");
    assert.ok((await emit(p1, "participant:join", { code: room.code, nickname: "Аня" })).ok);
    assert.ok((await emit(p2, "participant:join", { code: room.code, nickname: "Боря" })).ok);

    // Вопрос 1: Аня отвечает верно, Боря — неверно
    let shown = once(p1, "question:show");
    await emit(host, "host:start", { code: room.code });
    let q = await shown;
    assert.ok(q.options.every((o) => !("isCorrect" in o)), "участник не видит правильный ответ заранее");
    const A = q.options.find((o) => o.text === "A").id;
    const B = q.options.find((o) => o.text === "B").id;

    const a1 = await emit(p1, "participant:answer", { code: room.code, questionId: q.id, selectedOptionIds: [A] });
    assert.ok(a1.isCorrect && a1.points > 1000, "быстрый верный ответ даёт бонус за скорость");
    assert.equal((await emit(p1, "participant:answer", { code: room.code, questionId: q.id, selectedOptionIds: [A] })).ok, false,
      "повторный ответ не принимается");
    const closed = once(p1, "question:closed");
    const a2 = await emit(p2, "participant:answer", { code: room.code, questionId: q.id, selectedOptionIds: [B] });
    assert.equal(a2.points, 0);
    assert.equal((await closed).leaderboard[0].nickname, "Аня", "все ответили — вопрос закрылся досрочно");

    // Вопрос 2: Боря не успевает — после закрытия по таймеру ответ не засчитывается
    shown = once(p1, "question:show");
    await emit(host, "host:next", { code: room.code });
    q = await shown;
    const A2 = q.options.find((o) => o.text === "A").id;
    await emit(p1, "participant:answer", { code: room.code, questionId: q.id, selectedOptionIds: [A2] });
    await once(p1, "question:closed");
    const late = await emit(p2, "participant:answer", { code: room.code, questionId: q.id, selectedOptionIds: [A2] });
    assert.equal(late.ok, false, "ответ после закрытия вопроса отклоняется");

    const ended = once(p1, "quiz:ended");
    await emit(host, "host:next", { code: room.code });
    const { leaderboard } = await ended;
    assert.deepEqual(leaderboard.map((r) => r.nickname), ["Аня", "Боря"]);
    assert.equal(leaderboard[1].score, 0);

    assert.equal((await api("/api/rooms/history/mine", "GET", null, token)).status, 200);
  } finally {
    [host, p1, p2].forEach((s) => s.close());
  }
});
