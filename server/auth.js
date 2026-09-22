'use strict';
/** 用户系统：注册 / 登录 / 会话 / 权限 */

const { get, run, all } = require('./db');
const U = require('./util');

const COOKIE = 'sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_MS = SESSION_DAYS * 86400e3;

class ApiError extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname || u.username,
    role: u.role,
    bio: u.bio || '',
    avatar_hue: u.avatar_hue,
    status: u.status,
    created_at: u.created_at,
  };
}

function findUser(id) {
  return get('SELECT * FROM users WHERE id = ?', id);
}

/** 从请求 cookie 解析当前用户 */
function currentUser(req) {
  const cookies = U.parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE];
  if (!sid) return null;
  const s = get('SELECT * FROM sessions WHERE token = ?', sid);
  if (!s) return null;
  if (s.expires_at < U.now()) {
    run('DELETE FROM sessions WHERE token = ?', sid);
    return null;
  }
  const u = findUser(s.user_id);
  if (!u || u.status !== 'active') return null;
  return u;
}

function requireLogin(req) {
  const u = currentUser(req);
  if (!u) throw new ApiError('请先登录', 401);
  return u;
}

function requireAdmin(req) {
  const u = requireLogin(req);
  if (u.role !== 'admin') throw new ApiError('需要管理员权限', 403);
  return u;
}

function createSession(res, user, req) {
  const t = U.token(24);
  const ts = U.now();
  run(
    'INSERT INTO sessions (token, user_id, ip, ua, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    t, user.id, U.clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200), ts, ts + SESSION_MS
  );
  run('UPDATE users SET last_login = ? WHERE id = ?', ts, user.id);
  U.setCookie(res, COOKIE, t, {
    maxAge: SESSION_DAYS * 86400,
    secure: String(process.env.COOKIE_SECURE || '') === '1',
  });
  return t;
}

function destroySession(req, res) {
  const cookies = U.parseCookies(req.headers.cookie);
  if (cookies[COOKIE]) run('DELETE FROM sessions WHERE token = ?', cookies[COOKIE]);
  U.setCookie(res, COOKIE, '');
}

function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', userId, exceptToken);
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

// ------------------------------------------------------------------
// 业务逻辑
// ------------------------------------------------------------------
function register(body, req, res) {
  const uc = U.checkUsername(body.username);
  if (!uc.valid) throw new ApiError(uc.msg);
  const pc = U.checkPassword(body.password);
  if (!pc.valid) throw new ApiError(pc.msg);

  if (get('SELECT id FROM users WHERE username = ?', uc.value)) {
    throw new ApiError('该用户名已被注册');
  }
  const nickname = U.str(body.nickname, 'nickname') || uc.value;
  const { salt, hash } = U.hashPassword(pc.value);

  const info = run(
    `INSERT INTO users (username, pass_hash, pass_salt, role, nickname, bio, avatar_hue, created_at)
     VALUES (?,?,?, 'user', ?, '', ?, ?)`,
    uc.value, hash, salt, nickname, Math.floor(Math.random() * 360), U.now()
  );
  const user = findUser(Number(info.lastInsertRowid));
  createSession(res, user, req);
  return publicUser(user);
}

function login(body, req, res) {
  const ip = U.clientIp(req);
  if (!U.rateLimit(`login:${ip}`, 10, 10 * 60e3)) {
    throw new ApiError('尝试过于频繁，请稍后再试', 429);
  }
  const username = U.str(body.username, 'username');
  const password = String(body.password || '');
  const user = get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !U.verifyPassword(password, user.pass_salt, user.pass_hash)) {
    throw new ApiError('用户名或密码错误', 401);
  }
  if (user.status !== 'active') throw new ApiError('账号已被停用，请联系站长', 403);
  createSession(res, user, req);
  return publicUser(user);
}

function updateProfile(user, body) {
  const nickname = U.str(body.nickname, 'nickname') || user.username;
  const bio = U.str(body.bio, 'bio');
  const hue = U.int(body.avatar_hue, user.avatar_hue, 0, 360);
  run('UPDATE users SET nickname = ?, bio = ?, avatar_hue = ? WHERE id = ?', nickname, bio, hue, user.id);
  return publicUser(findUser(user.id));
}

function changePassword(user, body) {
  const oldPass = String(body.old_password || '');
  const pc = U.checkPassword(body.new_password);
  if (!pc.valid) throw new ApiError(pc.msg);
  if (!U.verifyPassword(oldPass, user.pass_salt, user.pass_hash)) {
    throw new ApiError('原密码不正确');
  }
  const { salt, hash } = U.hashPassword(pc.value);
  run('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?', hash, salt, user.id);
  destroyUserSessions(user.id);
  return true;
}

/** 用户统计数据（个人主页 / 管理后台共用） */
function userStats(userId) {
  const q = (sql, ...a) => (get(sql, ...a) || {}).c || 0;
  return {
    favorites: q('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?', userId),
    watchlist: q('SELECT COUNT(*) AS c FROM watchlist WHERE user_id = ?', userId),
    ratings: q('SELECT COUNT(*) AS c FROM ratings WHERE user_id = ?', userId),
    threads: q('SELECT COUNT(*) AS c FROM threads WHERE user_id = ?', userId),
    comments: q('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?', userId),
    history: q('SELECT COUNT(*) AS c FROM views WHERE user_id = ?', userId),
    feedbacks: q('SELECT COUNT(*) AS c FROM feedbacks WHERE user_id = ?', userId),
    likes_received: q(
      `SELECT COUNT(*) AS c FROM thread_likes tl JOIN threads t ON t.id = tl.thread_id
       WHERE t.user_id = ?`, userId
    ),
  };
}

/** 用户偏好画像：按权重累计 类型 / 地区 / 分类 */
function tasteProfile(userId) {
  const profile = { genres: {}, countries: {}, categories: {}, directors: {}, total: 0 };
  const bump = (map, key, w) => {
    if (!key) return;
    map[key] = (map[key] || 0) + w;
  };

  const W = { rating_high: 3, rating_low: 0.5, favorite: 2.5, watchlist: 1.5, view: 0.6, thread: 2 };

  const addMovie = (m, w) => {
    if (!m) return;
    let gs = [];
    let cs = [];
    try { gs = JSON.parse(m.genres || '[]'); } catch { gs = []; }
    try { cs = JSON.parse(m.countries || '[]'); } catch { cs = []; }
    for (const g of gs) bump(profile.genres, g, w);
    for (const c of cs) bump(profile.countries, c, w);
    bump(profile.categories, m.category, w);
    for (const d of String(m.director || '').split(/[、,，/]/)) bump(profile.directors, d.trim(), w * 0.5);
    profile.total += w;
  };

  for (const r of all(
    `SELECT m.*, rt.score FROM ratings rt JOIN movies m ON m.id = rt.movie_id WHERE rt.user_id = ?`, userId
  )) {
    addMovie(r, r.score >= 7 ? W.rating_high : W.rating_low);
  }
  for (const r of all(
    `SELECT m.* FROM favorites f JOIN movies m ON m.id = f.movie_id WHERE f.user_id = ?`, userId
  )) addMovie(r, W.favorite);
  for (const r of all(
    `SELECT m.* FROM watchlist w JOIN movies m ON m.id = w.movie_id WHERE w.user_id = ?`, userId
  )) addMovie(r, W.watchlist);
  for (const r of all(
    `SELECT DISTINCT m.* FROM views v JOIN movies m ON m.id = v.movie_id
     WHERE v.user_id = ? ORDER BY v.id DESC LIMIT 30`, userId
  )) addMovie(r, W.view);
  for (const r of all(
    `SELECT DISTINCT m.* FROM threads t JOIN movies m ON m.id = t.movie_id WHERE t.user_id = ?`, userId
  )) addMovie(r, W.thread);

  return profile;
}

module.exports = {
  COOKIE, ApiError, publicUser, findUser, currentUser, requireLogin, requireAdmin,
  createSession, destroySession, destroyUserSessions,
  register, login, updateProfile, changePassword, userStats, tasteProfile,
};
