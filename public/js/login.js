/* 登录 / 注册 */
'use strict';

const nextUrl = qs('next') || '/index.html';

function showTab(which) {
  const isLogin = which === 'login';
  $('#tabLogin').classList.toggle('on', isLogin);
  $('#tabReg').classList.toggle('on', !isLogin);
  $('#formLogin').style.display = isLogin ? '' : 'none';
  $('#formReg').style.display = isLogin ? 'none' : '';
  $('#lErr').textContent = '';
  $('#rErr').textContent = '';
}

function go() {
  location.href = nextUrl.startsWith('/') ? nextUrl : '/index.html';
}

function bindEvents() {
  $('#tabLogin').addEventListener('click', () => showTab('login'));
  $('#tabReg').addEventListener('click', () => showTab('reg'));

  const caps = (e, input, btn) => {
    if (e.key === 'Enter') $(btn).click();
  };
  $('#lPass').addEventListener('keydown', (e) => caps(e, '#lPass', '#btnLogin'));
  $('#lUser').addEventListener('keydown', (e) => caps(e, '#lUser', '#btnLogin'));
  $('#rPass2').addEventListener('keydown', (e) => caps(e, '#rPass2', '#btnReg'));

  $('#btnLogin').addEventListener('click', async () => {
    const err = $('#lErr');
    err.textContent = '';
    const username = $('#lUser').value.trim();
    const password = $('#lPass').value;
    if (!username) return (err.textContent = '请输入用户名');
    if (!password) return (err.textContent = '请输入密码');
    const btn = $('#btnLogin');
    btn.disabled = true; btn.textContent = '登录中…';
    try {
      const d = await postJSON('/api/auth/login', { username, password });
      setUser(d.user);
      toast('欢迎回来，' + (d.user.nickname || d.user.username));
      setTimeout(go, 500);
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = '登录';
    }
  });

  $('#btnReg').addEventListener('click', async () => {
    const err = $('#rErr');
    err.textContent = '';
    const username = $('#rUser').value.trim();
    const nickname = $('#rNick').value.trim();
    const password = $('#rPass').value;
    const password2 = $('#rPass2').value;
    if (username.length < 2) return (err.textContent = '用户名至少 2 位');
    if (password.length < 6) return (err.textContent = '密码至少 6 位');
    if (password !== password2) return (err.textContent = '两次输入的密码不一致');
    const btn = $('#btnReg');
    btn.disabled = true; btn.textContent = '注册中…';
    try {
      const d = await postJSON('/api/auth/register', { username, password, nickname });
      setUser(d.user);
      toast('注册成功，已自动登录');
      setTimeout(go, 500);
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = '注册并登录';
    }
  });
}

boot('', async () => {
  const u = await loadUser(true);
  if (u) {
    // 已登录直接跳回目标页
    location.replace(nextUrl.startsWith('/') ? nextUrl : '/index.html');
    return;
  }
  bindEvents();
  if (location.hash === '#reg') showTab('reg');
});
