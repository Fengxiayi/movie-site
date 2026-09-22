/* 发现页：筛选 + 排序 + 分页 */
'use strict';

const S = {
  q: qs('q'),
  category: qs('category'),
  genre: qs('genre'),
  country: qs('country'),
  decade: qs('decade'),
  sort: qs('sort') || 'hot',
  has_resource: qs('has_resource') || '',
  page: Number(qs('page') || 1),
  size: 24,
};

function buildQuery() {
  const p = new URLSearchParams();
  Object.entries(S).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined && k !== 'size') p.set(k, v);
  });
  p.set('size', S.size);
  return p.toString();
}

function syncURL() {
  const s = buildQuery();
  history.replaceState(null, '', location.pathname + '?' + s);
}

function fillSelect(el, items, cur, label) {
  el.innerHTML = `<option value="">${label}</option>` +
    items.map((it) => `<option value="${esc(it.name)}" ${String(it.name) === String(cur) ? 'selected' : ''}>${esc(it.name)} (${it.count})</option>`).join('');
}

async function loadFilters() {
  try {
    const d = await getJSON('/api/filters');
    fillSelect($('#fCategory'), d.categories, S.category, '全部分类');
    fillSelect($('#fGenre'), d.genres, S.genre, '全部类型');
    fillSelect($('#fCountry'), d.countries, S.country, '全部地区');
    $('#fDecade').innerHTML = `<option value="">全部年代</option>` + d.decades.map((it) =>
      `<option value="${String(it.name).replace('年代', '')}" ${String(it.name).replace('年代', '') === String(S.decade) ? 'selected' : ''}>${esc(it.name)} (${it.count})</option>`).join('');
    $('#fSort').value = S.sort;
    $('#fRes').value = S.has_resource;
  } catch (e) { toast('筛选项加载失败', 'err'); }
}

async function loadResults() {
  const box = $('#resultBox');
  box.innerHTML = `<div class="grid">${Array(12).fill('<div class="card"><div class="poster skeleton sk-card"></div></div>').join('')}</div>`;
  try {
    const d = await getJSON('/api/movies?' + buildQuery());
    $('#pgTitle').textContent = S.q ? `搜索「${S.q}」` : '发现影视';
    $('#pgSub').textContent = S.q
      ? `共找到 ${d.total} 条结果`
      : `共 ${d.total} 部作品，按${$('#fSort').selectedOptions[0].textContent}排序`;

    if (!d.list.length) {
      box.innerHTML = emptyHTML('没有符合条件的影视，换个条件试试', '看看首页推荐', '/index.html');
      return;
    }
    box.innerHTML = `<div class="grid">${d.list.map(cardHTML).join('')}</div>` +
      pagerHTML(d.page, d.pages, (p) => { S.page = p; loadResults(); syncURL(); scrollTo({ top: 0, behavior: 'smooth' }); });
    bindCards(box);
  } catch (e) {
    box.innerHTML = emptyHTML('加载失败：' + e.message);
  }
}

function bindToolbar() {
  const map = { fCategory: 'category', fGenre: 'genre', fCountry: 'country', fDecade: 'decade', fSort: 'sort', fRes: 'has_resource' };
  Object.entries(map).forEach(([id, key]) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', () => { S[key] = el.value; S.page = 1; loadResults(); syncURL(); });
  });
  $('#resetBtn').addEventListener('click', () => {
    location.href = '/search.html';
  });
}

boot('search', async () => {
  await loadFilters();
  bindToolbar();
  await loadResults();
});
