const INTRO_KEY = 'cantobridge:intro:v1';
const LOGO = '/assets/branding/logo.png';
let playedInSession = false;

/** Device-local first visit, independent of sign-in and account resets. */
export function startIntro({ doc = globalThis.document, win = globalThis.window, storage, t = key => key, preview = false } = {}) {
  if (!doc?.body || !win) return null;
  try { storage ??= win.localStorage; } catch { /* Private browsers may block storage. */ }
  let seen = playedInSession;
  try { seen ||= storage?.getItem(INTRO_KEY) === 'seen'; } catch { /* Session fallback. */ }
  if (seen && !preview) return null;
  if (!preview) {
    playedInSession = true;
    try { storage?.setItem(INTRO_KEY, 'seen'); } catch { /* Animation must never block entry. */ }
  }
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;

  const root = doc.getElementById('app');
  const wasInert = Boolean(root?.inert);
  const previousOverflow = doc.body.style.overflow ?? '';
  if (root) root.inert = true;
  doc.body.style.overflow = 'hidden';
  const overlay = doc.createElement('div');
  overlay.setAttribute('class', 'brand-intro');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('intro.title'));
  const stage = doc.createElement('div'); stage.setAttribute('class', 'intro-stage');
  const mark = doc.createElement('div'); mark.setAttribute('class', 'intro-mark');
  const image = doc.createElement('img');
  image.setAttribute('src', LOGO); image.setAttribute('alt', 'CantoBridge');
  image.setAttribute('width', '340'); image.setAttribute('height', '340');
  const shine = doc.createElement('span'); shine.setAttribute('class', 'intro-glint'); shine.setAttribute('aria-hidden', 'true');
  mark.appendChild(image); mark.appendChild(shine);
  const caption = doc.createElement('p'); caption.setAttribute('class', 'intro-caption'); caption.textContent = t('intro.greeting');
  stage.appendChild(mark); stage.appendChild(caption);
  const skip = doc.createElement('button'); skip.setAttribute('class', 'intro-skip'); skip.setAttribute('type', 'button'); skip.textContent = t('intro.skip');
  overlay.appendChild(stage); overlay.appendChild(skip); doc.body.appendChild(overlay);
  let closed = false;
  const timers = [];
  const remove = () => {
    if (closed) return;
    closed = true;
    for (const timer of timers) win.clearTimeout(timer);
    overlay.parentNode?.removeChild(overlay);
    if (root) root.inert = wasInert;
    doc.body.style.overflow = previousOverflow;
  };
  skip.addEventListener('click', remove);
  image.addEventListener('error', remove);
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') remove(); });
  timers.push(win.setTimeout(() => overlay.classList.add('is-leaving'), 2200));
  timers.push(win.setTimeout(remove, 2650));
  return { close: remove };
}
