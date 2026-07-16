const crypto = require("crypto");

// Компактный уникальный id без внешних зависимостей (аналог cuid для наших целей).
function makeId(prefix = "") {
  const random = crypto.randomBytes(9).toString("base64url");
  return prefix ? `${prefix}_${random}` : random;
}

module.exports = { makeId };
