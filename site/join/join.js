// Ask to join. Open to everyone, no sign-in: the person gives their name, email and a short note. The owner checks who
// it is, approves, and sends them their own one-time sign-in link (to choose a passcode) through a channel she trusts.
const W = {
  en: { name: 'English', title: 'Ask to join Book Editor', intro: 'Book Editor is private. Tell the owner who you are. If she approves, she will send you your own sign-in link.',
    email: 'Your email', yname: 'Your full name', note: 'A short note (optional)', notePh: 'e.g. how you know the owner',
    send: 'Send my request', sent: 'Thank you. Your request has been sent. When it is approved, the owner will send you a link to choose your passcode.',
    needName: 'Please type your name.', needEmail: 'Please type your email address.', fail: 'That did not work. Please try again.',
    full: 'Too many requests are waiting. Please try again later.', off: 'Asking to join is not open on this copy of Book Editor.', have: 'Already have a passcode?', signin: 'Sign in' },
  zh: { name: '中文', title: '申请使用 Book Editor', intro: 'Book Editor 是私人的。告诉所有者你是谁。同意后，对方会发给你专属的登录链接。',
    email: '你的邮箱', yname: '你的全名', note: '简短留言（可不填）', notePh: '例如：你和所有者的关系',
    send: '发送申请', sent: '谢谢，申请已发送。同意后，所有者会发给你一个链接，用来设置你的密码。',
    needName: '请输入你的名字。', needEmail: '请输入你的邮箱。', fail: '没有成功，请再试一次。',
    full: '等待中的申请太多了，请稍后再试。', off: '这个 Book Editor 副本不开放申请。', have: '已经有密码了？', signin: '登录' },
  pl: { name: 'Polski', title: 'Poproś o dostęp do Book Editor', intro: 'Book Editor jest prywatny. Napisz właścicielce, kim jesteś. Jeśli się zgodzi, wyśle ci twój własny link do logowania.',
    email: 'Twój e-mail', yname: 'Imię i nazwisko', note: 'Krótka wiadomość (opcjonalnie)', notePh: 'np. skąd znasz właścicielkę',
    send: 'Wyślij prośbę', sent: 'Dziękujemy, prośba wysłana. Po zatwierdzeniu właścicielka wyśle ci link do ustawienia hasła.',
    needName: 'Wpisz swoje imię.', needEmail: 'Wpisz swój adres e-mail.', fail: 'Nie udało się. Spróbuj ponownie.',
    full: 'Czeka zbyt wiele próśb. Spróbuj później.', off: 'Ta kopia Book Editor nie przyjmuje próśb.', have: 'Masz już hasło?', signin: 'Zaloguj się' },
  fr: { name: 'Français', title: 'Demander l’accès à Book Editor', intro: 'Book Editor est privé. Dites à la propriétaire qui vous êtes. Si elle accepte, elle vous enverra votre propre lien de connexion.',
    email: 'Votre e-mail', yname: 'Votre nom complet', note: 'Un petit mot (facultatif)', notePh: 'p. ex. comment vous connaissez la propriétaire',
    send: 'Envoyer ma demande', sent: 'Merci, votre demande est envoyée. Une fois acceptée, la propriétaire vous enverra un lien pour choisir votre code secret.',
    needName: 'Saisissez votre nom.', needEmail: 'Saisissez votre e-mail.', fail: 'Cela n’a pas marché. Réessayez.',
    full: 'Trop de demandes en attente. Réessayez plus tard.', off: 'Les demandes ne sont pas ouvertes sur cette copie de Book Editor.', have: 'Vous avez déjà un code ?', signin: 'Se connecter' },
  de: { name: 'Deutsch', title: 'Zugang zu Book Editor anfragen', intro: 'Book Editor ist privat. Sag der Inhaberin, wer du bist. Wenn sie zustimmt, schickt sie dir deinen eigenen Anmeldelink.',
    email: 'Deine E-Mail', yname: 'Dein vollständiger Name', note: 'Kurze Nachricht (optional)', notePh: 'z. B. woher du die Inhaberin kennst',
    send: 'Anfrage senden', sent: 'Danke, deine Anfrage ist verschickt. Nach der Freigabe schickt dir die Inhaberin einen Link, um dein Passwort zu wählen.',
    needName: 'Bitte gib deinen Namen ein.', needEmail: 'Bitte gib deine E-Mail ein.', fail: 'Das hat nicht geklappt. Bitte noch einmal.',
    full: 'Es warten zu viele Anfragen. Bitte später erneut.', off: 'Anfragen sind bei dieser Kopie von Book Editor nicht offen.', have: 'Schon ein Passwort?', signin: 'Anmelden' },
  es: { name: 'Español', title: 'Pedir acceso a Book Editor', intro: 'Book Editor es privado. Dile a la propietaria quién eres. Si acepta, te enviará tu propio enlace para entrar.',
    email: 'Tu correo', yname: 'Tu nombre completo', note: 'Una nota breve (opcional)', notePh: 'p. ej. de qué conoces a la propietaria',
    send: 'Enviar solicitud', sent: 'Gracias, tu solicitud se ha enviado. Cuando la acepte, la propietaria te enviará un enlace para elegir tu contraseña.',
    needName: 'Escribe tu nombre.', needEmail: 'Escribe tu correo.', fail: 'No funcionó. Inténtalo de nuevo.',
    full: 'Hay demasiadas solicitudes esperando. Inténtalo más tarde.', off: 'Esta copia de Book Editor no acepta solicitudes.', have: '¿Ya tienes contraseña?', signin: 'Entrar' },
  ja: { name: '日本語', title: 'Book Editor の利用を申し込む', intro: 'Book Editor は非公開です。あなたが誰かをオーナーに伝えてください。承認されると、あなた専用のログインリンクが届きます。',
    email: 'メールアドレス', yname: 'フルネーム', note: 'ひとこと（任意）', notePh: '例：オーナーとの関係',
    send: '申し込む', sent: 'ありがとうございます。申し込みを送りました。承認されると、パスコードを決めるためのリンクがオーナーから届きます。',
    needName: '名前を入力してください。', needEmail: 'メールアドレスを入力してください。', fail: 'うまくいきませんでした。もう一度試してください。',
    full: '待っている申し込みが多すぎます。あとで試してください。', off: 'この Book Editor では申し込みを受け付けていません。', have: 'パスコードをお持ちですか？', signin: 'ログイン' },
  ko: { name: '한국어', title: 'Book Editor 사용 신청', intro: 'Book Editor는 비공개예요. 누구인지 소유자에게 알려 주세요. 승인되면 나만의 로그인 링크를 보내 줄 거예요.',
    email: '이메일', yname: '이름 (전체)', note: '짧은 메모 (선택)', notePh: '예: 소유자와의 관계',
    send: '신청 보내기', sent: '고마워요. 신청을 보냈어요. 승인되면 소유자가 비밀번호를 정할 수 있는 링크를 보내 줄 거예요.',
    needName: '이름을 입력하세요.', needEmail: '이메일을 입력하세요.', fail: '잘 안 됐어요. 다시 해 보세요.',
    full: '기다리는 신청이 너무 많아요. 나중에 다시 해 보세요.', off: '이 Book Editor에서는 신청을 받지 않아요.', have: '이미 비밀번호가 있나요?', signin: '로그인' },
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
let ui = store.get('be.ui');
if (!W[ui]) ui = [...(navigator.languages || ['en'])].map(l => String(l).slice(0, 2).toLowerCase()).find(l => W[l]) || 'en';
const T = k => W[ui][k] ?? W.en[k];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { sent: false, err: '', busy: false, name: '', email: '', note: '' };
const keep = () => { for (const [k, id] of [['name', 'nm'], ['email', 'em'], ['note', 'nt']]) { const el = document.getElementById(id); if (el) S[k] = el.value; } };

async function send() {
  keep();
  if (S.name.trim().length < 2) { S.err = 'needName'; render(); return document.getElementById('nm').focus(); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.email.trim())) { S.err = 'needEmail'; render(); return document.getElementById('em').focus(); }
  S.busy = true; S.err = ''; render();
  try {
    const r = await fetch('api', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: S.name, email: S.email.trim(), note: S.note, website: document.getElementById('ws')?.value || '' }) });
    const isJson = (r.headers.get('content-type') || '').includes('application/json'); const d = isJson ? await r.json().catch(() => ({})) : {};
    if (!r.ok || !isJson) { const e = new Error(d.error || 'http'); e.code = d.error || (isJson ? 'server' : 'off'); throw e; }
    S.sent = true;
  } catch (e) { S.err = { 'too-many': 'full', 'name-needed': 'needName', 'bad-email': 'needEmail', off: 'off', 'not-configured': 'off' }[e.code] || 'fail'; }
  S.busy = false; render();
}
function render() {
  const langs = `<div class="langs" role="group">${Object.keys(W).map(k => `<button lang="${k}" data-ui="${k}" aria-pressed="${k === ui}">${esc(W[k].name)}</button>`).join('')}</div>`;
  document.documentElement.lang = ui; document.title = T('title') + ' · Book Editor';
  const body = S.sent ? `<div class="msg good" role="status">${esc(T('sent'))}</div>` : `<p class="muted">${esc(T('intro'))}</p>
    <form id="f-join" class="stack" novalidate>
      <div><label for="nm">${esc(T('yname'))} <span class="req" aria-hidden="true">*</span></label><input id="nm" required maxlength="80" autocomplete="name" value="${esc(S.name)}"></div>
      <div><label for="em">${esc(T('email'))} <span class="req" aria-hidden="true">*</span></label><input id="em" type="email" inputmode="email" required maxlength="254" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(S.email)}"></div>
      <div><label for="nt">${esc(T('note'))}</label><textarea id="nt" maxlength="300" placeholder="${esc(T('notePh'))}">${esc(S.note)}</textarea></div>
      <div class="hp" aria-hidden="true"><label for="ws">Website</label><input id="ws" tabindex="-1" autocomplete="off"></div>
      ${S.err ? `<div class="msg bad" role="alert">${esc(T(S.err))}</div>` : ''}
      <button class="btn" type="submit" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(T('send'))}</button>
    </form>`;
  document.getElementById('join').innerHTML = `<div class="brand">📖 Book Editor</div><section class="card"><h1>${esc(T('title'))}</h1>${body}
    <p class="muted">${esc(T('have'))} <a href="/signin/">${esc(T('signin'))}</a></p></section>${langs}`;
}
document.addEventListener('submit', e => { e.preventDefault(); if (!S.busy) send(); });
document.addEventListener('click', e => {
  const l = e.target.closest('[data-ui]');
  if (l) { keep(); ui = l.dataset.ui; store.set('be.ui', ui); render(); }
});
render();
