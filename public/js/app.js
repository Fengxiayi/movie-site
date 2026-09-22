/* =========================================================
   app.js —— 全站公共逻辑：请求、鉴权、卡片渲染、交互
   ========================================================= */
'use strict';

const SITE = { name: '光影录' };

/* ---------- 基础工具 ---------- */
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function timeAgo(ts) {
  const d = Date.now() - Number(ts || 0);
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
  if (d < 2592000e3) return `${Math.floor(d / 86400e3)} 天前`;
  if (d < 31536000e3) return `${Math.floor(d / 2592000e3)} 个月前`;
  return `${Math.floor(d / 31536000e3)} 年前`;
}
function dateStr(ts) {
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function qs(name, url) {
  return new URLSearchParams((url || location.search)).get(name) || '';
}

/* ---------- Toast ---------- */
function toast(msg, type = 'ok') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'ok' ? 'ok' : 'err');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = '.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 320);
  }, 2100);
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({ ok: false, error: '响应解析失败' }));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  } catch (e) {
    if (e.name === 'TypeError') throw new Error('网络异常，请检查连接');
    throw e;
  }
}
const getJSON = (p) => api(p);
const postJSON = (p, body) => api(p, { method: 'POST', body });
const putJSON = (p, body) => api(p, { method: 'PUT', body });
const delJSON = (p) => api(p, { method: 'DELETE' });

/* ---------- 登录态 ---------- */
let _user = null, _userLoaded = false;

async function loadUser(force) {
  if (_userLoaded && !force) return _user;
  try {
    const d = await getJSON('/api/auth/me');
    _user = d.user;
    _userLoaded = true;
  } catch {
    _user = null;
    _userLoaded = true;
  }
  return _user;
}
function currentUser() { return _user; }
function setUser(u) { _user = u; _userLoaded = true; }

/** 需要登录的操作：未登录时弹出提示并跳转 */
function requireUser(msg) {
  if (_user) return true;
  toast(msg || '请先登录后操作', 'err');
  setTimeout(() => {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  }, 700);
  return false;
}

/* ---------- Header ---------- */
const NAVS = [
  { href: '/index.html', key: 'home', text: '首页' },
  { href: '/search.html', key: 'search', text: '发现' },
  { href: '/resources.html', key: 'resources', text: '资源' },
  { href: '/feedback.html', key: 'feedback', text: '反馈' },
];

async function renderHeader(active) {
  const user = await loadUser();
  const here = location.pathname.replace(/\/$/, '') || '/index.html';
  const navHtml = NAVS.map((n) => {
    const on = active === n.key || (!active && here.endsWith(n.href));
    return `<a href="${n.href}" class="${on ? 'on' : ''}">${n.text}</a>`;
  }).join('');

  const right = user
    ? `<div class="usermenu">
         <button class="usermenu-btn" id="umBtn">
           <span class="avatar sm" style="--h:${user.avatar_hue}">${esc((user.nickname || user.username)[0])}</span>
           <b>${esc(user.nickname || user.username)}</b>
         </button>
         <div class="dropdown" id="umDrop">
           <a href="/me.html">我的主页</a>
           <a href="/me.html?tab=watchlist">稍后再看</a>
           <a href="/feedback.html?mine=1">我的反馈</a>
           ${user.role === 'admin' ? '<hr><a class="adm" href="/admin.html">管理后台</a>' : ''}
           <hr><button id="logoutBtn">退出登录</button>
         </div>
       </div>`
    : `<a class="btn sm" href="/login.html">登录</a><a class="btn sm primary" href="/login.html#reg">注册</a>`;

  const html = `
  <div class="hdr-inner">
    <a class="logo" href="/index.html"><span class="logo-mark">影</span>光影录<span class="tag">CINE</span></a>
    <nav class="nav">${navHtml}</nav>
    <div class="searchbox">
      <span class="ico">🔍</span>
      <input id="globalSearch" type="text" placeholder="搜片名 / 演员 / 导演 / 类型" autocomplete="off">
      <div class="suggest" id="suggestBox"></div>
    </div>
    <div class="hdr-right">${right}</div>
  </div>`;

  let hdr = $('.hdr');
  if (!hdr) {
    hdr = document.createElement('div');
    hdr.className = 'hdr';
    document.body.prepend(hdr);
  }
  hdr.innerHTML = html;
  bindHeader(hdr, user);
  document.title = document.title === '' ? SITE.name : document.title;
}

function bindHeader(hdr, user) {
  // 用户下拉
  const btn = $('#umBtn', hdr);
  const drop = $('#umDrop', hdr);
  if (btn && drop) {
    btn.addEventListener('click', (e) => { e.stopPropagation(); drop.classList.toggle('show'); });
    document.addEventListener('click', () => drop.classList.remove('show'));
    const lo = $('#logoutBtn', hdr);
    if (lo) lo.addEventListener('click', async () => {
      await postJSON('/api/auth/logout');
      _user = null;
      toast('已退出登录');
      setTimeout(() => location.reload(), 500);
    });
  }

  // 搜索建议
  const input = $('#globalSearch', hdr);
  const box = $('#suggestBox', hdr);
  if (input && box) {
    input.value = location.pathname.startsWith('/search.html') ? qs('q') : input.value;
    let timer = null, idx = -1, items = [];
    const close = () => { box.classList.remove('show'); idx = -1; };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const kw = input.value.trim();
      if (!kw) return close();
      timer = setTimeout(async () => {
        try {
          const d = await getJSON('/api/search/suggest?q=' + encodeURIComponent(kw));
          items = d.list || [];
          if (!items.length) {
            box.innerHTML = `<div class="empty">没有找到「${esc(kw)}」，按回车试试全文搜索</div>`;
          } else {
            box.innerHTML = items.map((m, i) =>
              `<a href="/movie.html?id=${m.id}" data-i="${i}">
                 <span style="width:5px;height:26px;border-radius:3px;background:hsl(${m.hue} 70% 55%)"></span>
                 ${esc(m.title)}
                 <span class="chip">${esc(m.category)} · ${esc(m.year || '—')}</span>
               </a>`).join('');
          }
          box.classList.add('show');
        } catch { close(); }
      }, 220);
    });

    input.addEventListener('keydown', (e) => {
      const links = $$('a', box);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!links.length) return;
        e.preventDefault();
        idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((a, i) => a.classList.toggle('hi', i === idx));
      } else if (e.key === 'Enter') {
        const kw = input.value.trim();
        if (idx >= 0 && links[idx]) location.href = links[idx].getAttribute('href');
        else if (kw) location.href = '/search.html?q=' + encodeURIComponent(kw);
      } else if (e.key === 'Escape') close();
    });

    document.addEventListener('click', () => close());
    input.addEventListener('click', (e) => e.stopPropagation());
  }
}

/* ---------- 卡片渲染 ---------- */
function metaLine(m) {
  const parts = [];
  if (m.year) parts.push(m.year);
  if (m.countries && m.countries[0]) parts.push(m.countries[0]);
  if (m.category) parts.push(m.category);
  return parts.join(' · ');
}

function cardHTML(m) {
  const fav = m.favorited ? 'on' : '';
  const wl = m.in_watchlist ? 'ok' : '';
  return `
  <div class="card" data-id="${m.id}">
    <div class="poster" style="--h:${m.hue}">
      <span class="poster-cat">${esc(m.category)}</span>
      <div class="corner-fav ${fav}">
        <button class="icon-btn sm-ib ${fav}" data-act="fav" title="收藏">♥</button>
      </div>
      <div class="poster-title">${esc(m.title)}</div>
      <div class="poster-sub">
        ${m.year ? `<span>${m.year}</span>` : ''}
        ${m.avg_rating ? `<span class="score">★ ${m.avg_rating}<small>(${m.rating_cnt})</small></span>` : ''}
        ${m.res_cnt ? '<span class="tag teal">有资源</span>' : ''}
      </div>
      <div class="poster-hover">
        <div class="desc">${esc(m.summary_short || '暂无简介')}</div>
        <div class="row">
          <button class="icon-btn ${fav}" data-act="fav" title="${m.favorited ? '取消收藏' : '收藏'}">♥</button>
          <button class="icon-btn ${wl}" data-act="wl" title="${m.in_watchlist ? '移出稍后再看' : '稍后再看'}">☕</button>
          <a class="btn sm primary" style="flex:1" href="/movie.html?id=${m.id}">查看详情</a>
        </div>
      </div>
    </div>
    <a class="info" href="/movie.html?id=${m.id}">
      <div class="name">${esc(m.title)}</div>
      <div class="meta"><span>${esc(metaLine(m))}</span></div>
    </a>
  </div>`;
}

/** 绑定卡片上的收藏 / 稍后再看按钮 */
function bindCards(root) {
  $$('.card', root).forEach((card) => {
    const id = Number(card.dataset.id);
    $$('[data-act]', card).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!requireUser()) return;
        const act = btn.dataset.act;
        const url = act === 'fav' ? `/api/movies/${id}/favorite` : `/api/movies/${id}/watchlist`;
        try {
          const d = await postJSON(url, {});
          toast(act === 'fav' ? (d.state ? '已加入收藏' : '已取消收藏') : (d.state ? '已加入稍后再看' : '已移出稍后再看'));
          // 同步同一部片的所有卡片状态
          $$('.card[data-id="' + id + '"]').forEach((c) => {
            $$('[data-act="' + act + '"]', c).forEach((b) => b.classList.toggle(act === 'fav' ? 'on' : 'ok', d.state));
            $$('.corner-fav', c).forEach((b) => b.classList.toggle('on', act === 'fav' && d.state));
          });
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  });
}

function pagerHTML(page, pages, onGo) {
  if (pages <= 1) return '';
  // 生成页码窗口：首页 / 末页 / 当前页 ±2
  const win = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) win.push(i);
    else if (win[win.length - 1] !== '…') win.push('…');
  }
  const arr = [`<button data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>`];
  win.forEach((i) => {
    if (i === '…') arr.push('<button disabled>…</button>');
    else arr.push(`<button data-p="${i}" class="${i === page ? 'on' : ''}">${i}</button>`);
  });
  arr.push(`<button data-p="${page + 1}" ${page === pages ? 'disabled' : ''}>›</button>`);
  const html = `<div class="pager">${arr.join('')}</div>`;
  setTimeout(() => {
    $$('.pager button[data-p]').forEach((b) => {
      if (b.hasAttribute('data-p') && !b.disabled && b.textContent !== '…') {
        b.addEventListener('click', () => onGo(Number(b.dataset.p)));
      }
    });
  }, 0);
  return html;
}

function emptyHTML(text, btnText, btnHref) {
  return `<div class="empty">
    <div class="big">🎬</div>
    <p>${esc(text)}</p>
    ${btnText ? `<a class="btn primary" href="${btnHref}">${esc(btnText)}</a>` : ''}
  </div>`;
}

/* ---------- 页脚 ---------- */
function renderFooter() {
  let ft = document.querySelector('footer');
  if (!ft) {
    ft = document.createElement('footer');
    document.body.appendChild(ft);
  }
  ft.innerHTML = `<div class="ft-inner">
    <span>© ${new Date().getFullYear()} ${SITE.name} · 个人影视记录与推荐站</span>
    <a href="/search.html">发现影视</a>
    <a href="/feedback.html">意见反馈</a>
    <span class="ft-spacer">片库共收录 ${FT_MOVIES || 0} 部作品</span>
  </div>`;
}
let FT_MOVIES = 0;
async function initFooter() {
  try {
    const d = await getJSON('/api/movies?size=1');
    FT_MOVIES = d.total || 0;
  } catch { /* ignore */ }
  renderFooter();
}

/* ---------- 初始化 ---------- */
function boot(activeNav, after) {
  renderHeader(activeNav).then(() => {
    initFooter();
    if (after) after();
  });
}
