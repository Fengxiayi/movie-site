'use strict';
/**
 * 数据层：SQLite（Node 22 内置 node:sqlite，零 npm 依赖）
 * 负责建表、索引、种子数据导入、查询封装
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword, now } = require('./util');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const SEED_FILE = path.join(DATA_DIR, 'movies.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');

// ------------------------------------------------------------------
// Schema（每条语句单独执行，避免多语句解析差异）
// ------------------------------------------------------------------
const SCHEMA = [
  // 用户表
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    pass_hash   TEXT    NOT NULL,
    pass_salt   TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'user',
    nickname    TEXT    NOT NULL DEFAULT '',
    bio         TEXT    NOT NULL DEFAULT '',
    avatar_hue  INTEGER NOT NULL DEFAULT 210,
    status      TEXT    NOT NULL DEFAULT 'active',
    created_at  INTEGER NOT NULL,
    last_login  INTEGER
  )`,

  // 会话表
  `CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip          TEXT    NOT NULL DEFAULT '',
    ua          TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,

  // 影视主表
  `CREATE TABLE IF NOT EXISTS movies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    premiere    TEXT    NOT NULL DEFAULT '',
    year        INTEGER,
    summary     TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT '未分类',
    genres      TEXT    NOT NULL DEFAULT '[]',
    countries   TEXT    NOT NULL DEFAULT '[]',
    actors      TEXT    NOT NULL DEFAULT '',
    director    TEXT    NOT NULL DEFAULT '',
    writer      TEXT    NOT NULL DEFAULT '',
    episodes    INTEGER,
    source_note TEXT    NOT NULL DEFAULT '',
    hue         INTEGER NOT NULL DEFAULT 210,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_movies_cat ON movies(category)`,
  `CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year)`,

  // 收藏
  `CREATE TABLE IF NOT EXISTS favorites (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, movie_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fav_movie ON favorites(movie_id)`,

  // 稍后再看
  `CREATE TABLE IF NOT EXISTS watchlist (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, movie_id)
  )`,

  // 评分
  `CREATE TABLE IF NOT EXISTS ratings (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    score       INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, movie_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rating_movie ON ratings(movie_id)`,

  // 浏览历史（同时用于热度统计）
  `CREATE TABLE IF NOT EXISTS views (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    guest_key   TEXT    NOT NULL DEFAULT '',
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_views_movie ON views(movie_id)`,
  `CREATE INDEX IF NOT EXISTS idx_views_user ON views(user_id)`,

  // 讨论区主帖
  `CREATE TABLE IF NOT EXISTS threads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_threads_movie ON threads(movie_id)`,
  `CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id)`,

  // 讨论区回帖（支持二级回复）
  `CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   INTEGER NOT NULL DEFAULT 0,
    content     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id)`,

  // 主帖点赞
  `CREATE TABLE IF NOT EXISTS thread_likes (
    thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (thread_id, user_id)
  )`,

  // 网盘资源
  `CREATE TABLE IF NOT EXISTS resources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    code        TEXT    NOT NULL DEFAULT '',
    pan         TEXT    NOT NULL DEFAULT '其他',
    quality     TEXT    NOT NULL DEFAULT '',
    size_text   TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_res_movie ON resources(movie_id)`,

  // 用户反馈
  `CREATE TABLE IF NOT EXISTS feedbacks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type        TEXT    NOT NULL DEFAULT 'suggestion',
    content     TEXT    NOT NULL,
    contact     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    reply       TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    replied_at  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fb_user ON feedbacks(user_id)`,
];

for (const sql of SCHEMA) db.exec(sql);

// ------------------------------------------------------------------
// 查询封装：node:sqlite 不接受 undefined / boolean，统一归一化
// ------------------------------------------------------------------
function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
}

function run(sql, ...args) {
  return db.prepare(sql).run(...args.map(norm));
}
function get(sql, ...args) {
  return db.prepare(sql).get(...args.map(norm)) || null;
}
function all(sql, ...args) {
  return db.prepare(sql).all(...args.map(norm));
}
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

// ------------------------------------------------------------------
// 种子数据
// ------------------------------------------------------------------
function countMovies() {
  return get('SELECT COUNT(*) AS c FROM movies').c;
}

function seedMovies(force = false) {
  if (!fs.existsSync(SEED_FILE)) {
    console.warn('[db] 未找到种子文件:', SEED_FILE);
    return 0;
  }
  if (!force && countMovies() > 0) return 0;

  const list = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const ts = now();
  tx(() => {
    if (force) run('DELETE FROM movies');
    const st = db.prepare(
      `INSERT INTO movies (title, premiere, year, summary, category, genres, countries,
        actors, director, writer, episodes, source_note, hue, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const m of list) {
      st.run(
        norm(m.title), norm(m.premiere || ''), norm(m.year), norm(m.summary || ''),
        norm(m.category || '未分类'), JSON.stringify(m.genres || []), JSON.stringify(m.country || []),
        norm(m.actors || ''), norm(m.director || ''), norm(m.writer || ''),
        norm(m.episodes), norm([m.watched, m.watch_time].filter(Boolean).join(' · ')),
        norm(m.hue ?? 210), ts
      );
    }
  });
  return list.length;
}

function ensureAdmin() {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || 'admin123';
  if (get('SELECT id FROM users WHERE username = ?', user)) return { created: false, user };
  const { salt, hash } = hashPassword(pass);
  run(
    `INSERT INTO users (username, pass_hash, pass_salt, role, nickname, avatar_hue, created_at)
     VALUES (?,?,?, 'admin', '站长', 8, ?)`,
    user, hash, salt, now()
  );
  return { created: true, user, pass };
}

function cleanExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

process.on('exit', () => { try { db.close(); } catch { /* ignore */ } });

module.exports = { db, run, get, all, tx, norm, seedMovies, ensureAdmin, countMovies, cleanExpiredSessions, DB_FILE, DATA_DIR };
