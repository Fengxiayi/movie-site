/* 意见反馈：提交 + 我的记录 */
'use strict';

const STATUS = {
  pending: { cls: '', text: '待处理' },
  processing: { cls: 'gold', text: '处理中' },
  resolved: { cls: 'teal', text: '已解决' },
};

function itemHTML(f) {
  const s = STATUS[f.status] || STATUS.pending;
  return `
  <div class="fb-item">
    <div class="top">
      <span class="tag ${s.cls}">${esc(f.type_name)}</span>
      <span class="tag ${s.cls}">${esc(s.text)}</span>
      <span style="margin-left:auto;color:var(--muted);font-size:12.5px">${timeAgo(f.created_at)}</span>
    </div>
    <div style="color:var(--text-dim);font-size:14.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word">${esc(f.content)}</div>
    ${f.reply ? `<div class="reply"><b style="color:var(--teal)">站长回复：</b>${esc(f.reply)}</div>` : ''}
  </div>`;
}

async function loadMine() {
  const u = await loadUser();
  const box = $('#mineBox');
  if (!u) {
    box.innerHTML = `<div class="empty" style="padding:30px"><p>登录后可查看你的反馈与站长回复</p>
      <a class="btn sm primary" href="/login.html?next=%2Ffeedback.html">去登录</a></div>`;
    return;
  }
  try {
    const d = await getJSON('/api/feedbacks/mine');
    box.innerHTML = d.list.length ? d.list.map(itemHTML).join('')
      : '<div class="empty" style="padding:30px"><p>还没有提交过反馈</p></div>';
  } catch (e) {
    box.innerHTML = `<span class="hint">加载失败：${esc(e.message)}</span>`;
  }
}

function bindSubmit() {
  $('#fbSubmit').addEventListener('click', async () => {
    const err = $('#fbErr');
    err.textContent = '';
    const content = $('#fbContent').value.trim();
    if (content.length < 5) return (err.textContent = '请至少填写 5 个字');
    const btn = $('#fbSubmit');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      await postJSON('/api/feedbacks', {
        type: $('#fbType').value,
        content,
        contact: $('#fbContact').value.trim(),
      });
      toast('反馈已提交，感谢你的建议');
      $('#fbContent').value = '';
      $('#fbContact').value = '';
      loadMine();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false; btn.textContent = '提交反馈';
    }
  });
}

boot('feedback', () => {
  bindSubmit();
  loadMine();
  if (qs('mine')) {
    setTimeout(() => scrollTo({ top: $('#mineBox').offsetTop - 90, behavior: 'smooth' }), 300);
  }
});
