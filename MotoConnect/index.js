require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { Telegraf } = require("telegraf");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не найден BOT_TOKEN. Создай файл .env по образцу .env.example.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "globovets.sqlite");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = FULL");
sqlite.pragma("busy_timeout = 5000");
sqlite.exec(
  "CREATE TABLE IF NOT EXISTS documents (" +
  "collection TEXT NOT NULL, doc_key TEXT NOT NULL, document TEXT NOT NULL, " +
  "updated_at INTEGER NOT NULL, PRIMARY KEY (collection, doc_key))"
);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function matches(document, filter) {
  if (!isObject(filter)) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or" && Array.isArray(expected)) {
      if (!expected.some(part => matches(document, part))) return false;
      continue;
    }
    if (key === "$and" && Array.isArray(expected)) {
      if (!expected.every(part => matches(document, part))) return false;
      continue;
    }
    const actual = key.split(".").reduce((v, k) => v == null ? undefined : v[k], document);
    if (isObject(expected) && Object.keys(expected).some(k => k.startsWith("$"))) {
      if ("$exists" in expected && Boolean(actual !== undefined) !== Boolean(expected.$exists)) return false;
      if ("$ne" in expected && actual === expected.$ne) return false;
      if ("$in" in expected && (!Array.isArray(expected.$in) || !expected.$in.includes(actual))) return false;
      if ("$gt" in expected && !(actual > expected.$gt)) return false;
      if ("$gte" in expected && !(actual >= expected.$gte)) return false;
      if ("$lt" in expected && !(actual < expected.$lt)) return false;
      if ("$lte" in expected && !(actual <= expected.$lte)) return false;
    } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return false;
    }
  }
  return true;
}
function mergePath(target, dottedKey, value) {
  const parts = dottedKey.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}
function stableKey(doc, filter) {
  if (doc && doc._id !== undefined) return "id:" + String(doc._id);
  if (doc && doc.key !== undefined) return "key:" + String(doc.key);
  if (filter && filter._id !== undefined) return "id:" + String(filter._id);
  if (filter && filter.key !== undefined) return "key:" + String(filter.key);
  return "doc:" + Buffer.from(JSON.stringify(filter || doc || {})).toString("base64url");
}

const db = {
  collection(name) {
    const collection = String(name);
    return {
      async findOne(filter = {}) {
        const rows = sqlite.prepare("SELECT document FROM documents WHERE collection = ?").all(collection);
        for (const row of rows) {
          const doc = JSON.parse(row.document);
          if (matches(doc, filter)) return doc;
        }
        return null;
      },
      async updateOne(filter = {}, update = {}, options = {}) {
        const rows = sqlite.prepare("SELECT doc_key, document FROM documents WHERE collection = ?").all(collection);
        let found = null;
        for (const row of rows) {
          const doc = JSON.parse(row.document);
          if (matches(doc, filter)) { found = { key: row.doc_key, doc }; break; }
        }
        if (!found && !options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };

        let doc = found ? found.doc : { ...filter };
        if (isObject(update.$set)) {
          for (const [key, value] of Object.entries(update.$set)) mergePath(doc, key, value);
        }
        if (isObject(update.$inc)) {
          for (const [key, value] of Object.entries(update.$inc)) {
            const oldValue = key.split(".").reduce((v, k) => v == null ? undefined : v[k], doc);
            mergePath(doc, key, (Number(oldValue) || 0) + Number(value));
          }
        }
        if (isObject(update.$unset)) {
          for (const key of Object.keys(update.$unset)) {
            const parts = key.split(".");
            const last = parts.pop();
            const parent = parts.reduce((v, k) => v == null ? undefined : v[k], doc);
            if (parent && typeof parent === "object") delete parent[last];
          }
        }
        if (!Object.keys(update).some(k => k.startsWith("$"))) doc = { ...doc, ...update };

        const key = found ? found.key : stableKey(doc, filter);
        sqlite.prepare(
          "INSERT INTO documents(collection, doc_key, document, updated_at) VALUES(?, ?, ?, ?) " +
          "ON CONFLICT(collection, doc_key) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at"
        ).run(collection, key, JSON.stringify(doc), Date.now());

        return { matchedCount: found ? 1 : 0, modifiedCount: 1, upsertedCount: found ? 0 : 1 };
      }
    };
  },
  async get(collection, key) {
    const row = sqlite.prepare("SELECT document FROM documents WHERE collection = ? AND doc_key = ?")
      .get(String(collection), "kv:" + String(key));
    if (!row) return null;
    const doc = JSON.parse(row.document);
    return Object.prototype.hasOwnProperty.call(doc, "value") ? doc.value : doc;
  },
  async set(collection, key, value) {
    const doc = { __kvKey: String(key), value };
    sqlite.prepare(
      "INSERT INTO documents(collection, doc_key, document, updated_at) VALUES(?, ?, ?, ?) " +
      "ON CONFLICT(collection, doc_key) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at"
    ).run(String(collection), "kv:" + String(key), JSON.stringify(doc), Date.now());
  }
};

const bot = new Telegraf(token, { handlerTimeout: 30000 });
bot.catch((error, ctx) => {
  console.error("Ошибка обработчика Telegram:", error);
  if (ctx) console.error("Chat:", ctx.chat && ctx.chat.id, "User:", ctx.from && ctx.from.id);
});

function makeBackup() {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    sqlite.pragma("wal_checkpoint(FULL)");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, "globovets-" + stamp + ".sqlite");
    fs.copyFileSync(DB_PATH, target);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => /^globovets-.*\.sqlite$/.test(name))
      .map(name => ({ name, time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const old of backups.slice(7)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
    console.log("Резервная копия:", target);
  } catch (error) {
    console.error("Не удалось создать резервную копию:", error);
  }
}

async function start() {
  const legacyPath = path.join(__dirname, "legacy.js");
  if (!fs.existsSync(legacyPath)) throw new Error("Не найден legacy.js.");
  const legacySource = fs.readFileSync(legacyPath, "utf8");
  new Function("bot", "db", legacySource)(bot, db);

  await bot.launch();
  console.log("Глобовец запущен. База:", DB_PATH);
  console.log("Для остановки нажми Ctrl+C.");
  makeBackup();
  setInterval(makeBackup, 24 * 60 * 60 * 1000);
}

process.once("SIGINT", () => {
  console.log("Остановка Глобовца...");
  bot.stop("SIGINT");
  try { makeBackup(); } finally { sqlite.close(); process.exit(0); }
});
process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  try { makeBackup(); } finally { sqlite.close(); process.exit(0); }
});

start().catch(error => {
  console.error("Не удалось запустить Глобовец:", error);
  try { sqlite.close(); } catch {}
  process.exit(1);
});
