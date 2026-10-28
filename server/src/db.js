const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DATABASE_FILE || path.join(__dirname, "..", "dev.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Применяем схему при каждом старте — все CREATE TABLE идут с IF NOT EXISTS,
// поэтому это безопасно и на уже существующей базе.
const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
db.exec(schema);

module.exports = db;
