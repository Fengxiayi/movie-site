/* 首页：Hero + 各推荐板块 */
'use strict';

const MORE_LINK = {
  'hot': '/search.html?sort=hot',
  'high-rated': '/search.html?sort=rating',
  'latest': '/search.html?sort=year_desc',
  'resource': '/resources.html',
  'discussed': '/search.html?sort=fav',
};

function heroHTML(m) {
  if (!m) return '';
  const genres = (m.genres || []).slice(0, 3).map((g) => `<span class="tag gold">${esc(g)}</span>`).join('');
  return `
  <section class="hero" style="--h:${m.hue}">
    <div class="hero-body">
      <span class="hero-badge">今日推荐</span>
      <h1>${esc(m.title)}</h1>
      <div class="hero-meta">
        <span class="tag">${esc(m.category)}</span>
        <span class="tag">${esc(m.year || '未知年份')}</span>
        ${m.countries[0] ? `<span class="tag">${esc(m.countries[0])}</span>` : ''}
        ${genres}
        ${m.avg_rating ? `<span class="score">★ ${m.avg_rating}</span>` : ''}
      </div>
      <p class="sum">${esc(m.summary || '暂无简介信息。')}</p>
      <div class="hero-actions">
        <a class="btn primary" href="/movie.html?id=${m.id}">查看详情</a>
        <button class="btn" data-hero="fav" data-id="${m.id}">♥ 收藏</button>
        <button class="btn" data-hero="wl" data-id="${m.id}">☕ 稍后再看</button>
      </div>
    </div>
  </section>`;
}

function sectionHTML(s) {
  const more = MORE_LINK[s.key];
  return `
  <section class="section">
    <div class="sec-head">
      <h2>${esc(s.title)}</h2>
      <span class="sub">${esc(s.sub || '')}</span>
      ${more ? `<a class="more" href="${more}">查看全部 →</a>` : ''}
    </div>
    <div class="rail">
      ${s.list.map(cardHTML).join('')}
    </div>
  </section>`;
}

async function loadHome() {
  const heroSlot = $('#heroSlot');
  const secSlot = $('#secSlot');
  try {
    const d = await getJSON('/api/home');
    heroSlot.innerHTML = heroHTML(d.hero);

    heroSlot.querySelectorAll('[data-hero]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!requireUser()) return;
        const id = Number(btn.dataset.id);
        const act = btn.dataset.hero;
        const url = act === 'fav' ? `/api/movies/${id}/favorite` : `/api/movies/${id}/watchlist`;
        try {
          const r = await postJSON(url, {});
          toast(act === 'fav' ? (r.state ? '已收藏《' + d.hero.title + '》' : '已取消收藏') : (r.state ? '已加入稍后再看' : '已移出稍后再看'));
          btn.classList.toggle('on', r.state);
        } catch (e) { toast(e.message, 'err'); }
      });
    });

    secSlot.innerHTML = (d.sections || []).map(sectionHTML).join('');
    bindCards(secSlot);
  } catch (e) {
    secSlot.innerHTML = emptyHTML('加载失败：' + e.message);
  }
}

boot('home', loadHome);
