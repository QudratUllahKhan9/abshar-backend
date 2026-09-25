const fs = require('fs');
const path = require('path');

// Storage: SQLite try hota hai, nahi mila to JSON file (koi native dep nahi).
// Ye file users ko persist karti hai — server restart par data nahi jata.
const DB_PATH = path.join(__dirname, 'data.json');

let db = null;
try {
  db = require('better-sqlite3')(path.join(__dirname, 'app.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT DEFAULT '',
    cnic TEXT DEFAULT '',
    data TEXT DEFAULT '{}'
  )`);
  console.log('[DB] SQLite ready');
} catch (e) {
  console.log('[DB] better-sqlite3 nahi mila — JSON file mode use hoga');
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '{}');
}

function loadJson() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveJson(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const api = {
  findUser(phone) {
    if (db) {
      const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      if (!row) return null;
      return { phone: row.phone, password_hash: row.password_hash, name: row.name, cnic: row.cnic, data: JSON.parse(row.data || '{}') };
    }
    return loadJson()[phone] || null;
  },
  saveUser(user) {
    if (db) {
      db.prepare(`INSERT OR REPLACE INTO users (phone, password_hash, name, cnic, data)
        VALUES (?, ?, ?, ?, ?)`)
        .run(user.phone, user.password_hash, user.name || '', user.cnic || '', JSON.stringify(user.data || {}));
      return;
    }
    const all = loadJson();
    all[user.phone] = user;
    saveJson(all);
  },
  allUsers() {
    if (db) return db.prepare('SELECT phone, name, cnic, data FROM users').all()
      .map(r => ({ phone: r.phone, name: r.name, cnic: r.cnic, data: JSON.parse(r.data || '{}') }));
    return Object.values(loadJson());
  }
};

module.exports = api;
