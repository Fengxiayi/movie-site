/* 影视详情页：基本信息 / 讨论区 / 网盘资源 */
'use strict';

const movieId = Number(qs('id') || 0);
let state = { movie: null, threads: [], resources: [], canPost: false, threadPage: 1, threadPages: 1 };
let curTab = 'intro';

/* ---------- 基本信息区 ---------- */
function headHTML(m) {
  const genreTags = (m.genres || []).map((g) => `<a class="tag gold" href="/search.html?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join(' ');
  const countryTags = (m.countries || []).map((c) => `<a class="tag" href="/search.html?country=${encodeURIComponent(c)}">${esc(c)}</a>`).join(' ');
  return `
  <div class="detail-bg" style="--h:${m.hue}">
    <div class="detail-top">
      <div class="big-poster" style="--h:${m.hue}">
        <div class="bp-title">${esc(m.title)}</div>
        <div class="bp-sub">${esc(m.premiere || '')}${m.episodes ? ' · 全' + m.episodes + '集' : ''}</div>
      </div>
      <div class="detail-info">
        <div class="detail-row">
          <span class="tag gold">${esc(m.category)}</span>
          ${m.episodes ? `<span class="tag">全 ${m.episodes} 集</span>` : '<span class="tag">单部</span>'}
          ${m.res_cnt ? `<span class="tag teal">有 ${m.res_cnt} 个资源</span>` : ''}
        </div>
        <h1>${esc(m.title)}</h1>
        <div class="detail-row">${genreTags} ${countryTags}</div>
        <div class="stats-row">
          <div class="stat"><b>${m.avg_rating ? m.avg_rating.toFixed(1) : '—'}</b><span>站内评分 (${m.rating_cnt} 人)</span></div>
          <div class="stat"><b>${m.fav_cnt}</b><span>收藏</span></div>
          <div class="stat"><b>${m.wl_cnt}</b><span>想看</span></div>
          <div class="stat"><b>${m.view_cnt}</b><span>浏览</span></div>
          <div class="stat"><b>${m.thread_cnt}</b><span>讨论帖</span></div>
        </div>
        <div class="detail-actions" id="actions">
          <button class="btn ${m.favorited ? 'on' : ''}" id="btnFav">${m.favorited ? '♥ 已收藏' : '♡ 收藏'}</button>
          <button class="btn ${m.in_watchlist ? 'on' : ''}" id="btnWl">${m.in_watchlist ? '☕ 已在待看' : '☕ 稍后再看'}</button>
          <span style="color:var(--muted);font-size:13px">我的评分</span>
          <span class="stars" id="stars">${starHTML(m.my_rating || 0)}</span>
          <span id="myScoreTip" style="font-size:13px;color:var(--gold);min-width:44px">${m.my_rating ? m.my_rating + '.0' : '未评'}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function starHTML(n) {
  let h = '';
  for (let i = 1; i <= 10; i++) h += `<button data-s="${i}" class="${i <= n ? 'lit' : ''}" title="${i} 分">★</button>`;
  return h;
}

function introHTML(m) {
  const info = [];
  const add = (k, v) => { if (v && String(v).trim()) info.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
  add('首播', m.premiere);
  add('集数', m.episodes ? `${m.episodes} 集` : (m.category === '电影' ? '单部电影' : ''));
  add('导演', m.director);
  add('编剧', m.writer);
  add('主演', m.actors);
  add('类型', (m.genres || []).join(' / '));
  add('地区', (m.countries || []).join(' / '));
  if (m.source_note) add('备注', m.source_note);

  return `
  <div class="card-box" style="margin-bottom:22px">
    <h3>剧情简介</h3>
    <p style="margin:0;line-height:1.9;color:var(--text-dim);font-size:15px">${esc(m.summary || '暂无简介。')}</p>
  </div>
  <div class="card-box" style="margin-bottom:22px">
    <h3>基本信息</h3>
    <dl class="info-table">${info.join('')}</dl>
  </div>
  <div id="similarBox" class="section">
    <div class="sec-head"><h2>相似推荐</h2><span class="sub">同类型 · 同导演 · 同地区</span></div>
    <div class="rail" id="similarRail"><div class="skeleton sk-card" style="flex:0 0 168px"></div></div>
  </div>`;
}

/* ---------- 讨论区 ---------- */
function threadHTML(t) {
  return `
  <div class="thread" data-tid="${t.id}">
    <div class="thread-head">
      <span class="avatar sm" style="--h:${t.author.avatar_hue}">${esc(t.author.nickname[0])}</span>
      <span class="who">${esc(t.author.nickname)}</span>
      ${t.author.role === 'admin' ? '<span class="tag gold">站长</span>' : ''}
      ${t.pinned ? '<span class="tag rose">置顶</span>' : ''}
      <span class="time">${timeAgo(t.created_at)}</span>
    </div>
    <h3>${esc(t.title)}</h3>
    <p>${esc(t.content)}</p>
    <div class="thread-foot">
      <button class="tbtn ${t.liked ? 'on' : ''}" data-like="${t.id}">${t.liked ? '♥' : '♡'} ${t.like_cnt}</button>
      <a class="tbtn" href="#reply-${t.id}" data-reply="${t.id}">💬 ${t.reply_cnt} 条讨论</a>
      <span style="flex:1"></span>
      <button class="tbtn" data-del-t="${t.id}" style="display:${canManageThread(t) ? '' : 'none'}">删除</button>
    </div>
    <div class="reply-box" id="reply-${t.id}" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
      <div class="comment-list"><div class="hint">加载中…</div></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" placeholder="写下你的看法…" maxlength="300" class="reply-input">
        <button class="btn sm primary" data-send="${t.id}">回复</button>
      </div>
    </div>
  </div>`;
}

function canManageThread(t) {
  const u = currentUser();
  return !!u && (u.role === 'admin' || u.id === t.author.id);
}

function commentHTML(c) {
  return `
  <div class="comment">
    <span class="avatar sm" style="--h:${c.author.avatar_hue}">${esc(c.author.nickname[0])}</span>
    <div class="body">
      <div class="head">
        <span class="who">${esc(c.author.nickname)}</span>
        ${c.author.role === 'admin' ? '<span class="tag gold">站长</span>' : ''}
        <span class="time">${timeAgo(c.created_at)}</span>
      </div>
      <p>${esc(c.content)}</p>
    </div>
  </div>`;
}

function discussionHTML() {
  const u = currentUser();
  const composer = u ? `
    <div class="composer" style="margin-bottom:18px">
      <label class="field"><span>标题</span>
        <input type="text" id="tTitle" maxlength="80" placeholder="一句话表达你的观点">
      </label>
      <label class="field"><span>内容</span>
        <textarea id="tContent" maxlength="3000" placeholder="聊聊这部作品的剧情、表演或幕后…"></textarea>
      </label>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn primary" id="postThread">发布主题帖</button>
        <span class="hint" style="margin:0">请遵守社区礼仪，禁止剧透无标注的人身攻击。</span>
      </div>
      <div class="err" id="threadErr"></div>
    </div>`
    : `<div class="empty" style="margin-bottom:18px"><p>登录后即可参与讨论</p><a class="btn primary" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">立即登录</a></div>`;

  return composer + `<div id="threadList">${threadListHTML()}</div>`;
}

function threadListHTML() {
  if (!state.threads.length) return emptyHTML('还没有人发帖，来做第一个吧');
  return state.threads.map(threadHTML).join('') + pagerHTML(state.threadPage, state.threadPages, (p) => loadThreads(p));
}

/* ---------- 资源区 ---------- */
function resourceHTML() {
  const u = currentUser();
  const form = (state.canPost) ? `
    <div class="composer" style="margin-bottom:18px">
      <h3 style="margin:0 0 14px;font-size:15.5px">发布网盘资源</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 12px">
        <label class="field"><span>网盘类型</span>
          <select id="rPan">${state.panTypes.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>清晰度</span>
          <input type="text" id="rQuality" maxlength="20" placeholder="1080P / 4K">
        </label>
        <label class="field"><span>体积</span>
          <input type="text" id="rSize" maxlength="30" placeholder="约 8.2G">
        </label>
      </div>
      <label class="field"><span>资源标题</span>
        <input type="text" id="rTitle" maxlength="120" placeholder="如：全10集 1080P 简日双语">
      </label>
      <label class="field"><span>链接地址</span>
        <input type="text" id="rUrl" placeholder="https://pan.baidu.com/s/...">
      </label>
      <label class="field"><span>提取码（可留空）</span>
        <input type="text" id="rCode" maxlength="32" placeholder="abcd">
      </label>
      <label class="field"><span>备注（可留空）</span>
        <input type="text" id="rNote" maxlength="500" placeholder="字幕情况、压制说明等">
      </label>
      <button class="btn primary" id="postRes">发布资源</button>
      <div class="err" id="resErr"></div>
    </div>` : '';

  const list = state.resources.length ? state.resources.map(resItemHTML).join('')
    : emptyHTML(u ? '暂无资源，可在反馈页面向站长求资源' : '暂无网盘资源');

  return form + list;
}

function resItemHTML(r) {
  return `
  <div class="res-item ${r.status ? '' : 'dead'}">
    <div class="res-head">
      <span class="t">${esc(r.title)}</span>
      <span class="tag gold">${esc(r.pan)}</span>
      ${r.quality ? `<span class="tag">${esc(r.quality)}</span>` : ''}
      ${r.size_text ? `<span class="tag">${esc(r.size_text)}</span>` : ''}
      ${r.status ? '' : '<span class="tag rose">已失效</span>'}
      <span style="margin-left:auto;color:var(--muted);font-size:12.5px">${esc(r.sharer.nickname)} · ${timeAgo(r.created_at)}</span>
    </div>
    ${r.note ? `<div style="color:var(--muted);font-size:13px;margin-bottom:9px">${esc(r.note)}</div>` : ''}
    <div class="res-link">
      <code>${esc(r.url)}</code>
      <button class="btn sm copy-btn" data-copy="${esc(r.url)}">复制链接</button>
      ${r.code ? `<button class="btn sm copy-btn" data-copy="${esc(r.code)}">复制提取码 ${esc(r.code)}</button>` : ''}
      <a class="btn sm primary" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">前往网盘</a>
      ${state.canPost ? `<button class="btn sm danger" data-res-del="${r.id}">删除</button>` : ''}
    </div>
  </div>`;
}

/* ---------- 主流程 ---------- */
function renderTabs() {
  const m = state.movie;
  $(`#detailSlot`).innerHTML = `
    ${headHTML(m)}
    <div class="tabs">
      <button class="${curTab === 'intro' ? 'on' : ''}" data-tab="intro">简介</button>
      <button class="${curTab === 'discuss' ? 'on' : ''}" data-tab="discuss">讨论区<span class="count">${m.thread_cnt}</span></button>
      <button class="${curTab === 'res' ? 'on' : ''}" data-tab="res">网盘资源<span class="count">${m.res_cnt}</span></button>
    </div>
    <div class="panel ${curTab === 'intro' ? 'on' : ''}" id="p-intro"></div>
    <div class="panel ${curTab === 'discuss' ? 'on' : ''}" id="p-discuss"></div>
    <div class="panel ${curTab === 'res' ? 'on' : ''}" id="p-res"></div>`;

  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    curTab = b.dataset.tab;
    renderTabs();
    fillPanel();
  }));
  if (curTab === 'intro') loadSimilar();
}

function fillPanel() {
  const p = { intro: '#p-intro', discuss: '#p-discuss', res: '#p-res' }[curTab];
  const el = $(p);
  if (curTab === 'intro') { el.innerHTML = introHTML(state.movie); loadSimilar(); }
  if (curTab === 'discuss') { el.innerHTML = discussionHTML(); bindThreads(); }
  if (curTab === 'res') { el.innerHTML = resourceHTML(); bindResources(); }
}

async function loadSimilar() {
  const rail = $('#similarRail');
  if (!rail) return;
  try {
    const d = await getJSON(`/api/movies/${movieId}/similar`);
    rail.innerHTML = d.list.length ? d.list.map(cardHTML).join('') : '<span class="hint">暂无相似推荐</span>';
    bindCards(rail);
  } catch (e) { rail.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
}

/* ---------- 交互绑定 ---------- */
function bindActions() {
  const btnFav = $('#btnFav'), btnWl = $('#btnWl');
  if (btnFav) btnFav.addEventListener('click', async () => {
    if (!requireUser()) return;
    const r = await postJSON(`/api/movies/${movieId}/favorite`, {});
    toast(r.state ? '已收藏' : '已取消收藏');
    btnFav.classList.toggle('on', r.state);
    btnFav.textContent = r.state ? '♥ 已收藏' : '♡ 收藏';
  });
  if (btnWl) btnWl.addEventListener('click', async () => {
    if (!requireUser()) return;
    const r = await postJSON(`/api/movies/${movieId}/watchlist`, {});
    toast(r.state ? '已加入稍后再看' : '已移出稍后再看');
    btnWl.classList.toggle('on', r.state);
    btnWl.textContent = r.state ? '☕ 已在待看' : '☕ 稍后再看';
  });

  const stars = $('#stars');
  if (stars) {
    stars.addEventListener('mouseover', (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const n = Number(e.target.dataset.s);
      $$('button', stars).forEach((b) => b.classList.toggle('lit', Number(b.dataset.s) <= n));
    });
    stars.addEventListener('mouseleave', () => {
      const cur = state.movie.my_rating || 0;
      $$('button', stars).forEach((b) => b.classList.toggle('lit', Number(b.dataset.s) <= cur));
    });
    stars.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      if (!requireUser()) return;
      const score = Number(e.target.dataset.s);
      try {
        const r = await postJSON(`/api/movies/${movieId}/rating`, { score });
        state.movie.my_rating = score;
        state.movie.avg_rating = r.avg_rating;
        state.movie.rating_cnt = r.count;
        $('#myScoreTip').textContent = score + '.0';
        toast('评分已保存');
      } catch (err) { toast(err.message, 'err'); }
    });
  }
}

async function loadThreads(page = 1) {
  try {
    const d = await getJSON(`/api/movies/${movieId}/threads?page=${page}&size=10`);
    state.threads = d.list;
    state.threadPage = d.page;
    state.threadPages = d.pages;
    $('#threadList').innerHTML = threadListHTML();
    bindThreads();
  } catch (e) { toast(e.message, 'err'); }
}

function bindThreads() {
  // 点赞
  $$('[data-like]').forEach((b) => b.addEventListener('click', async () => {
    if (!requireUser()) return;
    try {
      const d = await postJSON(`/api/threads/${b.dataset.like}/like`, {});
      toast(d.liked ? '已点赞' : '已取消点赞');
      loadThreads(state.threadPage);
    } catch (e) { toast(e.message, 'err'); }
  }));

  // 展开/收起回复
  $$('[data-reply]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!requireUser('登录后查看完整讨论')) return;
    const tid = Number(a.dataset.reply);
    const box = $(`#reply-${tid}`);
    const open = box.style.display !== 'none';
    if (open) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    await loadComments(tid, box);
  }));

  // 发送回复
  $$('[data-send]').forEach((b) => b.addEventListener('click', async () => {
    const tid = Number(b.dataset.send);
    const wrap = b.closest('.reply-box');
    const input = $('.reply-input', wrap);
    const content = input.value.trim();
    if (!content) return toast('请输入回复内容', 'err');
    try {
      await postJSON(`/api/threads/${tid}/comments`, { content });
      input.value = '';
      toast('回复已发布');
      await loadComments(tid, wrap);
      const head = b.closest('.thread').querySelector('[data-reply]');
      if (head) head.textContent = `💬 ${Number((head.textContent.match(/\d+/) || [0])[0]) + 1} 条讨论`;
    } catch (e) { toast(e.message, 'err'); }
  }));

  // 输入框回车发送
  $$('.reply-input').forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') i.closest('.reply-box').querySelector('[data-send]').click();
  }));

  // 删除帖
  $$('[data-del-t]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除这个主题帖？相关回复也会一并删除。')) return;
    try {
      await delJSON(`/api/threads/${b.dataset.delT}`);
      toast('已删除');
      loadThreads(state.threadPage);
    } catch (e) { toast(e.message, 'err'); }
  }));

  const postBtn = $('#postThread');
  if (postBtn) postBtn.addEventListener('click', async () => {
    const title = $('#tTitle').value.trim();
    const content = $('#tContent').value.trim();
    const errBox = $('#threadErr');
    if (title.length < 2) return (errBox.textContent = '标题至少 2 个字');
    if (content.length < 2) return (errBox.textContent = '内容至少 2 个字');
    errBox.textContent = '';
    postBtn.disabled = true;
    try {
      await postJSON(`/api/movies/${movieId}/threads`, { title, content });
      toast('发帖成功');
      loadThreads(1);
    } catch (e) { errBox.textContent = e.message; }
    finally { postBtn.disabled = false; }
  });
}

async function loadComments(tid, box) {
  const list = $('.comment-list', box);
  list.innerHTML = '<div class="hint">加载中…</div>';
  try {
    const d = await getJSON(`/api/threads/${tid}`);
    list.innerHTML = d.comments.length ? d.comments.map(commentHTML).join('') : '<div class="hint">还没有回复，抢个沙发？</div>';
  } catch (e) { list.innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
}

async function loadResources() {
  try {
    const d = await getJSON(`/api/movies/${movieId}/resources`);
    state.resources = d.list;
    state.canPost = d.can_post;
    state.panTypes = d.pan_types;
  } catch (e) { toast(e.message, 'err'); }
}

function bindResources() {
  const btn = $('#postRes');
  if (btn) btn.addEventListener('click', async () => {
    const errBox = $('#resErr');
    const body = {
      title: $('#rTitle').value.trim(),
      url: $('#rUrl').value.trim(),
      code: $('#rCode').value.trim(),
      pan: $('#rPan').value,
      quality: $('#rQuality').value.trim(),
      size_text: $('#rSize').value.trim(),
      note: $('#rNote').value.trim(),
    };
    if (!body.title) return (errBox.textContent = '请填写资源标题');
    if (!/^https?:\/\//i.test(body.url)) return (errBox.textContent = '链接需以 http:// 或 https:// 开头');
    errBox.textContent = '';
    btn.disabled = true;
    try {
      await postJSON(`/api/movies/${movieId}/resources`, body);
      toast('资源已发布');
      await loadResources();
      fillPanel();
      updateCounts();
    } catch (e) { errBox.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    const text = b.dataset.copy;
    navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板'), () => toast('复制失败，请手动选择', 'err'));
  }));

  $$('[data-res-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除该资源？')) return;
    try {
      await delJSON(`/api/resources/${b.dataset.resDel}`);
      toast('已删除');
      await loadResources();
      fillPanel();
      updateCounts();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

function updateCounts() {
  const t = $('.tabs [data-tab="res"] .count');
  if (t) t.textContent = state.resources.filter((r) => r.status).length;
}

async function init() {
  if (!movieId) {
    $('#detailSlot').innerHTML = emptyHTML('缺少影视 ID', '去看看首页', '/index.html');
    return;
  }
  try {
    const d = await getJSON(`/api/movies/${movieId}`);
    state.movie = d.movie;
    document.title = `${d.movie.title} · 光影录`;
    await loadResources();
    renderTabs();
    fillPanel();
    bindActions();
    // URL 锚点指定 tab
    const h = location.hash.replace('#', '');
    if (['intro', 'discuss', 'res'].includes(h)) {
      curTab = h;
      renderTabs();
      fillPanel();
    }
  } catch (e) {
    $('#detailSlot').innerHTML = emptyHTML('加载失败：' + e.message, '返回首页', '/index.html');
  }
}

boot('', init);
