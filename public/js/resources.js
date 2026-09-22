/* 资源放送 board：最新网盘资源聚合 */
'use strict';

async function load() {
  const box = $('#resBox');
  try {
    const d = await getJSON('/api/resources/latest?limit=40');
    if (!d.list.length) {
      box.innerHTML = emptyHTML('还没有任何资源放送', '去发现页看看', '/search.html');
      return;
    }
    box.innerHTML = d.list.map((r) => `
      <div class="res-item">
        <div class="res-head">
          <span class="t">${esc(r.movie_title)}</span>
          <span class="tag gold">${esc(r.pan)}</span>
          ${r.quality ? `<span class="tag">${esc(r.quality)}</span>` : ''}
          ${r.size_text ? `<span class="tag">${esc(r.size_text)}</span>` : ''}
          <span style="margin-left:auto;color:var(--muted);font-size:12.5px">${timeAgo(r.created_at)}</span>
        </div>
        <div style="font-size:14px;color:var(--text-dim);margin-bottom:10px">${esc(r.title)}</div>
        ${r.note ? `<div style="color:var(--muted);font-size:13px;margin-bottom:9px">${esc(r.note)}</div>` : ''}
        <div class="res-link">
          <code>${esc(r.url)}</code>
          <button class="btn sm copy-btn" data-copy="${esc(r.url)}">复制链接</button>
          ${r.code ? `<button class="btn sm copy-btn" data-copy="${esc(r.code)}">提取码 ${esc(r.code)}</button>` : ''}
          <a class="btn sm" href="/movie.html?id=${r.movie_id}#res">影视详情</a>
          <a class="btn sm primary" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">前往网盘</a>
        </div>
      </div>`).join('');

    $$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.copy)
        .then(() => toast('已复制'), () => toast('复制失败，请手动选择', 'err'));
    }));
  } catch (e) {
    box.innerHTML = emptyHTML('加载失败：' + e.message);
  }
}

boot('resources', load);
