'use strict';
/** 影视查询、检索与推荐引擎 */

const { all, get } = require('./db');
const { tasteProfile } = require('./auth');
const U = require('./util');

// ------------------------------------------------------------------
// 统一数据加载与格式化
// ------------------------------------------------------------------
const BASE_SQL = `
  SELECT m.*,
    (SELECT COUNT(*) FROM favorites  f  WHERE f.movie_id  = m.id)                     AS fav_cnt,
    (SELECT COUNT(*) FROM watchlist  w  WHERE w.movie_id  = m.id)                     AS wl_cnt,
    (SELECT COUNT(*) FROM views      v  WHERE v.movie_id  = m.id)                     AS view_cnt,
    (SELECT COUNT(*) FROM threads    t  WHERE t.movie_id  = m.id)                     AS thread_cnt,
    (SELECT COUNT(*) FROM resources  r  WHERE r.movie_id  = m.id AND r.status = 1)    AS res_cnt,
    (SELECT COUNT(*) FROM ratings    rt WHERE rt.movie_id = m.id)                     AS rating_cnt,
    (SELECT COALESCE(ROUND(AVG(rt.score),1),0) FROM ratings rt WHERE rt.movie_id=m.id) AS avg_rating
  FROM movies m`;

function loadAll(userId) {
  const rows = all(`${BASE_SQL} ORDER BY m.id ASC`);
  const fav = new Set();
  const wl = new Set();
  const rat = new Map();
  if (userId) {
    for (const r of all('SELECT movie_id FROM favorites WHERE user_id = ?', userId)) fav.add(r.movie_id);
    for (const r of all('SELECT movie_id FROM watchlist WHERE user_id = ?', userId)) wl.add(r.movie_id);
    for (const r of all('SELECT movie_id, score FROM ratings WHERE user_id = ?', userId)) rat.set(r.movie_id, r.score);
  }
  return rows.map((r) => format(r, fav, wl, rat));
}

function parseList(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function hotScore(m) {
  return m.fav_cnt * 3 + m.view_cnt * 1 + m.rating_cnt * 2 + m.thread_cnt * 2 + m.wl_cnt * 1 + m.avg_rating * 0.4;
}

/** 统一输出结构（详情/列表复用） */
function format(r, fav = new Set(), wl = new Set(), rat = new Map(), full = false) {
  const summary = r.summary || '';
  const m = {
    id: r.id,
    title: r.title,
    premiere: r.premiere,
    year: r.year,
    category: r.category,
    genres: parseList(r.genres),
    countries: parseList(r.countries),
    director: r.director,
    writer: r.writer,
    actors: r.actors,
    actor_list: String(r.actors || '').split(/[、,，/]/).map((s) => s.trim()).filter(Boolean),
    episodes: r.episodes,
    hue: r.hue,
    source_note: r.source_note,
    fav_cnt: r.fav_cnt || 0,
    wl_cnt: r.wl_cnt || 0,
    view_cnt: r.view_cnt || 0,
    thread_cnt: r.thread_cnt || 0,
    res_cnt: r.res_cnt || 0,
    rating_cnt: r.rating_cnt || 0,
    avg_rating: Number(r.avg_rating || 0),
    summary,
    summary_short: summary.length > 110 ? `${summary.slice(0, 110)}…` : summary,
    favorited: fav.has(r.id),
    in_watchlist: wl.has(r.id),
    my_rating: rat.get(r.id) || 0,
  };
  m.hot = Number(hotScore(m).toFixed(2));
  if (!full) delete m.writer;
  return m;
}

function getMovie(id, userId) {
  const r = get(`${BASE_SQL} WHERE m.id = ?`, id);
  if (!r) return null;
  const fav = userId && get('SELECT 1 AS x FROM favorites WHERE user_id=? AND movie_id=?', userId, id) ? new Set([id]) : new Set();
  const wl = userId && get('SELECT 1 AS x FROM watchlist WHERE user_id=? AND movie_id=?', userId, id) ? new Set([id]) : new Set();
  const rr = userId ? get('SELECT score FROM ratings WHERE user_id=? AND movie_id=?', userId, id) : null;
  const rat = rr ? new Map([[id, rr.score]]) : new Map();
  return format(r, fav, wl, rat, true);
}

function sortList(list, sort) {
  const arr = [...list];
  switch (sort) {
    case 'rating': arr.sort((a, b) => (b.avg_rating - a.avg_rating) || (b.rating_cnt - a.rating_cnt)); break;
    case 'year_desc': arr.sort((a, b) => (b.year || 0) - (a.year || 0)); break;
    case 'year_asc': arr.sort((a, b) => (a.year || 0) - (b.year || 0)); break;
    case 'fav': arr.sort((a, b) => b.fav_cnt - a.fav_cnt); break;
    case 'title': arr.sort((a, b) => a.title.localeCompare(b.title, 'zh')); break;
    case 'random': arr.sort(() => Math.random() - 0.5); break;
    case 'hot':
    default: arr.sort((a, b) => b.hot - a.hot); break;
  }
  return arr;
}

function paginate(arr, page, size) {
  const start = (page - 1) * size;
  return { list: arr.slice(start, start + size), total: arr.length, page, size, pages: Math.max(1, Math.ceil(arr.length / size)) };
}

// ------------------------------------------------------------------
// 筛选 / 搜索
// ------------------------------------------------------------------
function applyFilters(list, q = {}) {
  let arr = list;
  if (q.category && q.category !== '全部') arr = arr.filter((m) => m.category === q.category);
  if (q.genre && q.genre !== '全部') arr = arr.filter((m) => m.genres.includes(q.genre));
  if (q.country && q.country !== '全部') arr = arr.filter((m) => m.countries.includes(q.country));
  if (q.year) arr = arr.filter((m) => m.year === Number(q.year));
  if (q.decade) {
    const d = Number(q.decade);
    arr = arr.filter((m) => m.year && Math.floor(m.year / 10) * 10 === d);
  }
  if (q.has_resource) arr = arr.filter((m) => m.res_cnt > 0);
  if (q.min_rating) arr = arr.filter((m) => m.avg_rating >= Number(q.min_rating));
  return arr;
}

/** 全文检索：多关键词，命中标题/主演/导演/编剧/类型/地区 */
function searchMovies(list, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const terms = kw.split(/[\s,，、]+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return [];

  return list
    .map((m) => {
      let score = 0;
      let hit = true;
      for (const t of terms) {
        const tl = t.toLowerCase();
        let s = 0;
        if (m.title.toLowerCase().includes(tl)) s += 100;
        if (String(m.director || '').toLowerCase().includes(tl)) s += 45;
        if (String(m.actors || '').toLowerCase().includes(tl)) s += 40;
        if (String(m.writer || '').toLowerCase().includes(tl)) s += 20;
        if (m.genres.some((g) => g.toLowerCase().includes(tl))) s += 25;
        if (m.countries.some((c) => c.toLowerCase().includes(tl))) s += 20;
        if (String(m.category || '').includes(tl)) s += 15;
        if (String(m.year || '').includes(tl)) s += 15;
        if (m.summary.toLowerCase().includes(tl)) s += 6;
        if (s === 0) { hit = false; break; }
        score += s;
      }
      return hit ? { m, score: score + m.hot * 0.2 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

// ------------------------------------------------------------------
// 推荐
// ------------------------------------------------------------------
/** 基于画像的内容推荐 */
function scoreByProfile(m, p) {
  let s = 0;
  for (const g of m.genres) s += (p.genres[g] || 0) * 1.2;
  for (const c of m.countries) s += (p.countries[c] || 0) * 0.8;
  s += (p.categories[m.category] || 0) * 1.0;
  for (const d of String(m.director || '').split(/[、,，/]/)) s += (p.directors[d.trim()] || 0) * 0.6;
  return s;
}

function isActive(m) {
  return m.favorited || m.in_watchlist || m.my_rating > 0;
}

function recommend(userId, limit = 12) {
  const list = loadAll(userId);
  const total = list.length;

  // 冷启动：新用户或无任何行为 -> 按热度 + 随机扰动
  if (!userId) {
    return sortList(list, 'hot').slice(0, limit);
  }

  const profile = tasteProfile(userId);
  const profileHasData = profile.total > 0;
  if (!profileHasData) {
    const seed = sortList(list, 'hot').slice(0, 24);
    return seed.sort(() => Math.random() - 0.5).slice(0, limit);
  }

  const interacted = list.filter(isActive);
  const exclude = new Set(interacted.map((m) => m.id));

  const scored = list
    .filter((m) => !exclude.has(m.id))
    .map((m) => {
      const s = scoreByProfile(m, profile);
      // 冷门佳作扶持 + 热度轻微加权 + 随机扰动，避免千篇一律
      return { m, s: s * 10 + m.hot * 0.6 + m.avg_rating * 1.5 + Math.random() * 6 };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);

  if (scored.length < limit) {
    const pool = sortList(list.filter((m) => !exclude.has(m.id)), 'hot');
    for (const m of pool) {
      if (scored.length >= limit) break;
      if (!scored.includes(m)) scored.push(m);
    }
  }
  if (!scored.length) scored.push(...sortList(list, 'random').slice(0, limit));
  return scored.slice(0, Math.min(limit, total));
}

/** 相似推荐：类型 / 地区 / 导演 / 分类加权 */
function similar(movieId, limit = 8) {
  const base = getMovie(movieId, 0);
  if (!base) return [];
  const list = loadAll(0).filter((m) => m.id !== base.id);
  const scored = list.map((m) => {
    let s = 0;
    const shared = m.genres.filter((g) => base.genres.includes(g));
    s += shared.length * 3;
    s += (m.countries.some((c) => base.countries.includes(c)) ? 2 : 0);
    s += (m.category === base.category ? 2 : 0);
    const bDir = String(base.director || '').split(/[、,，/]/).map((x) => x.trim()).filter(Boolean);
    if (bDir.length && bDir.some((d) => String(m.director || '').includes(d))) s += 4;
    const bAct = base.actor_list.slice(0, 3);
    if (bAct.length) s += m.actor_list.filter((a) => bAct.includes(a)).length * 1.5;
    if (m.year && base.year) s += Math.max(0, 1.5 - Math.abs(m.year - base.year) / 10);
    return { m, s: s + m.hot * 0.02 };
  });
  return scored.filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m);
}

/** 相似用户协同过滤（Item-CF 简化版）：喜欢同片的人还喜欢 */
function collabRecommend(userId, limit = 6) {
  if (!userId) return [];
  const rows = all(
    `SELECT m.id, COUNT(*) AS overlap
     FROM favorites f
     JOIN favorites f2 ON f2.movie_id = f.movie_id AND f2.user_id <> f.user_id
     JOIN favorites f3 ON f3.user_id = f2.user_id
     JOIN movies m ON m.id = f3.movie_id
     WHERE f.user_id = ? AND f3.movie_id NOT IN (SELECT movie_id FROM favorites WHERE user_id = ?)
     GROUP BY m.id ORDER BY overlap DESC LIMIT ?`,
    userId, userId, limit * 2
  );
  const list = loadAll(userId);
  const map = new Map(list.map((m) => [m.id, m]));
  return rows.map((r) => map.get(r.id)).filter(Boolean).slice(0, limit);
}

/** 首页各板块 */
let bannerCache = null;
function homeSections(userId) {
  const list = loadAll(userId);
  const active = list.filter(isActive).map((m) => m.id);

  const hot = sortList(list, 'hot').slice(0, 12);
  const highRated = sortList(list.filter((m) => m.rating_cnt >= 1), 'rating')
    .concat(sortList(list.filter((m) => m.rating_cnt === 0), 'hot')).slice(0, 12);
  const latest = sortList(list.filter((m) => m.year), 'year_desc').slice(0, 12);
  const withResource = sortList(list.filter((m) => m.res_cnt > 0), 'hot').slice(0, 8);
  const discussed = sortList(list.filter((m) => m.thread_cnt > 0), 'fav').slice(0, 8);

  const sections = [
    { key: 'for-you', title: userId ? '为你推荐' : '今日精选', sub: userId ? '依据你的收藏、评分与浏览生成' : '登录后可获得个性化推荐', list: recommend(userId, 12) },
    { key: 'hot', title: '热门榜单', sub: '综合收藏、浏览与讨论热度', list: hot },
    { key: 'high-rated', title: '高分佳作', sub: '站内评分领先', list: highRated },
    { key: 'latest', title: '近期新作', sub: '按首播时间排序', list: latest },
  ];

  if (userId) {
    const cf = collabRecommend(userId, 6);
    if (cf.length) sections.splice(1, 0, {
      key: 'collab', title: '看过的人还喜欢', sub: '依据相似口味的用户生成', list: cf,
    });
  }
  if (discussed.length) sections.push({ key: 'discussed', title: '正在热议', sub: '讨论区最活跃', list: discussed });
  if (withResource.length) sections.push({ key: 'resource', title: '有资源可看', sub: '站长已放送网盘链接', list: withResource });

  // 继续观看（近期浏览）
  if (userId) {
    const rows = all(
      `SELECT v.movie_id, MAX(v.created_at) AS t FROM views v
       WHERE v.user_id = ? GROUP BY v.movie_id ORDER BY t DESC LIMIT 10`, userId
    );
    const map = new Map(list.map((m) => [m.id, m]));
    const recent = rows.map((r) => map.get(r.movie_id)).filter(Boolean);
    if (recent.length) sections.unshift({ key: 'continue', title: '继续浏览', sub: '你最近看过的内容', list: recent });
  }

  return {
    sections: sections.filter((s) => s.list.length),
    hero: pickHero(list, active),
  };
}

function pickHero(list, excludeActive = []) {
  const ex = new Set(excludeActive);
  const pool = sortList(list.filter((m) => m.summary.length > 80), 'hot');
  const arr = pool.length ? pool : sortList(list, 'hot');
  const fresh = arr.filter((m) => !ex.has(m.id));
  const target = fresh.length ? fresh : arr;
  if (bannerCache && target.some((m) => m.id === bannerCache.id) && Math.random() < 0.6) {
    return bannerCache;
  }
  bannerCache = target[Math.floor(Math.random() * Math.min(6, target.length))] || target[0] || null;
  return bannerCache;
}

function availableFilters() {
  const list = loadAll(0);
  const countBy = (fn) => {
    const map = new Map();
    for (const m of list) for (const k of fn(m)) map.set(k, (map.get(k) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  };
  return {
    categories: countBy((m) => [m.category]),
    genres: countBy((m) => m.genres),
    countries: countBy((m) => m.countries),
    decades: countBy((m) => (m.year ? [`${Math.floor(m.year / 10) * 10}年代`] : [])),
    years: countBy((m) => (m.year ? [String(m.year)] : [])),
  };
}

module.exports = {
  loadAll, getMovie, format, sortList, paginate, applyFilters, searchMovies,
  recommend, similar, collabRecommend, homeSections, availableFilters, hotScore,
};
