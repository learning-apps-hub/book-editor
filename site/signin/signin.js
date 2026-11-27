// Sign in to Book Editor: email + passcode (the usual way), or choose a passcode from a one-time invite link
// (/signin/#i=<token>; the part after # never reaches any server log). Google / email code is the other way in (/sso).
const W = {
  en: { name: 'English', title: 'Sign in', welcome: 'Welcome to Book Editor', hello: 'Hello {name}', email: 'Email', pass: 'Passcode',
    signin: 'Sign in', or: 'or', sso: 'Sign in with Google or an email code', forgot: 'Forgot your passcode? Ask the owner to send you a new link.',
    newHere: 'New here?', ask: 'Ask to join', choose: 'Choose a passcode', chooseHelp: 'At least 6 letters, numbers or characters. Your phone or browser can remember it for you.',
    resetHelp: 'Choose a new passcode. Your other devices will be signed out.', newPass: 'New passcode', again: 'Type it again', show: 'Show',
    save: 'Save and open Book Editor', wrong: 'The email or passcode is not right.', locked: 'Too many wrong tries. Please wait 15 minutes and try again.',
    short: 'Use at least 6 characters.', differ: 'The two passcodes are not the same.', badLink: 'This link has already been used or has expired. Ask the owner for a new one.',
    notListed: 'That account is not on the list yet. Ask to join, or sign in with your passcode.', ssoFail: 'That sign-in did not work. Try again, or use your passcode.',
    out: 'You are signed out on this device.', fail: 'That did not work. Please try again.', off: 'Sign-in is not set up on this copy of Book Editor.', loading: 'Loading…' },
  zh: { name: '中文', title: '登录', welcome: '欢迎使用 Book Editor', hello: '你好，{name}', email: '邮箱', pass: '密码',
    signin: '登录', or: '或者', sso: '用 Google 或邮箱验证码登录', forgot: '忘记密码？请所有者给你发一个新链接。',
    newHere: '第一次来？', ask: '申请加入', choose: '设置密码', chooseHelp: '至少 6 个字母、数字或字符。手机或浏览器可以帮你记住。',
    resetHelp: '设置新密码。你的其他设备会被退出登录。', newPass: '新密码', again: '再输入一次', show: '显示',
    save: '保存并打开 Book Editor', wrong: '邮箱或密码不对。', locked: '错误次数太多。请等 15 分钟再试。',
    short: '至少 6 个字符。', differ: '两次输入的密码不一样。', badLink: '这个链接已经用过或已过期。请所有者再发一个。',
    notListed: '这个账户还不在名单上。请申请加入，或用密码登录。', ssoFail: '这次登录没有成功。请再试一次，或用密码登录。',
    out: '你已在这台设备上退出登录。', fail: '没有成功，请再试一次。', off: '这个 Book Editor 副本没有设置登录。', loading: '正在载入…' },
  pl: { name: 'Polski', title: 'Zaloguj się', welcome: 'Witaj w Book Editor', hello: 'Cześć, {name}', email: 'E-mail', pass: 'Hasło',
    signin: 'Zaloguj się', or: 'lub', sso: 'Zaloguj przez Google lub kod e-mail', forgot: 'Nie pamiętasz hasła? Poproś właścicielkę o nowy link.',
    newHere: 'Jesteś tu pierwszy raz?', ask: 'Poproś o dostęp', choose: 'Ustaw hasło', chooseHelp: 'Co najmniej 6 liter, cyfr lub znaków. Telefon lub przeglądarka może je zapamiętać.',
    resetHelp: 'Ustaw nowe hasło. Inne urządzenia zostaną wylogowane.', newPass: 'Nowe hasło', again: 'Wpisz je jeszcze raz', show: 'Pokaż',
    save: 'Zapisz i otwórz Book Editor', wrong: 'E-mail lub hasło jest niepoprawne.', locked: 'Za dużo błędnych prób. Odczekaj 15 minut i spróbuj ponownie.',
    short: 'Użyj co najmniej 6 znaków.', differ: 'Hasła się różnią.', badLink: 'Ten link został już użyty albo wygasł. Poproś właścicielkę o nowy.',
    notListed: 'Tego konta nie ma jeszcze na liście. Poproś o dostęp albo zaloguj się hasłem.', ssoFail: 'To logowanie się nie udało. Spróbuj ponownie lub użyj hasła.',
    out: 'Wylogowano na tym urządzeniu.', fail: 'Nie udało się. Spróbuj ponownie.', off: 'Ta kopia Book Editor nie ma logowania.', loading: 'Wczytywanie…' },
  fr: { name: 'Français', title: 'Connexion', welcome: 'Bienvenue dans Book Editor', hello: 'Bonjour {name}', email: 'E-mail', pass: 'Code secret',
    signin: 'Se connecter', or: 'ou', sso: 'Se connecter avec Google ou un code par e-mail', forgot: 'Code oublié ? Demandez un nouveau lien à la propriétaire.',
    newHere: 'Première visite ?', ask: 'Demander l’accès', choose: 'Choisir un code secret', chooseHelp: 'Au moins 6 lettres, chiffres ou caractères. Votre téléphone ou navigateur peut s’en souvenir.',
    resetHelp: 'Choisissez un nouveau code. Vos autres appareils seront déconnectés.', newPass: 'Nouveau code', again: 'Retapez-le', show: 'Afficher',
    save: 'Enregistrer et ouvrir Book Editor', wrong: 'L’e-mail ou le code n’est pas bon.', locked: 'Trop d’essais. Attendez 15 minutes puis réessayez.',
    short: 'Au moins 6 caractères.', differ: 'Les deux codes ne sont pas identiques.', badLink: 'Ce lien a déjà servi ou a expiré. Demandez-en un nouveau.',
    notListed: 'Ce compte n’est pas encore sur la liste. Demandez l’accès, ou utilisez votre code.', ssoFail: 'Cette connexion n’a pas marché. Réessayez, ou utilisez votre code.',
    out: 'Vous êtes déconnecté sur cet appareil.', fail: 'Cela n’a pas marché. Réessayez.', off: 'La connexion n’est pas configurée sur cette copie de Book Editor.', loading: 'Chargement…' },
  de: { name: 'Deutsch', title: 'Anmelden', welcome: 'Willkommen bei Book Editor', hello: 'Hallo {name}', email: 'E-Mail', pass: 'Passwort',
    signin: 'Anmelden', or: 'oder', sso: 'Mit Google oder E-Mail-Code anmelden', forgot: 'Passwort vergessen? Bitte die Inhaberin um einen neuen Link.',
    newHere: 'Neu hier?', ask: 'Zugang anfragen', choose: 'Passwort wählen', chooseHelp: 'Mindestens 6 Buchstaben, Zahlen oder Zeichen. Dein Handy oder Browser kann es sich merken.',
    resetHelp: 'Wähle ein neues Passwort. Deine anderen Geräte werden abgemeldet.', newPass: 'Neues Passwort', again: 'Noch einmal eingeben', show: 'Zeigen',
    save: 'Speichern und Book Editor öffnen', wrong: 'E-Mail oder Passwort stimmt nicht.', locked: 'Zu viele falsche Versuche. Bitte 15 Minuten warten.',
    short: 'Mindestens 6 Zeichen.', differ: 'Die beiden Passwörter sind nicht gleich.', badLink: 'Dieser Link wurde schon benutzt oder ist abgelaufen. Bitte um einen neuen.',
    notListed: 'Dieses Konto ist noch nicht auf der Liste. Frag nach Zugang oder melde dich mit Passwort an.', ssoFail: 'Diese Anmeldung hat nicht geklappt. Noch einmal versuchen oder Passwort nutzen.',
    out: 'Du bist auf diesem Gerät abgemeldet.', fail: 'Das hat nicht geklappt. Bitte noch einmal.', off: 'Bei dieser Kopie von Book Editor ist keine Anmeldung eingerichtet.', loading: 'Lädt…' },
  es: { name: 'Español', title: 'Entrar', welcome: 'Bienvenido a Book Editor', hello: 'Hola, {name}', email: 'Correo', pass: 'Contraseña',
    signin: 'Entrar', or: 'o', sso: 'Entrar con Google o un código por correo', forgot: '¿Olvidaste la contraseña? Pide a la propietaria un enlace nuevo.',
    newHere: '¿Eres nuevo?', ask: 'Pedir acceso', choose: 'Elige una contraseña', chooseHelp: 'Al menos 6 letras, números o signos. Tu teléfono o navegador puede recordarla.',
    resetHelp: 'Elige una contraseña nueva. Se cerrará la sesión en tus otros dispositivos.', newPass: 'Contraseña nueva', again: 'Escríbela otra vez', show: 'Mostrar',
    save: 'Guardar y abrir Book Editor', wrong: 'El correo o la contraseña no es correcto.', locked: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.',
    short: 'Usa al menos 6 caracteres.', differ: 'Las dos contraseñas no coinciden.', badLink: 'Este enlace ya se usó o caducó. Pide uno nuevo.',
    notListed: 'Esta cuenta aún no está en la lista. Pide acceso o entra con tu contraseña.', ssoFail: 'Ese acceso no funcionó. Inténtalo de nuevo o usa tu contraseña.',
    out: 'Has cerrado sesión en este dispositivo.', fail: 'No funcionó. Inténtalo de nuevo.', off: 'Esta copia de Book Editor no tiene inicio de sesión.', loading: 'Cargando…' },
  ja: { name: '日本語', title: 'ログイン', welcome: 'Book Editor へようこそ', hello: '{name} さん、こんにちは', email: 'メール', pass: 'パスコード',
    signin: 'ログイン', or: 'または', sso: 'Google またはメールのコードでログイン', forgot: 'パスコードを忘れたら、オーナーに新しいリンクを頼んでください。',
    newHere: 'はじめてですか？', ask: '利用を申し込む', choose: 'パスコードを決める', chooseHelp: '6 文字以上（文字・数字・記号）。スマホやブラウザが覚えてくれます。',
    resetHelp: '新しいパスコードを決めてください。ほかの端末はログアウトされます。', newPass: '新しいパスコード', again: 'もう一度入力', show: '表示',
    save: '保存して Book Editor を開く', wrong: 'メールかパスコードが違います。', locked: '間違いが多すぎます。15 分待ってからもう一度試してください。',
    short: '6 文字以上にしてください。', differ: '2 つのパスコードが一致しません。', badLink: 'このリンクは使用済みか期限切れです。新しいリンクを頼んでください。',
    notListed: 'このアカウントはまだリストにありません。利用を申し込むか、パスコードでログインしてください。', ssoFail: 'ログインできませんでした。もう一度試すか、パスコードを使ってください。',
    out: 'この端末からログアウトしました。', fail: 'うまくいきませんでした。もう一度試してください。', off: 'この Book Editor ではログインが設定されていません。', loading: '読み込み中…' },
  ko: { name: '한국어', title: '로그인', welcome: 'Book Editor에 오신 것을 환영해요', hello: '{name}님, 안녕하세요', email: '이메일', pass: '비밀번호',
    signin: '로그인', or: '또는', sso: 'Google 또는 이메일 코드로 로그인', forgot: '비밀번호를 잊었나요? 소유자에게 새 링크를 부탁하세요.',
    newHere: '처음인가요?', ask: '사용 신청', choose: '비밀번호 정하기', chooseHelp: '6자 이상(글자, 숫자, 기호). 휴대폰이나 브라우저가 기억해 줄 수 있어요.',
    resetHelp: '새 비밀번호를 정하세요. 다른 기기에서는 로그아웃돼요.', newPass: '새 비밀번호', again: '한 번 더 입력', show: '보기',
    save: '저장하고 Book Editor 열기', wrong: '이메일이나 비밀번호가 맞지 않아요.', locked: '틀린 횟수가 너무 많아요. 15분 뒤에 다시 해 보세요.',
    short: '6자 이상 입력하세요.', differ: '두 비밀번호가 달라요.', badLink: '이미 사용했거나 만료된 링크예요. 새 링크를 부탁하세요.',
    notListed: '이 계정은 아직 목록에 없어요. 사용 신청을 하거나 비밀번호로 로그인하세요.', ssoFail: '로그인하지 못했어요. 다시 해 보거나 비밀번호를 쓰세요.',
    out: '이 기기에서 로그아웃했어요.', fail: '잘 안 됐어요. 다시 해 보세요.', off: '이 Book Editor에는 로그인이 설정되어 있지 않아요.', loading: '불러오는 중…' },
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
let ui = store.get('be.ui');
if (!W[ui]) ui = [...(navigator.languages || ['en'])].map(l => String(l).slice(0, 2).toLowerCase()).find(l => W[l]) || 'en';
const T = (k, v = {}) => String(W[ui][k] ?? W.en[k]).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = new URLSearchParams(location.search);
const safeNext = x => /^\/(?![\/\\])[^\s]*$/.test(String(x ?? '')) ? x : '/';
const inviteToken = (location.hash.match(/^#i=([A-Za-z0-9_-]{20,64})$/) || [])[1] || null;
const after = () => safeNext(q.get('next')) + (inviteToken ? '' : location.hash);
const S = { mode: inviteToken ? 'loading' : 'login', inv: null, err: '', note: q.get('e') === 'not-listed' ? 'notListed' : q.get('e') === 'sso' ? 'ssoFail' : q.get('out') ? 'out' : '',
  busy: false, show: false, email: store.get('be.email') || '' };

async function post(body) {
  const r = await fetch('/signin/api', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const isJson = (r.headers.get('content-type') || '').includes('application/json'); const d = isJson ? await r.json().catch(() => ({})) : {};
  if (!r.ok || !isJson) { const e = new Error(d.error || 'http'); e.code = d.error || (isJson ? 'server' : 'off'); throw e; }
  return d;
}
const errKey = c => ({ wrong: 'wrong', locked: 'locked', 'passcode-short': 'short', 'invite-bad': 'badLink', 'bad-email': 'wrong', 'not-configured': 'off', off: 'off' }[c] || 'fail');
const val = id => document.getElementById(id)?.value ?? '';

async function loadInvite() {
  try { S.inv = await post({ action: 'invite', invite: inviteToken }); S.mode = 'invite'; }
  catch (e) { S.mode = 'login'; S.err = errKey(e.code); }
  render();
}
async function signIn() {
  S.email = val('em').trim(); const pass = val('pw');
  if (!S.email || !pass) { S.err = 'wrong'; render(); return document.getElementById(S.email ? 'pw' : 'em')?.focus(); }
  S.busy = true; S.err = ''; S.note = ''; render();
  try { await post({ action: 'login', email: S.email, passcode: pass }); store.set('be.email', S.email.toLowerCase()); location.replace(after()); return; }
  catch (e) { S.err = errKey(e.code); }
  S.busy = false; render();
  const pw = document.getElementById('pw'); if (pw && S.err === 'wrong') { pw.value = ''; pw.focus(); }
}
async function choose() {
  const a = val('np'), b = val('np2');
  if ([...a].length < 6) { S.err = 'short'; render(); return document.getElementById('np')?.focus(); }
  if (a !== b) { S.err = 'differ'; render(); return document.getElementById('np2')?.focus(); }
  S.busy = true; S.err = ''; render();
  try {
    await post({ action: 'redeem', invite: inviteToken, passcode: a });
    store.set('be.email', S.inv.email);
    history.replaceState(null, '', location.pathname);           // the used link leaves the address bar and history
    location.replace('/'); return;
  } catch (e) { S.err = errKey(e.code); if (e.code === 'invite-bad') S.mode = 'login'; }
  S.busy = false; render();
}

function render() {
  const typed = ['pw', 'np', 'np2'].map(id => [id, val(id)]);         // a redraw (error, language, Show) keeps what was typed
  document.documentElement.lang = ui; document.title = T('title') + ' · Book Editor';
  const langs = `<div class="langs" role="group">${Object.keys(W).map(k => `<button lang="${k}" data-ui="${k}" aria-pressed="${k === ui}">${esc(W[k].name)}</button>`).join('')}</div>`;
  const msg = S.err ? `<div class="msg bad" role="alert">${esc(T(S.err))}</div>` : S.note ? `<div class="msg ${S.note === 'out' ? 'good' : ''}" role="status">${esc(T(S.note))}</div>` : '';
  const showBtn = `<button type="button" class="btn plain small" data-show aria-pressed="${S.show}">${esc(T('show'))}</button>`;
  const type = S.show ? 'text' : 'password';
  let body;
  if (S.mode === 'loading') body = `<h1>${esc(T('welcome'))}</h1><p class="muted">${esc(T('loading'))}</p>`;
  else if (S.mode === 'invite') body = `<h1>${esc(S.inv.name ? T('hello', { name: S.inv.name }) : T('welcome'))}</h1>
    <form id="f-choose" class="stack" novalidate>
      <p class="muted">${esc(T(S.inv.reset ? 'resetHelp' : 'chooseHelp'))}</p>
      <div><label for="em">${esc(T('email'))}</label><input id="em" name="username" autocomplete="username" value="${esc(S.inv.email)}" readonly></div>
      <div><div class="lrow"><label for="np">${esc(T('newPass'))}</label>${showBtn}</div><input id="np" name="new-password" type="${type}" autocomplete="new-password" minlength="6" maxlength="128" required autofocus></div>
      <div><label for="np2">${esc(T('again'))}</label><input id="np2" type="${type}" autocomplete="new-password" minlength="6" maxlength="128" required></div>
      ${msg}
      <button class="btn" type="submit" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(T('save'))}</button>
    </form>`;
  else body = `<h1>${esc(T('title'))}</h1>
    <form id="f-login" class="stack" novalidate>
      ${msg}
      <div><label for="em">${esc(T('email'))}</label><input id="em" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="254" value="${esc(S.email)}" required></div>
      <div><div class="lrow"><label for="pw">${esc(T('pass'))}</label>${showBtn}</div><input id="pw" name="password" type="${type}" autocomplete="current-password" maxlength="128" required></div>
      <button class="btn" type="submit" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(T('signin'))}</button>
    </form>
    <p class="muted tiny">${esc(T('forgot'))}</p>
    <div class="or"><span>${esc(T('or'))}</span></div>
    <a class="btn plain" href="/sso?next=${encodeURIComponent(safeNext(q.get('next')))}">${esc(T('sso'))}</a>
    <p class="muted">${esc(T('newHere'))} <a href="/join/">${esc(T('ask'))}</a></p>`;
  document.getElementById('signin').innerHTML = `<div class="brand">📖 Book Editor</div><section class="card">${body}</section>${langs}`;
  for (const [id, v] of typed) { const el = document.getElementById(id); if (el && v) el.value = v; }
  if (S.mode === 'login' && !S.busy) document.getElementById(S.email ? 'pw' : 'em')?.focus({ preventScroll: true });
}
document.addEventListener('submit', e => { e.preventDefault(); if (S.busy) return; if (e.target.id === 'f-login') signIn(); else if (e.target.id === 'f-choose') choose(); });
document.addEventListener('click', e => {
  const l = e.target.closest('[data-ui]');
  if (l) { if (document.getElementById('em') && S.mode === 'login') S.email = val('em'); ui = l.dataset.ui; store.set('be.ui', ui); return render(); }
  if (e.target.closest('[data-show]')) { if (S.mode === 'login') S.email = val('em'); S.show = !S.show; render(); }
});
render();
if (inviteToken) loadInvite();
