/* 个人主页 */
'use strict';

const TABS = [
  { key: 'favorites', label: '收藏', stat: 'favorites' },
  { key: 'watchlist', label: '稍后再看', stat: 'watchlist' },
  { key: 'ratings', label: '我的评分', stat: 'ratings' },
  { key: 'threads', label: '我的发帖', stat: 'threads' },
  { key: 'comments', label: '我的回复', stat: 'comments' },
  { key: 'history', label: '浏览历史', stat: 'history' },
];

let curTab = TABS.some((t) => t.key === qs('tab')) ? qs('tab') : 'favorites';
let data = null;

function shellHTML() {
  const u = data.user;
  const st = data.stats;
  return `
  <div class="profile-head">
    <span class="avatar lg" style="--h:${u.avatar_hue}">${esc((u.nickname || u.username)[0])}</span>
    <div class="who">
      <h1>${esc(u.nickname || u.username)}<span style="font-size:13px;color:var(--muted);font-weight:400"> @${esc(u.username)}</span></h1>
      <div class="bio">${esc(u.bio || '这个人很懒，还没有写简介')}</div>
      <div style="margin-top:8px;display:flex;gap:7px;flex-wrap:wrap">
        ${u.role === 'admin' ? '<span class="tag gold">站长</span>' : '<span class="tag">影迷</span>'}
        <span class="tag">加入于 ${dateStr(u.created_at).slice(0, 10)}</span>
      </div>
    </div>
    <div class="spacer">
      <button class="btn sm" id="editProfile">编辑资料</button>
      <button class="btn sm ghost" id="editPass">修改密码</button>
    </div>
  </div>

  <div class="stat-grid" id="statGrid">
    ${TABS.map((t) => `<div class="stat-box ${curTab === t.key ? 'on' : ''}" data-tab="${t.key}">
      <b>${st[t.stat] || 0}</b><span>${t.label}</span></div>`).join('')}
    <div class="stat-box" style="cursor:default"><b>${st.likes_received || 0}</b><span>获赞</span></div>
  </div>

  <div class="card-box" style="margin-bottom:22px" id="tasteBox">
    <h3>我的口味画像</h3>
    <div id="tasteBody" class="hint">加载中…</div>
  </div>

  <div class="tabs" id="meTabs">
    ${TABS.map((t) => `<button class="${curTab === t.key ? 'on' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
  </div>
  <div id="meList"></div>`;
}

function tasteHTML() {
  const t = data.taste || {};
  const line = (title, arr, color) => {
    if (!arr || !arr.length) return `<div style="margin-bottom:8px"><span style="color:var(--muted);font-size:13px">${title}：</span><span class="hint">暂无数据</span></div>`;
    return `<div style="margin-bottom:10px;display:flex;gap:7px;flex-wrap:wrap;align-items:center">
      <span style="color:var(--muted);font-size:13px;min-width:52px">${title}</span>
      ${arr.map((x) => `<a class="tag ${color}" href="/search.html?${title === '类型' ? 'genre' : title === '地区' ? 'country' : 'category'}=${encodeURIComponent(x.name)}">${esc(x.name)}</a>`).join('')}
    </div>`;
  };
  return line('类型', t.genres, 'gold') + line('地区', t.countries, 'teal') + line('分类', t.categories, '');
}

function itemHTML(m) {
  const base = `<a class="card" href="/movie.html?id=${m.id}">`;
  return `<div class="card" data-id="${m.id}">
    <div class="poster" style="--h:${m.hue}">
      <span class="poster-cat">${esc(m.category)}</span>
      <div class="corner-fav on"><button class="icon-btn sm-ib on" data-act="fav">♥</button></div>
      <div class="poster-title">${esc(m.title)}</div>
      <div class="poster-sub">
        ${m.year ? `<span>${m.year}</span>` : ''}
        ${m.my_rating ? `<span class="score">我评 ${m.my_rating}</span>` : ''}
        ${m.added_at ? `<span>${timeAgo(m.added_at)}</span>` : ''}
      </div>
      <div class="poster-hover">
        <div class="desc">${esc(m.summary_short || '')}</div>
        <div class="row">
          <button class="icon-btn on" data-act="fav" title="取消收藏">♥</button>
          <button class="icon-btn ${m.in_watchlist ? 'ok' : ''}" data-act="wl" title="稍后再看">☕</button>
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

function threadItemHTML(t) {
  return `
  <div class="thread">
    <h3><a href="/movie.html?id=${t.movie ? t.movie.id : ''}#discuss">${esc(t.title)}</a></h3>
    <p>${esc(t.content)}</p>
    <div class="thread-foot">
      ${t.movie ? `<span class="tag">${esc(t.movie.title)}</span>` : ''}
      <span class="time" style="margin-left:auto;color:var(--muted);font-size:12.5px">${timeAgo(t.created_at)}</span>
      <span class="hint">💬 ${t.reply_cnt} · ♥ ${t.like_cnt}</span>
    </div>
  </div>`;
}

function commentItemHTML(c) {
  return `
  <div class="thread">
    <p>${esc(c.content)}</p>
    <div class="thread-foot">
      ${c.thread ? `<span class="tag">回复：${esc(c.thread.title)}</span>` : ''}
      ${c.movie ? `<a class="tag gold" href="/movie.html?id=${c.movie.id}#discuss">${esc(c.movie.title)}</a>` : ''}
      <span class="time" style="margin-left:auto;color:var(--muted);font-size:12.5px">${timeAgo(c.created_at)}</span>
    </div>
  </div>`;
}

async function loadTab(page = 1) {
  const box = $('#meList');
  box.innerHTML = `<div class="grid">${Array(6).fill('<div class="card"><div class="poster skeleton sk-card"></div></div>').join('')}</div>`;
  try {
    const d = await getJSON(`/api/me/list?tab=${curTab}&page=${page}&size=24`);
    let inner;
    if (!d.list.length) {
      const tips = {
        favorites: '还没有收藏影片，去首页挑几部吧',
        watchlist: '待看清单是空的',
        ratings: '还没有给影片打过分',
        threads: '还没有发表过主题帖',
        comments: '还没有回复过讨论',
        history: '暂无浏览记录',
      };
      inner = emptyHTML(tips[curTab] || '暂无数据', '去发现影视', '/search.html');
    } else if (curTab === 'threads') {
      inner = d.list.map(threadItemHTML).join('');
    } else if (curTab === 'comments') {
      inner = d.list.map(commentItemHTML).join('');
    } else {
      inner = `<div class="grid">${d.list.map(itemHTML).join('')}</div>`;
    }
    box.innerHTML = inner + pagerHTML(d.page, d.pages, (p) => loadTab(p));
    bindCards(box);
  } catch (e) {
    box.innerHTML = emptyHTML('加载失败：' + e.message);
  }
}

function bindTabs() {
  $$('#meTabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    curTab = b.dataset.tab;
    $$('#meTabs [data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === curTab));
    $$('#statGrid [data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === curTab));
    history.replaceState(null, '', '?tab=' + curTab);
    loadTab(1);
  }));
  $$('#statGrid [data-tab]').forEach((b) => b.addEventListener('click', () => {
    $(`#meTabs [data-tab="${b.dataset.tab}"]`).click();
    scrollTo({ top: $('#meTabs').offsetTop - 80, behavior: 'smooth' });
  }));

  $('#editProfile').addEventListener('click', () => editProfile());
  $('#editPass').addEventListener('click', () => changePass());
}

function editProfile() {
  const u = data.user;
  const html = `
    <label class="field"><span>昵称</span><input type="text" id="pNick" maxlength="24" value="${esc(u.nickname)}"></label>
    <label class="field"><span>个人简介</span><textarea id="pBio" maxlength="200" style="min-height:70px">${esc(u.bio)}</textarea></label>
    <label class="field"><span>头像色相（0-360）</span><input type="number" id="pHue" min="0" max="360" value="${u.avatar_hue}"></label>
    <div style="display:flex;align-items:center;gap:12px">
      <span class="avatar lg" id="pHuePreview" style="--h:${u.avatar_hue}">${esc((u.nickname || u.username)[0])}</span>
      <span class="hint">拖动数值可更换配色</span>
    </div>`;
  modal('编辑个人资料', html, async () => {
    try {
      const d = await putJSON('/api/auth/profile', {
        nickname: $('#pNick').value.trim(),
        bio: $('#pBio').value.trim(),
        avatar_hue: Number($('#pHue').value),
      });
      setUser(d.user);
      toast('资料已更新');
      setTimeout(() => location.reload(), 600);
    } catch (e) { throw e; }
  });
  $('#pHue').addEventListener('input', (e) => {
    const v = Number(e.target.value) || 0;
    const pv = $('#pHuePreview');
    pv.style.setProperty('--h', v);
    pv.style.background = `linear-gradient(140deg, hsl(${v} 82% 68%), hsl(${(v + 45) % 360} 75% 52%))`;
  });
}

function changePass() {
  const html = `
    <label class="field"><span>原密码</span><input type="password" id="op" maxlength="64"></label>
    <label class="field"><span>新密码（至少 6 位）</span><input type="password" id="np" maxlength="64"></label>
    <label class="field"><span>确认新密码</span><input type="password" id="np2" maxlength="64"></label>`;
  modal('修改密码', html, async () => {
    if ($('#np').value !== $('#np2').value) throw new Error('两次输入的新密码不一致');
    await postJSON('/api/auth/password', { old_password: $('#op').value, new_password: $('#np').value });
    toast('密码已修改，请重新登录');
    setTimeout(() => location.href = '/login.html', 900);
  });
}

function modal(title, bodyHTML, onSubmit) {
  let box = $('#modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'modal';
    box.style.cssText = `position:fixed;inset:0;z-index:300;background:rgba(4,5,8,.72);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)`;
    document.body.appendChild(box);
  }
  box.innerHTML = `
    <div style="width:100%;max-width:430px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:var(--shadow)">
      <h2 style="margin:0 0 18px;font-size:19px;font-weight:700">${esc(title)}</h2>
      <div id="modalBody">${bodyHTML}</div>
      <div class="err" id="modalErr"></div>
      <div style="display:flex;gap:9px;margin-top:8px">
        <button class="btn" id="modalCancel" style="flex:1">取消</button>
        <button class="btn primary" id="modalOk" style="flex:1">保存</button>
      </div>
    </div>`;
  const close = () => box.remove();
  $('#modalCancel').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  $('#modalOk').addEventListener('click', async () => {
    const err = $('#modalErr');
    err.textContent = '';
    try {
      await onSubmit();
      close();
    } catch (e) { err.textContent = e.message; }
  });
}

async function init() {
  try {
    data = await getJSON('/api/me');
  } catch (e) {
    if (e.status === 401 || /登录/.test(e.message)) {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    $('#root').innerHTML = emptyHTML('加载失败：' + e.message);
    return;
  }
  $('#root').innerHTML = shellHTML();
  $('#tasteBody').innerHTML = tasteHTML();
  bindTabs();
  loadTab(1);
}

boot('', init);
