'use strict';
/** 全部 REST API 路由 */

const U = require('./util');
const DB = require('./db');
const A = require('./auth');
const R = require('./recommend');
const { get, all, run } = DB;

const { ok, fail } = U;
const ApiError = A.ApiError;

const routes = [];

/** 注册路由；pattern 支持 /xxx/:id 形式 */
function route(method, pattern, fn) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:[A-Za-z_]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  const wrapped = async (req, res, params) => {
    try {
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) body = await U.readBody(req);
      params = params || {};
      const user = A.currentUser(req);
      const ctx = { req, res, body, params, user, query: req.query };
      const out = await fn(ctx);
      if (!res.writableEnded) ok(res, out === undefined ? {} : out);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      if (status >= 500) console.error('[api]', req.method, req.url, '\n', e);
      if (!res.writableEnded) fail(res, (e && e.message) || '服务器内部错误', status);
    }
  };
  routes.push({ method, re, keys, fn: wrapped });
}

const get2 = (p, f) => route('GET', p, f);
const post = (p, f) => route('POST', p, f);
const put = (p, f) => route('PUT', p, f);
const del = (p, f) => route('DELETE', p, f);

// ------------------------------------------------------------------
// 通用工具
// ------------------------------------------------------------------
function pid(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError('参数不合法');
  return n;
}

function pageParams(query) {
  return {
    page: Math.max(1, U.int(query.get('page'), 1, 1, 100000)),
    size: U.int(query.get('size'), 20, 1, 60),
  };
}

function filtersFromQuery(query) {
  const f = {};
  for (const k of ['category', 'genre', 'country', 'year', 'decade']) {
    const v = query.get(k);
    if (v && v !== '全部') f[k] = v;
  }
  if (query.get('has_resource') === '1') f.has_resource = 1;
  if (query.get('min_rating')) f.min_rating = query.get('min_rating');
  return f;
}

const movieOr404 = (id, userId) => {
  const m = R.getMovie(id, userId);
  if (!m) throw new ApiError('影视不存在', 404);
  return m;
};

// ==================================================================
// 认证模块
// ==================================================================
post('/api/auth/register', ({ body, req, res }) => {
  if (!U.rateLimit(`reg:${U.clientIp(req)}`, 20, 3600e3)) throw new ApiError('注册过于频繁，请稍后再试', 429);
  return { user: A.register(body, req, res) };
});

post('/api/auth/login', ({ body, req, res }) => ({ user: A.login(body, req, res) }));

post('/api/auth/logout', ({ req, res }) => {
  A.destroySession(req, res);
  return {};
});

get2('/api/auth/me', ({ user }) => ({
  user: A.publicUser(user),
  stats: user ? A.userStats(user.id) : null,
}));

put('/api/auth/profile', ({ user, body }) => {
  if (!user) throw new ApiError('请先登录', 401);
  return { user: A.updateProfile(user, body) };
});

post('/api/auth/password', ({ user, body, req, res }) => {
  if (!user) throw new ApiError('请先登录', 401);
  A.changePassword(user, body);
  A.createSession(res, user, req); // 改密后重发会话
  return {};
});

// ==================================================================
// 影视：首页 / 列表 / 详情 / 搜索
// ==================================================================
get2('/api/home', ({ user }) => R.homeSections(user ? user.id : 0));

get2('/api/filters', () => R.availableFilters());

get2('/api/movies', ({ query, user }) => {
  const { page, size } = pageParams(query);
  const filters = filtersFromQuery(query);
  const sort = query.get('sort') || 'hot';
  let list = R.loadAll(user ? user.id : 0);
  const kw = query.get('q');
  if (kw) list = R.searchMovies(list, kw);
  list = R.applyFilters(list, filters);
  list = R.sortList(list, sort);
  return R.paginate(list, page, size);
});

get2('/api/search/suggest', ({ query }) => {
  const kw = U.str(query.get('q'), 'short', { max: 30 });
  if (!kw) return { list: [] };
  const list = R.searchMovies(R.loadAll(0), kw).slice(0, 8);
  return { list: list.map((m) => ({ id: m.id, title: m.title, year: m.year, category: m.category, hue: m.hue })) };
});

get2('/api/movies/:id', ({ params, user, req, res, body }) => {
  const id = pid(params.id);
  const m = movieOr404(id, user ? user.id : 0);
  recordView(id, user, req);
  return { movie: m };
});

get2('/api/movies/:id/similar', ({ params }) => ({ list: R.similar(pid(params.id), 8) }));

// 浏览记录（详情页 / 卡片点击上报）
function recordView(movieId, user, req) {
  try {
    const cookies = U.parseCookies(req.headers.cookie);
    const gk = user ? '' : (cookies.gk || '');
    if (!user && !gk) return;
    const last = get(
      'SELECT id FROM views WHERE movie_id = ? AND ' + (user ? 'user_id = ?' : 'guest_key = ?') +
        ' ORDER BY id DESC LIMIT 1',
      movieId, user ? user.id : gk
    );
    if (last) return;
    run('INSERT INTO views (user_id, guest_key, movie_id, created_at) VALUES (?,?,?,?)',
      user ? user.id : null, gk, movieId, U.now());
  } catch (e) {
    /* 浏览记录失败不影响主流程 */
  }
}

post('/api/movies/:id/view', ({ params, user, req, res }) => {
  const id = pid(params.id);
  let gk = '';
  if (!user) {
    const cookies = U.parseCookies(req.headers.cookie);
    gk = cookies.gk;
    if (!gk) {
      gk = U.token(12);
      U.setCookie(res, 'gk', gk, { maxAge: 365 * 86400 });
    }
  }
  recordView(id, user, { headers: { cookie: `gk=${gk}` } });
  const m = R.getMovie(id, user ? user.id : 0);
  return { movie: m, viewed: true };
});

// ==================================================================
// 互动：收藏 / 稍后再看 / 评分
// ==================================================================
function toggleRelation(table, userId, movieId, action) {
  const exist = get(`SELECT 1 AS x FROM ${table} WHERE user_id = ? AND movie_id = ?`, userId, movieId);
  let state;
  if (action === 'remove') state = false;
  else if (action === 'add') state = true;
  else state = !exist;

  if (state && !exist) {
    run(`INSERT INTO ${table} (user_id, movie_id, created_at) VALUES (?,?,?)`, userId, movieId, U.now());
  } else if (!state && exist) {
    run(`DELETE FROM ${table} WHERE user_id = ? AND movie_id = ?`, userId, movieId);
  }
  return state;
}

/** 收藏 / 稍后再看：add | remove | toggle */
function relationHandler(table) {
  return ({ params, body, user }) => {
    if (!user) throw new ApiError('请先登录', 401);
    const movieId = pid(params.id);
    if (!get('SELECT id FROM movies WHERE id = ?', movieId)) throw new ApiError('影视不存在', 404);
    if (!U.rateLimit(`rel:${user.id}`, 120, 60e3)) throw new ApiError('操作过于频繁', 429);
    const action = ['add', 'remove', 'toggle'].includes(body.action) ? body.action : 'toggle';
    const state = toggleRelation(table, user.id, movieId, action);
    const cnt = (get(`SELECT COUNT(*) AS c FROM ${table} WHERE movie_id = ?`, movieId) || {}).c || 0;
    return { state, movie_id: movieId, count: cnt };
  };
}

post('/api/movies/:id/favorite', relationHandler('favorites'));
post('/api/movies/:id/watchlist', relationHandler('watchlist'));

post('/api/movies/:id/rating', ({ params, body, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const movieId = pid(params.id);
  if (!get('SELECT id FROM movies WHERE id = ?', movieId)) throw new ApiError('影视不存在', 404);
  const score = U.int(body.score, 0, 0, 10);
  if (score <= 0) {
    run('DELETE FROM ratings WHERE user_id = ? AND movie_id = ?', user.id, movieId);
  } else {
    run(
      `INSERT INTO ratings (user_id, movie_id, score, created_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET score = excluded.score, created_at = excluded.created_at`,
      user.id, movieId, score, U.now()
    );
  }
  const agg = get('SELECT COALESCE(ROUND(AVG(score),1),0) AS avg_rating, COUNT(*) AS c FROM ratings WHERE movie_id = ?', movieId);
  return { score, movie_id: movieId, avg_rating: Number(agg.avg_rating || 0), count: agg.c };
});

// ==================================================================
// 讨论区
// ==================================================================
get2('/api/movies/:id/threads', ({ params, query, user }) => {
  const movieId = pid(params.id);
  const { page, size } = pageParams(query);
  const list = all(
    `SELECT t.*, u.username, u.nickname, u.avatar_hue, u.role,
      (SELECT COUNT(*) FROM comments c WHERE c.thread_id = t.id) AS reply_cnt,
      (SELECT COUNT(*) FROM thread_likes l WHERE l.thread_id = t.id) AS like_cnt,
      (SELECT COUNT(*) FROM thread_likes l WHERE l.thread_id = t.id AND l.user_id = ?) AS liked
     FROM threads t JOIN users u ON u.id = t.user_id
     WHERE t.movie_id = ?
     ORDER BY t.pinned DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    user ? user.id : 0, movieId, size, (page - 1) * size
  );
  const total = (get('SELECT COUNT(*) AS c FROM threads WHERE movie_id = ?', movieId) || {}).c || 0;
  return { list: list.map(mapThread), total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
});

function mapThread(t) {
  return {
    id: t.id,
    movie_id: t.movie_id,
    title: t.title,
    content: t.content,
    pinned: !!t.pinned,
    created_at: t.created_at,
    updated_at: t.updated_at,
    reply_cnt: t.reply_cnt || 0,
    like_cnt: t.like_cnt || 0,
    liked: !!t.liked,
    author: {
      id: t.user_id,
      username: t.username,
      nickname: t.nickname || t.username,
      avatar_hue: t.avatar_hue,
      role: t.role,
    },
  };
}

post('/api/movies/:id/threads', ({ params, body, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const movieId = pid(params.id);
  if (!get('SELECT id FROM movies WHERE id = ?', movieId)) throw new ApiError('影视不存在', 404);
  if (!U.rateLimit(`thread:${user.id}`, 10, 600e3)) throw new ApiError('发帖过于频繁，休息一下吧', 429);

  const title = U.str(body.title, 'title');
  const content = U.str(body.content, 'content');
  if (title.length < 2) throw new ApiError('标题至少 2 个字');
  if (content.length < 2) throw new ApiError('内容至少 2 个字');

  const ts = U.now();
  const info = run(
    'INSERT INTO threads (movie_id, user_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    movieId, user.id, title, content, ts, ts
  );
  return { thread: mapThread({ ...get('SELECT * FROM threads WHERE id = ?', Number(info.lastInsertRowid)), liked: 0, reply_cnt: 0, like_cnt: 0, username: user.username, nickname: user.nickname, avatar_hue: user.avatar_hue, role: user.role }) };
});

get2('/api/threads/:id', ({ params, user }) => {
  const id = pid(params.id);
  const t = get(
    `SELECT t.*, u.username, u.nickname, u.avatar_hue, u.role,
      (SELECT COUNT(*) FROM thread_likes l WHERE l.thread_id = t.id) AS like_cnt,
      (SELECT COUNT(*) FROM thread_likes l WHERE l.thread_id = t.id AND l.user_id = ?) AS liked
     FROM threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    user ? user.id : 0, id
  );
  if (!t) throw new ApiError('帖子不存在', 404);

  const comments = all(
    `SELECT c.*, u.username, u.nickname, u.avatar_hue, u.role
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.thread_id = ? ORDER BY c.id ASC`, id
  );
  return {
    thread: { ...mapThread(t), reply_cnt: comments.length },
    movie: R.getMovie(t.movie_id, user ? user.id : 0),
    comments: comments.map(mapComment),
  };
});

function mapComment(c) {
  return {
    id: c.id,
    thread_id: c.thread_id,
    parent_id: c.parent_id,
    content: c.content,
    created_at: c.created_at,
    author: {
      id: c.user_id,
      username: c.username,
      nickname: c.nickname || c.username,
      avatar_hue: c.avatar_hue,
      role: c.role,
    },
  };
}

post('/api/threads/:id/comments', ({ params, body, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const threadId = pid(params.id);
  const t = get('SELECT * FROM threads WHERE id = ?', threadId);
  if (!t) throw new ApiError('帖子不存在', 404);
  if (!U.rateLimit(`cmt:${user.id}`, 30, 600e3)) throw new ApiError('回复过于频繁，请稍后再试', 429);

  const content = U.str(body.content, 'content');
  if (content.length < 1) throw new ApiError('回复内容不能为空');
  const parentId = U.int(body.parent_id, 0, 0, 1e12);

  const info = run(
    'INSERT INTO comments (thread_id, user_id, parent_id, content, created_at) VALUES (?,?,?,?,?)',
    threadId, user.id, parentId, content, U.now()
  );
  run('UPDATE threads SET updated_at = ? WHERE id = ?', U.now(), threadId);
  return {
    comment: mapComment({
      ...get('SELECT * FROM comments WHERE id = ?', Number(info.lastInsertRowid)),
      username: user.username, nickname: user.nickname, avatar_hue: user.avatar_hue, role: user.role,
    }),
  };
});

post('/api/threads/:id/like', ({ params, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const id = pid(params.id);
  if (!get('SELECT id FROM threads WHERE id = ?', id)) throw new ApiError('帖子不存在', 404);
  const exist = get('SELECT 1 AS x FROM thread_likes WHERE thread_id = ? AND user_id = ?', id, user.id);
  if (exist) run('DELETE FROM thread_likes WHERE thread_id = ? AND user_id = ?', id, user.id);
  else run('INSERT INTO thread_likes (thread_id, user_id, created_at) VALUES (?,?,?)', id, user.id, U.now());
  const c = (get('SELECT COUNT(*) AS c FROM thread_likes WHERE thread_id = ?', id) || {}).c || 0;
  return { liked: !exist, like_cnt: c };
});

function canDelete(target, user, ownerId) {
  return user.role === 'admin' || user.id === ownerId;
}

del('/api/threads/:id', ({ params, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const id = pid(params.id);
  const t = get('SELECT * FROM threads WHERE id = ?', id);
  if (!t) throw new ApiError('帖子不存在', 404);
  if (!canDelete(t, user, t.user_id)) throw new ApiError('无权限删除', 403);
  run('DELETE FROM threads WHERE id = ?', id);
  return {};
});

del('/api/comments/:id', ({ params, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const id = pid(params.id);
  const c = get('SELECT * FROM comments WHERE id = ?', id);
  if (!c) throw new ApiError('回复不存在', 404);
  if (!canDelete(c, user, c.user_id)) throw new ApiError('无权限删除', 403);
  run('DELETE FROM comments WHERE id = ?', id);
  return {};
});

// ==================================================================
// 网盘资源板块
// ==================================================================
const PAN_TYPES = ['百度网盘', '阿里云盘', '夸克网盘', '迅雷网盘', '115网盘', '天翼云盘', '移动云盘', '磁力链接', '其他'];

get2('/api/movies/:id/resources', ({ params, user }) => {
  const movieId = pid(params.id);
  const list = all(
    `SELECT r.*, u.username, u.nickname, u.avatar_hue
     FROM resources r JOIN users u ON u.id = r.user_id
     WHERE r.movie_id = ? ORDER BY r.status DESC, r.created_at DESC`,
    movieId
  );
  return {
    list: list.map(mapResource),
    can_post: !!(user && user.role === 'admin'),
    pan_types: PAN_TYPES,
  };
});

function mapResource(r) {
  return {
    id: r.id,
    movie_id: r.movie_id,
    title: r.title,
    url: r.url,
    code: r.code,
    pan: r.pan,
    quality: r.quality,
    size_text: r.size_text,
    note: r.note,
    status: !!r.status,
    created_at: r.created_at,
    sharer: { username: r.username, nickname: r.nickname || r.username, avatar_hue: r.avatar_hue },
  };
}

post('/api/movies/:id/resources', ({ params, body, user }) => {
  adminGuard(user);
  const movieId = pid(params.id);
  if (!get('SELECT id FROM movies WHERE id = ?', movieId)) throw new ApiError('影视不存在', 404);

  const url = U.safeUrl(body.url);
  if (!url) throw new ApiError('请填写有效的 http/https 链接');
  const title = U.str(body.title, 'short') || '网盘资源';
  if (!U.rateLimit(`res:${user.id}`, 60, 600e3)) throw new ApiError('发布过于频繁', 429);

  const info = run(
    `INSERT INTO resources (movie_id, user_id, title, url, code, pan, quality, size_text, note, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
    movieId, user.id, title, url, U.str(body.code, 'short', { max: 32 }),
    PAN_TYPES.includes(body.pan) ? body.pan : '其他', U.str(body.quality, 'short', { max: 20 }),
    U.str(body.size_text, 'short', { max: 30 }), U.str(body.note, 'note'), U.now()
  );
  return { resource: mapResource({ ...get('SELECT * FROM resources WHERE id = ?', Number(info.lastInsertRowid)), username: user.username, nickname: user.nickname, avatar_hue: user.avatar_hue }) };
});

put('/api/resources/:id', ({ params, body, user }) => {
  adminGuard(user);
  const id = pid(params.id);
  const r = get('SELECT * FROM resources WHERE id = ?', id);
  if (!r) throw new ApiError('资源不存在', 404);
  if (body.status !== undefined) {
    run('UPDATE resources SET status = ? WHERE id = ?', body.status ? 1 : 0, id);
  }
  if (body.title !== undefined) run('UPDATE resources SET title = ? WHERE id = ?', U.str(body.title, 'short') || r.title, id);
  if (body.url !== undefined) {
    const u2 = U.safeUrl(body.url);
    if (u2) run('UPDATE resources SET url = ? WHERE id = ?', u2, id);
  }
  if (body.code !== undefined) run('UPDATE resources SET code = ? WHERE id = ?', U.str(body.code, 'short', { max: 32 }), id);
  return { resource: mapResource(get('SELECT r.*, u.username, u.nickname, u.avatar_hue FROM resources r JOIN users u ON u.id=r.user_id WHERE r.id = ?', id)) };
});

del('/api/resources/:id', ({ params, user }) => {
  adminGuard(user);
  const id = pid(params.id);
  run('DELETE FROM resources WHERE id = ?', id);
  return {};
});

get2('/api/resources/latest', ({ query }) => {
  const limit = U.int(query.get('limit'), 12, 1, 40);
  const list = all(
    `SELECT r.*, m.title AS movie_title, m.hue AS movie_hue, m.year, u.username, u.nickname, u.avatar_hue
     FROM resources r JOIN movies m ON m.id = r.movie_id JOIN users u ON u.id = r.user_id
     WHERE r.status = 1 ORDER BY r.created_at DESC LIMIT ?`, limit
  );
  return { list: list.map((r) => ({ ...mapResource(r), movie_title: r.movie_title, movie_hue: r.movie_hue, year: r.year })) };
});

// ==================================================================
// 反馈
// ==================================================================
const FB_TYPES = { bug: '问题反馈', suggestion: '功能建议', resource: '资源求助', content: '内容纠错', other: '其他' };

post('/api/feedbacks', ({ body, user }) => {
  const content = U.str(body.content, 'content');
  if (content.length < 5) throw new ApiError('请至少填写 5 个字，便于我们定位问题');
  if (!U.rateLimit(`fb:${user ? user.id : U.str(body.anon_key, 'short', { max: 40 }) || 'anon'}`, 5, 3600e3)) {
    throw new ApiError('反馈提交过于频繁，请稍后再试', 429);
  }
  const type = FB_TYPES[body.type] ? body.type : 'suggestion';
  const info = run(
    'INSERT INTO feedbacks (user_id, type, content, contact, created_at) VALUES (?,?,?,?,?)',
    user ? user.id : null, type, content, U.str(body.contact, 'short'), U.now()
  );
  return { id: Number(info.lastInsertRowid) };
});

get2('/api/feedbacks/mine', ({ user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const list = all('SELECT * FROM feedbacks WHERE user_id = ? ORDER BY id DESC LIMIT 50', user.id);
  return { list: list.map(mapFeedback) };
});

/** 管理员权限守卫：未登录返回 401，非管理员返回 403 */
function adminGuard(user) {
  if (!user) throw new ApiError('请先登录', 401);
  if (user.role !== 'admin') throw new ApiError('需要管理员权限', 403);
  return user;
}

function mapFeedback(f) {
  return {
    id: f.id,
    type: f.type,
    type_name: FB_TYPES[f.type] || '其他',
    content: f.content,
    contact: f.contact,
    status: f.status,
    reply: f.reply,
    created_at: f.created_at,
    replied_at: f.replied_at,
    author: f.username ? {
      id: f.user_id, username: f.username, nickname: f.nickname || f.username, avatar_hue: f.avatar_hue,
    } : { username: '游客', nickname: '游客', avatar_hue: 210 },
  };
}

get2('/api/admin/feedbacks', ({ user, query }) => {
  adminGuard(user);
  const status = query.get('status');
  const sql = `SELECT f.*, u.username, u.nickname, u.avatar_hue FROM feedbacks f
     LEFT JOIN users u ON u.id = f.user_id ` +
    (status && status !== '全部' ? 'WHERE f.status = ? ' : '') +
    'ORDER BY (f.status = \'pending\') DESC, f.id DESC LIMIT 100';
  const list = status && status !== '全部' ? all(sql, status) : all(sql);
  return { list: list.map(mapFeedback) };
});

put('/api/feedbacks/:id', ({ params, body, user }) => {
  adminGuard(user);
  const id = pid(params.id);
  if (!get('SELECT id FROM feedbacks WHERE id = ?', id)) throw new ApiError('反馈不存在', 404);
  if (['pending', 'processing', 'resolved'].includes(body.status)) {
    run('UPDATE feedbacks SET status = ? WHERE id = ?', body.status, id);
  }
  if (body.reply !== undefined) {
    run('UPDATE feedbacks SET reply = ?, replied_at = ?, status = ? WHERE id = ?',
      U.str(body.reply, 'note'), U.now(), 'resolved', id);
  }
  return { feedback: mapFeedback(all('SELECT f.*, u.username, u.nickname, u.avatar_hue FROM feedbacks f LEFT JOIN users u ON u.id=f.user_id WHERE f.id = ?', id)[0]) };
});

// ==================================================================
// 个人主页
// ==================================================================
get2('/api/me', ({ user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  return {
    user: A.publicUser(user),
    stats: A.userStats(user.id),
    taste: topTaste(user.id),
  };
});

function topTaste(userId) {
  const p = A.tasteProfile(userId);
  const top = (o, n = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(2)) }));
  return { genres: top(p.genres), countries: top(p.countries), categories: top(p.categories), total: Number(p.total.toFixed(2)) };
}

const ME_TABS = ['favorites', 'watchlist', 'ratings', 'threads', 'comments', 'history'];

get2('/api/me/list', ({ query, user }) => {
  if (!user) throw new ApiError('请先登录', 401);
  const tab = query.get('tab') || 'favorites';
  const { page, size } = pageParams(query);
  const uid = user.id;

  let list = [];
  let extra = {};

  if (tab === 'favorites' || tab === 'watchlist') {
    const table = tab === 'favorites' ? 'favorites' : 'watchlist';
    const rows = all(
      `SELECT t.movie_id, t.created_at FROM ${table} t WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      uid, size, (page - 1) * size
    );
    const allMovies = R.loadAll(uid);
    const map = new Map(allMovies.map((m) => [m.id, m]));
    list = rows.map((r) => {
      const m = map.get(r.movie_id);
      return m ? { ...m, added_at: r.created_at } : null;
    }).filter(Boolean);
    extra.total = (get(`SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`, uid) || {}).c || 0;
  } else if (tab === 'ratings') {
    const rows = all(
      `SELECT rt.movie_id, rt.score, rt.created_at FROM ratings rt WHERE rt.user_id = ?
       ORDER BY rt.created_at DESC LIMIT ? OFFSET ?`, uid, size, (page - 1) * size
    );
    const map = new Map(R.loadAll(uid).map((m) => [m.id, m]));
    list = rows.map((r) => (map.get(r.movie_id) ? { ...map.get(r.movie_id), my_rating: r.score, added_at: r.created_at } : null)).filter(Boolean);
    extra.total = (get('SELECT COUNT(*) AS c FROM ratings WHERE user_id = ?', uid) || {}).c || 0;
  } else if (tab === 'threads') {
    const rows = all(
      `SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.thread_id=t.id) AS reply_cnt,
        (SELECT COUNT(*) FROM thread_likes l WHERE l.thread_id=t.id) AS like_cnt
       FROM threads t WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, uid, size, (page - 1) * size
    );
    const map = new Map(R.loadAll(uid).map((m) => [m.id, m]));
    list = rows.map((r) => ({
      id: r.id, title: r.title, content: r.content, created_at: r.created_at,
      reply_cnt: r.reply_cnt, like_cnt: r.like_cnt,
      movie: map.get(r.movie_id) ? { id: r.movie_id, title: map.get(r.movie_id).title, year: map.get(r.movie_id).year, hue: map.get(r.movie_id).hue } : null,
    }));
    extra.total = (get('SELECT COUNT(*) AS c FROM threads WHERE user_id = ?', uid) || {}).c || 0;
  } else if (tab === 'comments') {
    const rows = all(
      `SELECT c.*, t.title AS thread_title, t.movie_id FROM comments c JOIN threads t ON t.id = c.thread_id
       WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, uid, size, (page - 1) * size
    );
    const map = new Map(R.loadAll(uid).map((m) => [m.id, m]));
    list = rows.map((r) => ({
      id: r.id, content: r.content, created_at: r.created_at,
      thread: { id: r.thread_id, title: r.thread_title },
      movie: map.get(r.movie_id) ? { id: r.movie_id, title: map.get(r.movie_id).title, hue: map.get(r.movie_id).hue } : null,
    }));
    extra.total = (get('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?', uid) || {}).c || 0;
  } else if (tab === 'history') {
    const rows = all(
      `SELECT movie_id, MAX(created_at) AS t, COUNT(*) AS times FROM views WHERE user_id = ?
       GROUP BY movie_id ORDER BY t DESC LIMIT ? OFFSET ?`, uid, size, (page - 1) * size
    );
    const map = new Map(R.loadAll(uid).map((m) => [m.id, m]));
    list = rows.map((r) => (map.get(r.movie_id) ? { ...map.get(r.movie_id), added_at: r.t, view_times: r.times } : null)).filter(Boolean);
    extra.total = (get('SELECT COUNT(DISTINCT movie_id) AS c FROM views WHERE user_id = ?', uid) || {}).c || 0;
  }

  return { tab, tabs: ME_TABS, list, ...extra, page, size, pages: Math.max(1, Math.ceil((extra.total || 0) / size)) };
});

get2('/api/users/:username', ({ params }) => {
  const u = get('SELECT * FROM users WHERE username = ?', U.str(params.username, 'username'));
  if (!u) throw new ApiError('用户不存在', 404);
  // 非管理员不展示 stat_detail，仅公开计数
  return {
    user: A.publicUser(u),
    stats: {
      favorites: (get('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?', u.id) || {}).c || 0,
      threads: (get('SELECT COUNT(*) AS c FROM threads WHERE user_id = ?', u.id) || {}).c || 0,
      comments: (get('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?', u.id) || {}).c || 0,
      ratings: (get('SELECT COUNT(*) AS c FROM ratings WHERE user_id = ?', u.id) || {}).c || 0,
    },
  };
});

// ==================================================================
// 管理后台
// ==================================================================
get2('/api/admin/overview', ({ user }) => {
  adminGuard(user);
  const c = (sql, ...a) => (get(sql, ...a) || {}).c || 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  return {
    counts: {
      users: c('SELECT COUNT(*) AS c FROM users'),
      movies: c('SELECT COUNT(*) AS c FROM movies'),
      threads: c('SELECT COUNT(*) AS c FROM threads'),
      comments: c('SELECT COUNT(*) AS c FROM comments'),
      resources: c('SELECT COUNT(*) AS c FROM resources'),
      favorites: c('SELECT COUNT(*) AS c FROM favorites'),
      feedbacks_pending: c("SELECT COUNT(*) AS c FROM feedbacks WHERE status = 'pending'"),
      new_users_today: c('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', dayStart),
    },
    top_movies: all(
      `SELECT m.id, m.title, m.year, COUNT(f.user_id) AS c
       FROM favorites f JOIN movies m ON m.id = f.movie_id
       GROUP BY m.id ORDER BY c DESC LIMIT 8`
    ),
    active_users: all(
      `SELECT u.username, u.nickname, u.avatar_hue, COUNT(t.id) AS c
       FROM threads t JOIN users u ON u.id = t.user_id
       GROUP BY u.id ORDER BY c DESC LIMIT 8`
    ),
  };
});

get2('/api/admin/users', ({ user, query }) => {
  adminGuard(user);
  const limit = U.int(query.get('limit'), 100, 1, 500);
  const rows = all(
    `SELECT u.id, u.username, u.nickname, u.role, u.status, u.created_at, u.last_login,
      (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS fav_cnt,
      (SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id) AS thread_cnt,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_cnt
     FROM users u ORDER BY u.id DESC LIMIT ?`, limit
  );
  return { list: rows.map((r) => ({ ...r })) };
});

put('/api/admin/users/:id', ({ params, body, user }) => {
  adminGuard(user);
  const id = pid(params.id);
  const target = get('SELECT * FROM users WHERE id = ?', id);
  if (!target) throw new ApiError('用户不存在', 404);
  if (target.id === user.id) throw new ApiError('不能修改自己的角色或状态');
  if (body.status && ['active', 'banned'].includes(body.status)) {
    run('UPDATE users SET status = ? WHERE id = ?', body.status, id);
    if (body.status === 'banned') A.destroyUserSessions(id);
  }
  if (body.role && ['user', 'admin'].includes(body.role)) {
    run('UPDATE users SET role = ? WHERE id = ?', body.role, id);
  }
  return { user: A.publicUser(get('SELECT * FROM users WHERE id = ?', id)) };
});

get2('/api/admin/resources', ({ user, query }) => {
  adminGuard(user);
  const limit = U.int(query.get('limit'), 50, 1, 200);
  const rows = all(
    `SELECT r.id, r.title, r.url, r.pan, r.status, r.created_at, m.id AS movie_id, m.title AS movie_title
     FROM resources r JOIN movies m ON m.id = r.movie_id ORDER BY r.created_at DESC LIMIT ?`, limit
  );
  return { list: rows.map((r) => ({ ...r })) };
});

// ==================================================================
// 站点信息
// ==================================================================
get2('/api/site', () => ({
  name: process.env.SITE_NAME || '光影录',
  notice: process.env.SITE_NOTICE || '',
  version: '1.0.0',
}));

module.exports = { routes, routesCount: routes.length };
