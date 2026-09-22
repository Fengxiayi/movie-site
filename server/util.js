'use strict';
/** 无依赖工具集：HTTP 响应、请求体解析、静态资源、密码学、校验 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BODY = 512 * 1024; // 512KB

// ---------- HTTP ----------
function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const ok = (res, data = {}) => json(res, 200, { ok: true, ...data });
const fail = (res, msg, status = 400, extra = {}) =>
  json(res, status, { ok: false, error: msg, ...extra });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let oversize = false;
    const chunks = [];
    req.on('data', (c) => {
      if (oversize) return; // 已判定超大，继续丢弃后续分片以便连接正常结束
      size += c.length;
      if (size > MAX_BODY) {
        oversize = true;
        chunks.length = 0;
        const err = new Error(`请求体过大，上限 ${Math.floor(MAX_BODY / 1024)}KB`);
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (oversize) return;
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- Cookie ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = decodeURIComponent(part.slice(i + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

function setCookie(res, name, value, opt = {}) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opt.maxAge != null) attrs.push(`Max-Age=${opt.maxAge}`);
  else attrs.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opt.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
};

function serveStatic(req, res, rootDir) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    return json(res, 400, { ok: false, error: '请求地址不合法' });
  }
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel.endsWith('/')) rel += 'index.html';

  const full = path.join(rootDir, path.normalize(rel));
  const root = path.resolve(rootDir);
  if (!full.startsWith(root)) {
    return json(res, 403, { ok: false, error: '禁止访问' });
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 兜底 -> 404 页面
      const nf = path.join(rootDir, '404.html');
      if (fs.existsSync(nf)) {
        res.writeHead(404, { 'Content-Type': MIME['.html'] });
        return fs.createReadStream(nf).pipe(res);
      }
      return json(res, 404, { ok: false, error: '资源不存在' });
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=604800',
    });
    fs.createReadStream(full).pipe(res);
  });
}

// ---------- 安全 ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectHash) {
  try {
    const a = Buffer.from(hashPassword(password, salt).hash, 'hex');
    const b = Buffer.from(String(expectHash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function token(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

/** 极简 IP 级令牌桶，用于防爆破 */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

// ---------- 校验 / 清洗 ----------
const LIMITS = {
  username: 20,
  password: 64,
  nickname: 24,
  bio: 200,
  title: 80,
  content: 3000,
  short: 120,
  url: 500,
  note: 500,
};

/** 取字符串并裁剪，超长返回截断值 */
function str(v, key = 'short', opts = {}) {
  const max = opts.max || LIMITS[key] || LIMITS.short;
  if (v === undefined || v === null) return opts.def !== undefined ? opts.def : '';
  let s = String(v).replace(/\r\n/g, '\n').trim();
  if (max) s = s.slice(0, max);
  return s;
}

const USERNAME_RE = /^[\w一-龥.-]{2,20}$/u;

function checkUsername(v) {
  const u = str(v, 'username');
  if (!USERNAME_RE.test(u)) {
    return { valid: false, msg: '用户名需为 2-20 位，支持中文/字母/数字/下划线/点/连字符' };
  }
  return { valid: true, value: u };
}

function checkPassword(v) {
  const p = String(v === undefined ? '' : v);
  if (p.length < 6) return { valid: false, msg: '密码至少 6 位' };
  if (p.length > LIMITS.password) return { valid: false, msg: `密码不能超过 ${LIMITS.password} 位` };
  return { valid: true, value: p };
}

function int(v, def = 0, min = -Infinity, max = Infinity) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** 是否为安全的 http(s) 链接 */
function safeUrl(v) {
  const u = str(v, 'url');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

const now = () => Date.now();

function timeAgo(ts) {
  const diff = Date.now() - Number(ts || 0);
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 2592000e3) return `${Math.floor(diff / 86400e3)} 天前`;
  if (diff < 31536000e3) return `${Math.floor(diff / 2592000e3)} 个月前`;
  return `${Math.floor(diff / 31536000e3)} 年前`;
}

function dateStr(ts, withTime = true) {
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

module.exports = {
  MAX_BODY, json, ok, fail, readBody, parseCookies, setCookie, serveStatic,
  hashPassword, verifyPassword, token, rateLimit, LIMITS, str, int, safeUrl,
  checkUsername, checkPassword, clientIp, now, timeAgo, dateStr, MIME, USERNAME_RE,
};
