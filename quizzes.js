const db = require("../db");

// Код комнаты: 6 цифр, легко продиктовать/ввести с телефона.
// Исключаем визуально спорные конструкции, оставляя только цифры.
function generateRoomCode() {
  const findStmt = db.prepare("SELECT 1 FROM Room WHERE code = ?");
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (findStmt.get(code));
  return code;
}

module.exports = { generateRoomCode };
