// Ask to join. The person has already proved their email with Cloudflare's email code (this page sits behind its own
// Access app that lets any email in). They add their name so the admin can tell who it is, and wait for approval.
const W = {
  en: { name: 'English', title: 'Ask to join Book Editor', intro: 'Book Editor is private. Tell the owner who you are; they will approve or decline.',
    email: 'Your email (checked by the sign-in code)', yname: 'Your full name', note: 'A short note (optional)', notePh: 'e.g. how you know the owner',
    send: 'Send my request', update: 'Update my request', waiting: 'Your request is waiting for the owner. You can close this page; you will be able to open Book Editor once it is approved.',
    member: 'You already have access.', open: 'Open Book Editor', needName: 'Please type your name.', fail: 'That did not work. Please try again.',
    full: 'Too many requests are waiting. Please try again later.', off: 'Asking to join is not open on this copy of Book Editor.', loading: 'Loading…', other: 'Use a different email' },
  zh: { name: '中文', title: '申请使用 Book Editor', intro: 'Book Editor 是私人的。告诉所有者你是谁，对方会同意或拒绝。',
    email: '你的邮箱（已通过登录验证码确认）', yname: '你的全名', note: '简短留言（可不填）', notePh: '例如：你和所有者的关系',
    send: '发送申请', update: '更新申请', waiting: '你的申请正在等待所有者处理。可以关闭此页面；同意后你就能打开 Book Editor。',
    member: '你已经可以使用了。', open: '打开 Book Editor', needName: '请输入你的名字。', fail: '没有成功，请再试一次。',
    full: '等待中的申请太多了，请稍后再试。', off: '这个 Book Editor 副本不开放申请。', loading: '正在载入…', other: '换一个邮箱' },
  pl: { name: 'Polski', title: 'Poproś o dostęp do Book Editor', intro: 'Book Editor jest prywatny. Napisz właścicielce, kim jesteś; zatwierdzi lub odrzuci prośbę.',
    email: 'Twój e-mail (sprawdzony kodem logowania)', yname: 'Imię i nazwisko', note: 'Krótka wiadomość (opcjonalnie)', notePh: 'np. skąd znasz właścicielkę',
    send: 'Wyślij prośbę', update: 'Zaktualizuj prośbę', waiting: 'Twoja prośba czeka na właścicielkę. Możesz zamknąć tę stronę; po zatwierdzeniu otworzysz Book Editor.',
    member: 'Masz już dostęp.', open: 'Otwórz Book Editor', needName: 'Wpisz swoje imię.', fail: 'Nie udało się. Spróbuj ponownie.',
    full: 'Czeka zbyt wiele próśb. Spróbuj później.', off: 'Ta kopia Book Editor nie przyjmuje próśb.', loading: 'Wczytywanie…', other: 'Użyj innego adresu' },
  fr: { name: 'Français', title: 'Demander l’accès à Book Editor', intro: 'Book Editor est privé. Dites à la propriétaire qui vous êtes ; elle acceptera ou refusera.',
    email: 'Votre e-mail (vérifié par le code de connexion)', yname: 'Votre nom complet', note: 'Un petit mot (facultatif)', notePh: 'p. ex. comment vous connaissez la propriétaire',
    send: 'Envoyer ma demande', update: 'Mettre à jour ma demande', waiting: 'Votre demande attend la propriétaire. Vous pouvez fermer cette page ; vous pourrez ouvrir Book Editor une fois acceptée.',
    member: 'Vous avez déjà accès.', open: 'Ouvrir Book Editor', needName: 'Saisissez votre nom.', fail: 'Cela n’a pas marché. Réessayez.',
    full: 'Trop de demandes en attente. Réessayez plus tard.', off: 'Les demandes ne sont pas ouvertes sur cette copie de Book Editor.', loading: 'Chargement…', other: 'Utiliser un autre e-mail' },
  de: { name: 'Deutsch', title: 'Zugang zu Book Editor anfragen', intro: 'Book Editor ist privat. Sag der Inhaberin, wer du bist; sie nimmt an oder lehnt ab.',
    email: 'Deine E-Mail (per Anmeldecode geprüft)', yname: 'Dein vollständiger Name', note: 'Kurze Nachricht (optional)', notePh: 'z. B. woher du die Inhaberin kennst',
    send: 'Anfrage senden', update: 'Anfrage aktualisieren', waiting: 'Deine Anfrage wartet auf die Inhaberin. Du kannst die Seite schließen; nach der Freigabe kannst du Book Editor öffnen.',
    member: 'Du hast schon Zugang.', open: 'Book Editor öffnen', needName: 'Bitte gib deinen Namen ein.', fail: 'Das hat nicht geklappt. Bitte noch einmal.',
    full: 'Es warten zu viele Anfragen. Bitte später erneut.', off: 'Anfragen sind bei dieser Kopie von Book Editor nicht offen.', loading: 'Lädt…', other: 'Andere E-Mail verwenden' },
  es: { name: 'Español', title: 'Pedir acceso a Book Editor', intro: 'Book Editor es privado. Dile a la propietaria quién eres; ella aceptará o rechazará.',
    email: 'Tu correo (comprobado con el código de acceso)', yname: 'Tu nombre completo', note: 'Una nota breve (opcional)', notePh: 'p. ej. de qué conoces a la propietaria',
    send: 'Enviar solicitud', update: 'Actualizar solicitud', waiting: 'Tu solicitud espera a la propietaria. Puedes cerrar esta página; cuando la acepte podrás abrir Book Editor.',
    member: 'Ya tienes acceso.', open: 'Abrir Book Editor', needName: 'Escribe tu nombre.', fail: 'No funcionó. Inténtalo de nuevo.',
    full: 'Hay demasiadas solicitudes esperando. Inténtalo más tarde.', off: 'Esta copia de Book Editor no acepta solicitudes.', loading: 'Cargando…', other: 'Usar otro correo' },
  ja: { name: '日本語', title: 'Book Editor の利用を申し込む', intro: 'Book Editor は非公開です。あなたが誰かをオーナーに伝えてください。オーナーが承認または拒否します。',
    email: 'メールアドレス（ログインのコードで確認済み）', yname: 'フルネーム', note: 'ひとこと（任意）', notePh: '例：オーナーとの関係',
    send: '申し込む', update: '申し込みを更新', waiting: '申し込みはオーナーの確認待ちです。このページは閉じてかまいません。承認されると Book Editor を開けます。',
    member: 'すでに利用できます。', open: 'Book Editor を開く', needName: '名前を入力してください。', fail: 'うまくいきませんでした。もう一度試してください。',
    full: '待っている申し込みが多すぎます。あとで試してください。', off: 'この Book Editor では申し込みを受け付けていません。', loading: '読み込み中…', other: '別のメールを使う' },
  ko: { name: '한국어', title: 'Book Editor 사용 신청', intro: 'Book Editor는 비공개예요. 누구인지 소유자에게 알려 주세요. 소유자가 승인하거나 거절해요.',
    email: '이메일 (로그인 코드로 확인됨)', yname: '이름 (전체)', note: '짧은 메모 (선택)', notePh: '예: 소유자와의 관계',
    send: '신청 보내기', update: '신청 수정', waiting: '신청이 소유자를 기다리고 있어요. 이 페이지를 닫아도 돼요. 승인되면 Book Editor를 열 수 있어요.',
    member: '이미 사용할 수 있어요.', open: 'Book Editor 열기', needName: '이름을 입력하세요.', fail: '잘 안 됐어요. 다시 해 보세요.',
    full: '기다리는 신청이 너무 많아요. 나중에 다시 해 보세요.', off: '이 Book Editor에서는 신청을 받지 않아요.', loading: '불러오는 중…', other: '다른 이메일 사용' },
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
let ui = store.get('be.ui');
if (!W[ui]) ui = [...(navigator.languages || ['en'])].map(l => String(l).slice(0, 2).toLowerCase()).find(l => W[l]) || 'en';
const T = k => W[ui][k] ?? W.en[k];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { st: null, err: '', busy: false, name: '', note: '' };

async function api(method, body) {
  const r = await fetch('api', { method, cache: 'no-store', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const ok = (r.headers.get('content-type') || '').includes('application/json'); const d = ok ? await r.json().catch(() => ({})) : {};
  if (!r.ok || !ok) { const e = new Error(d.error || 'http'); e.code = d.error || (ok ? 'server' : 'off'); throw e; }
  return d;
}
async function load() {
  try { S.st = await api('GET'); S.name = S.st.name || ''; S.note = S.st.note || ''; }
  catch (e) { S.st = { status: 'error' }; S.err = e.code === 'not-configured' || e.code === 'off' ? 'off' : 'fail'; }
  render();
}
async function send() {
  S.name = document.getElementById('nm').value; S.note = document.getElementById('nt').value;
  if (S.name.trim().length < 2) { S.err = 'needName'; render(); return document.getElementById('nm').focus(); }
  S.busy = true; S.err = ''; render();
  try { const d = await api('POST', { name: S.name, note: S.note }); S.st.status = d.status; S.st.name = S.name.trim(); }
  catch (e) { S.err = e.code === 'too-many' ? 'full' : e.code === 'name-needed' ? 'needName' : 'fail'; }
  S.busy = false; render();
}
function render() {
  const st = S.st, langs = `<div class="langs" role="group">${Object.keys(W).map(k => `<button lang="${k}" data-ui="${k}" aria-pressed="${k === ui}">${esc(W[k].name)}</button>`).join('')}</div>`;
  document.documentElement.lang = ui; document.title = T('title') + ' · Book Editor';
  let body;
  if (!st) body = `<p class="muted">${esc(T('loading'))}</p>`;
  else if (st.status === 'error') body = `<div class="msg bad">${esc(T(S.err))}</div>`;
  else if (st.status === 'member') body = `<div class="msg good">${esc(T('member'))}</div><a class="btn" href="/">${esc(T('open'))}</a>`;
  else body = `<p class="muted">${esc(T('intro'))}</p>
    ${st.status === 'waiting' ? `<div class="msg good" role="status">${esc(T('waiting'))}</div>` : ''}
    <div><label for="em">${esc(T('email'))}</label><input id="em" value="${esc(st.email)}" readonly></div>
    <div><label for="nm">${esc(T('yname'))} <span class="req" aria-hidden="true">*</span></label><input id="nm" required maxlength="80" autocomplete="name" value="${esc(S.name)}"></div>
    <div><label for="nt">${esc(T('note'))}</label><textarea id="nt" maxlength="300" placeholder="${esc(T('notePh'))}">${esc(S.note)}</textarea></div>
    ${S.err ? `<div class="msg bad" role="alert">${esc(T(S.err))}</div>` : ''}
    <button class="btn" id="send" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(T(st.status === 'waiting' ? 'update' : 'send'))}</button>
    <a class="btn plain" href="/cdn-cgi/access/logout">${esc(T('other'))}</a>`;
  document.getElementById('join').innerHTML = `<div class="brand">📖 Book Editor</div><section class="card"><h1>${esc(T('title'))}</h1>${body}</section>${langs}`;
}
document.addEventListener('click', e => {
  const l = e.target.closest('[data-ui]');
  if (l) { if (document.getElementById('nm')) { S.name = document.getElementById('nm').value; S.note = document.getElementById('nt').value; } ui = l.dataset.ui; store.set('be.ui', ui); return render(); }
  if (e.target.closest('#send')) send();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'nm') { e.preventDefault(); send(); } });
render(); load();
