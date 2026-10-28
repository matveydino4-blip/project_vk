// Начисление баллов за ответ.
// Базовые баллы за правильный ответ + бонус за скорость (чем быстрее
// ответил относительно отведённого времени, тем больше бонус).
// Неправильный или просроченный ответ — 0 баллов.
const BASE_POINTS = 1000;
const MAX_SPEED_BONUS = 500;

function calculatePoints({ isCorrect, timeLimitMs, elapsedMs }) {
  if (!isCorrect) return 0;
  const clampedElapsed = Math.max(0, Math.min(elapsedMs, timeLimitMs));
  const speedRatio = 1 - clampedElapsed / timeLimitMs; // 1 = мгновенно, 0 = впритык
  const speedBonus = Math.round(MAX_SPEED_BONUS * speedRatio);
  return BASE_POINTS + speedBonus;
}

module.exports = { calculatePoints, BASE_POINTS, MAX_SPEED_BONUS };
