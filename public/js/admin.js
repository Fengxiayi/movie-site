/* 管理后台 */
'use strict';

let curTab = qs('tab') || 'overview';
let ov = null;

function shellHTML() {
  return `
  <div class="tabs" id="adTabs">
    <button class="${curTab === 'overview' ? 'on' : ''}" data-tab="overview">数据概览</button>
    <button class="${curTab === 'users' ? 'on' : ''}" data-tab="users">用户管理</button>
    <button class="${curTab === 'feedbacks' ? 'on' : ''}" data-tab="feedbacks">反馈处理${ov.counts.feedbacks_pending ? `<span class="count" style="background:var(--rose);color:#fff">${ov.counts.feedbacks_pending}</span>` : ''}</button>
    <button class="${curTab === 'resources' ? 'on' : ''}" data-tab="resources">资源维护</button>
  </div>
  <div id="adBody"></div>`;
}

function overviewHTML() {
  const c = ov.counts;
  const box = (b, s) => `<div class="stat-box" style="cursor:default"><b>${b}</b><span>${s}</span></div>`;
  return `
  <div class="stat-grid">
    ${box(c.movies, '影视总数')}${box(c.users, '注册用户')}${box(c.new_users_today, '今日新增')}
    ${box(c.threads, '讨论帖')}${box(c.comments, '回复数')}${box(c.resources, '网盘资源')}
    ${box(c.favorites, '收藏总数')}${box(c.feedbacks_pending, '待处理反馈')}
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px">
    <div class="card-box">
      <h3>最受欢迎 Top 8</h3>
      <ol style="margin:0;padding-left:20px;line-height:2.1;font-size:14.5px">
        ${ov.top_movies.map((m) => `<li><a href="/movie.html?id=${m.id}">${esc(m.title)}</a> <span style="color:var(--muted)">· ${m.c} 人收藏</span></li>`).join('') || '<li class="hint">暂无数据</li>'}
      </ol>
    </div>
    <div class="card-box">
      <h3>最活跃用户 Top 8</h3>
      <ol style="margin:0;padding-left:20px;line-height:2.1;font-size:14.5px">
        ${ov.active_users.map((u) => `<li>${esc(u.nickname || u.username)} <span style="color:var(--muted)">· ${u.c} 帖</span></li>`).join('') || '<li class="hint">暂无数据</li>'}
      </ol>
    </div>
  </div>`;
}

async function renderUsers() {
  const body = $('#adBody');
  body.innerHTML = '<div class="hint">加载中…</div>';
  try {
    const d = await getJSON('/api/admin/users');
    body.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ID</th><th>用户</th><th>角色</th><th>状态</th><th>收藏/帖/回复</th><th>注册时间</th><th>最后登录</th><th>操作</th></tr></thead>
        <tbody>${d.list.map((u) => `
          <tr>
            <td>${u.id}</td>
            <td><a href="/movie.html" onclick="return false">${esc(u.nickname || u.username)}</a> <span style="color:var(--muted)">@${esc(u.username)}</span></td>
            <td>${u.role === 'admin' ? '<span class="tag gold">管理员</span>' : '<span class="tag">普通用户</span>'}</td>
            <td>${u.status === 'active' ? '<span class="tag teal">正常</span>' : '<span class="tag rose">已封禁</span>'}</td>
            <td>${u.fav_cnt} / ${u.thread_cnt} / ${u.comment_cnt}</td>
            <td style="color:var(--muted);font-size:13px">${dateStr(u.created_at)}</td>
            <td style="color:var(--muted);font-size:13px">${u.last_login ? timeAgo(u.last_login) : '—'}</td>
            <td>
              ${u.role === 'admin'
                ? '<span class="hint">不可操作</span>'
                : `<button class="btn sm" data-ban="${u.id}" data-v="${u.status === 'active' ? 'banned' : 'active'}">${u.status === 'active' ? '封禁' : '解封'}</button>
                   <button class="btn sm" data-role="${u.id}" data-v="admin">设为管理员</button>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    const act = (sel, key) => $$(sel).forEach((b) => b.addEventListener('click', async () => {
      try {
        await putJSON(`/api/admin/users/${b.dataset.ban || b.dataset.role}`, { [key]: b.dataset.v });
        toast('操作成功');
        renderUsers();
      } catch (e) { toast(e.message, 'err'); }
    }));
    act('[data-ban]', 'status');
    act('[data-role]', 'role');
  } catch (e) { body.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
}

async function renderFeedbacks() {
  const body = $('#adBody');
  body.innerHTML = '<div class="hint">加载中…</div>';
  try {
    const d = await getJSON('/api/admin/feedbacks?status=' + (qs('status') || '全部'));
    if (!d.list.length) return (body.innerHTML = emptyHTML('暂时没有反馈'));
    body.innerHTML = d.list.map((f) => {
      const s = { pending: '待处理', processing: '处理中', resolved: '已解决' }[f.status];
      return `
      <div class="fb-item">
        <div class="top">
          <span class="tag">${esc(f.type_name)}</span>
          <span class="tag ${f.status === 'resolved' ? 'teal' : f.status === 'processing' ? 'gold' : ''}">${s}</span>
          <span style="color:var(--muted);font-size:12.5px">${esc(f.author.nickname)} · ${timeAgo(f.created_at)}</span>
          ${f.contact ? `<span class="tag">联系方式：${esc(f.contact)}</span>` : ''}
        </div>
        <div style="color:var(--text-dim);font-size:14.5px;line-height:1.75;white-space:pre-wrap">${esc(f.content)}</div>
        ${f.reply ? `<div class="reply"><b style="color:var(--teal)">已回复：</b>${esc(f.reply)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap">
          <input type="text" placeholder="输入回复内容…" maxlength="500" data-r="${f.id}" style="flex:1;min-width:180px">
          <button class="btn sm primary" data-reply="${f.id}">回复并结案</button>
          ${f.status === 'pending' ? `<button class="btn sm" data-proc="${f.id}">标记处理中</button>` : ''}
        </div>
      </div>`;
    }).join('');

    $$('[data-reply]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.reply;
      const txt = $(`[data-r="${id}"]`).value.trim();
      if (!txt) return toast('请输入回复内容', 'err');
      try {
        await putJSON(`/api/feedbacks/${id}`, { reply: txt });
        toast('已回复');
        renderFeedbacks();
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-proc]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await putJSON(`/api/feedbacks/${b.dataset.proc}`, { status: 'processing' });
        toast('已标记');
        renderFeedbacks();
      } catch (e) { toast(e.message, 'err'); }
    }));
  } catch (e) { body.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
}

async function renderResources() {
  const body = $('#adBody');
  body.innerHTML = '<div class="hint">加载中…</div>';
  try {
    const d = await getJSON('/api/admin/resources?limit=100');
    if (!d.list.length) return (body.innerHTML = emptyHTML('还没有发布任何资源'));
    body.innerHTML = `
      <div class="hint" style="margin-bottom:12px">如需发布资源，请进入对应影视详情页的「网盘资源」标签操作。</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ID</th><th>影视</th><th>标题</th><th>网盘</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>${d.list.map((r) => `
          <tr>
            <td>${r.id}</td>
            <td><a href="/movie.html?id=${r.movie_id}#res">${esc(r.movie_title)}</a></td>
            <td>${esc(r.title)}</td>
            <td><span class="tag gold">${esc(r.pan)}</span></td>
            <td>${r.status ? '<span class="tag teal">正常</span>' : '<span class="tag rose">失效</span>'}</td>
            <td style="color:var(--muted);font-size:13px">${dateStr(r.created_at)}</td>
            <td>
              <button class="btn sm" data-tog="${r.id}" data-v="${r.status ? 0 : 1}">${r.status ? '标记失效' : '恢复有效'}</button>
              <button class="btn sm danger" data-del="${r.id}">删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    $$('[data-tog]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await putJSON(`/api/resources/${b.dataset.tog}`, { status: Number(b.dataset.v) === 1 });
        toast('已更新');
        renderResources();
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('确定删除该资源？')) return;
      try {
        await delJSON(`/api/resources/${b.dataset.del}`);
        toast('已删除');
        renderResources();
      } catch (e) { toast(e.message, 'err'); }
    }));
  } catch (e) { body.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
}

function renderBody() {
  $$('#adTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === curTab));
  history.replaceState(null, '', '/admin.html?tab=' + curTab);
  if (curTab === 'overview') $('#adBody').innerHTML = overviewHTML();
  if (curTab === 'users') renderUsers();
  if (curTab === 'feedbacks') renderFeedbacks();
  if (curTab === 'resources') renderResources();
}

async function init() {
  try {
    ov = (await getJSON('/api/admin/overview'));
  } catch (e) {
    $('#adminRoot').innerHTML = emptyHTML(
      /管理员/.test(e.message) ? '仅管理员可访问此页面' : '加载失败：' + e.message,
      '返回首页', '/index.html');
    return;
  }
  $('#adminRoot').innerHTML = shellHTML();
  $$('#adTabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    curTab = b.dataset.tab;
    renderBody();
  }));
  renderBody();
}

boot('', init);
