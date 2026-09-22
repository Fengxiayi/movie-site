'use strict';
/**
 * 影视推荐网站 - 服务端入口
 * 零第三方依赖：node:http + node:sqlite
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const U = require('./util');
const DB = require('./db');
const A = require('./auth');
const { routes } = require('./api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FORCE_SEED = process.argv.includes('--force-seed');

// ---------------- 启动自检 ----------------
function bootstrap() {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const imported = DB.seedMovies(FORCE_SEED);
  if (imported) console.log(`[db] 已导入影视数据 ${imported} 条`);
  const admin = DB.ensureAdmin();
  if (admin.created) console.log(`[sys] 已创建管理员账号：${admin.user} / ${admin.pass} —— 请尽快修改！`);
  DB.cleanExpiredSessions();
  console.log(`[db] 当前影视总数：${DB.countMovies()}  数据库：${DB.DB_FILE}`);
}

// ---------------- HTTP 服务 ----------------
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // 性能计时（开发环境）
  if (process.env.NODE_ENV !== 'production') res.setHeader('Server-Timing', 'start');

  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return U.fail(res, '请求地址不合法', 400);
    }
    const pathname = url.pathname;

    if (pathname === '/healthz') {
      return U.json(res, 200, { ok: true, uptime: process.uptime(), movies: DB.countMovies() });
    }

    if (pathname.startsWith('/api/')) {
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        url.searchParams; // no-op，保持引用
        Object.defineProperty(req, 'query', { value: url.searchParams, configurable: true });
        Object.defineProperty(req, 'pathname', { value: pathname, configurable: true });
        return await r.fn(req, res, params);
      }
      return U.fail(res, `接口不存在：${method} ${pathname}`, 404);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return U.fail(res, '方法不被支持', 405);
    }
    return U.serveStatic(req, res, PUBLIC_DIR);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) return U.fail(res, '服务器内部错误', 500);
    res.end();
  } finally {
    const cost = Date.now() - started;
    if (cost > 1000 && process.env.NODE_ENV !== 'production') {
      console.warn(`[slow] ${req.method} ${req.url} ${cost}ms`);
    }
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

// 会话清理定时器
const cleaner = setInterval(() => DB.cleanExpiredSessions(), 6 * 3600e3);
cleaner.unref();

function shutdown(sig) {
  console.log(`\n[sys] 收到 ${sig}，正在关闭…`);
  clearInterval(cleaner);
  server.close(() => {
    console.log('[sys] 已停止');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));

if (require.main === module) {
  bootstrap();
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('   ╔════════════════════════════════════════════╗');
    console.log('   ║        影视推荐站点已启动                   ║');
    console.log(`   ║   地址  http://127.0.0.1:${String(PORT).padEnd(23)}║`);
    console.log(`   ║   Node  ${process.version.padEnd(31)}║`);
    console.log(`   ║   片库  ${String(DB.countMovies()).padEnd(31)}║`);
    console.log('   ╚════════════════════════════════════════════╝');
    console.log('');
  });
}

module.exports = { server, bootstrap, routes };
