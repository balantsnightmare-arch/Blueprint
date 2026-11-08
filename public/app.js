// "auto" platforms are updated by the server. "manual" ones can't be edited by
// apps, so we just help you copy your bio/picture and open their settings page.
// Ordered from most to least popular (roughly, by monthly users).
// Logos come from logos.js. LinkedIn isn't in that set, so it uses a text mark.
const MANUAL = 'Copy & paste helper';
const PLATFORMS = {
  facebook: { label: 'Facebook', kind: 'manual', color: '#0866FF', bioLimit: 101, settingsUrl: 'https://www.facebook.com/me', blurb: MANUAL },
  youtube: { label: 'YouTube', kind: 'auto', color: '#FF0000', bioLimit: 1000, blurb: 'Updates your channel description automatically' },
  instagram: { label: 'Instagram', kind: 'manual', color: '#FF0069', bioLimit: 150, settingsUrl: 'https://www.instagram.com/accounts/edit/', blurb: MANUAL },
  tiktok: { label: 'TikTok', kind: 'manual', color: '#000000', bioLimit: 80, settingsUrl: 'https://www.tiktok.com/profile', blurb: MANUAL },
  linkedin: { label: 'LinkedIn', kind: 'manual', color: '#0A66C2', text: 'in', bioLimit: 2600, settingsUrl: 'https://www.linkedin.com/in/me/', blurb: MANUAL },
  snapchat: { label: 'Snapchat', kind: 'manual', color: '#FFFC00', fg: '#000000', settingsUrl: 'https://accounts.snapchat.com/', blurb: MANUAL },
  x: { label: 'X (Twitter)', kind: 'manual', color: '#000000', bioLimit: 160, settingsUrl: 'https://x.com/settings/profile', blurb: MANUAL },
  reddit: { label: 'Reddit', kind: 'manual', color: '#FF4500', bioLimit: 200, settingsUrl: 'https://www.reddit.com/settings/profile', blurb: MANUAL },
  pinterest: { label: 'Pinterest', kind: 'manual', color: '#BD081C', bioLimit: 500, settingsUrl: 'https://www.pinterest.com/settings/', blurb: MANUAL },
  threads: { label: 'Threads', kind: 'manual', color: '#000000', bioLimit: 150, settingsUrl: 'https://www.threads.com/', blurb: MANUAL },
  discord: { label: 'Discord', kind: 'manual', color: '#5865F2', bioLimit: 190, settingsUrl: 'https://discord.com/feature/editProfile', blurb: MANUAL,
    // Newer Discord settings open the profile editor as a popup that no link can reach.
    tip: 'Discord opens your settings. If you don\'t see your profile yet, click "Edit Profiles" under your name at the top left.' },
  twitch: { label: 'Twitch', kind: 'manual', color: '#9146FF', bioLimit: 300, settingsUrl: 'https://www.twitch.tv/settings/profile', blurb: MANUAL },
  steam: { label: 'Steam', kind: 'manual', color: '#000000', settingsUrl: 'https://steamcommunity.com/my/edit/info', blurb: MANUAL },
  github: { label: 'GitHub', kind: 'manual', color: '#181717', bioLimit: 160, settingsUrl: 'https://github.com/settings/profile', blurb: MANUAL },
  bluesky: { label: 'Bluesky', kind: 'auto', color: '#1185FE', bioLimit: 256, blurb: 'A newer X/Twitter alternative. Updates bio and picture automatically' },
  mastodon: { label: 'Mastodon', kind: 'manual', color: '#6364FF', bioLimit: 500, settingsUrl: 'https://mastodon.social/settings/profile', blurb: `${MANUAL} (opens mastodon.social)` },
};

// Video posting: caption limits and where to start a new post on each app.
// Apps missing here (Twitch, Steam, GitHub) don't take video posts.
const VIDEO = {
  facebook: { captionLimit: 63206, uploadUrl: 'https://www.facebook.com/reels/create' },
  youtube: { captionLimit: 5000 },
  instagram: { captionLimit: 2200, uploadUrl: 'https://www.instagram.com/', desktopTip: 'Click Create (+) in the left menu, then Post.' },
  tiktok: { captionLimit: 4000, uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload' },
  linkedin: { captionLimit: 3000, uploadUrl: 'https://www.linkedin.com/feed/?shareActive=true' },
  snapchat: { uploadUrl: 'https://www.snapchat.com/' },
  x: { captionLimit: 280, uploadUrl: 'https://x.com/compose/post' },
  reddit: { uploadUrl: 'https://www.reddit.com/submit' },
  pinterest: { captionLimit: 500, uploadUrl: 'https://www.pinterest.com/pin-creation-tool/' },
  threads: { captionLimit: 500, uploadUrl: 'https://www.threads.com/' },
  discord: { captionLimit: 2000, uploadUrl: 'https://discord.com/channels/@me', tip: 'Open the chat or channel you want, then drop the video in.' },
  bluesky: { captionLimit: 300 },
  mastodon: { captionLimit: 500, uploadUrl: 'https://mastodon.social/publish' },
};
const BLUESKY_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const $ = (sel) => document.querySelector(sel);
const segmenter = new Intl.Segmenter();
const countChars = (text) => [...segmenter.segment(text)].length;

// localStorage can throw (private mode, blocked storage), so never let it break the page.
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

let status = {};
let profiles = {};
// Apps shown as circles. New visitors start with a popular set; a connected
// auto app always shows even if it isn't in this list.
const DEFAULT_APPS = ['youtube', 'instagram', 'tiktok', 'discord'];
let pinned = store.get('ph_apps', null) ?? store.get('ph_manual', null) ?? DEFAULT_APPS;
const savePinned = () => store.set('ph_apps', pinned);
const pin = (id) => { if (!pinned.includes(id)) { pinned = [...pinned, id]; savePinned(); } };
let excluded = new Set(store.get('ph_excluded', [])); // accounts left out of updates
// Small copies of the picture you last set on each manual app, since those apps
// don't let us read your real profile picture. Kept tiny so storage stays small.
let circlePics = store.get('ph_pics', {});
function setCirclePic(id, dataUrl) {
  if (dataUrl) circlePics[id] = dataUrl;
  else delete circlePics[id];
  store.set('ph_pics', circlePics);
}
let activeId = null; // circle whose details are open
let newAvatar = null; // data URL of a picture the user picked
let currentAvatar = null; // picture from a connected account

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// The platform's logo as an inline SVG, drawn in the circle's text color.
function logo(id) {
  const p = PLATFORMS[id];
  if (p.text) return el('span', { className: 'logo-text', textContent: p.text });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'logo');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', p.label);
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', LOGOS[id]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

function brandDot(id, className) {
  const dot = el('span', { className }, [logo(id)]);
  dot.style.background = PLATFORMS[id].color;
  dot.style.color = PLATFORMS[id].fg ?? '#fff';
  return dot;
}

// ---------- accounts ----------

// Circles follow the saved order; anything connected but not in the list goes last.
function accounts() {
  const list = [];
  const order = [...pinned, ...Object.keys(PLATFORMS).filter((id) => !pinned.includes(id))];
  for (const id of order) {
    const p = PLATFORMS[id];
    if (!p) continue;
    const connected = p.kind === 'auto' && Boolean(status[id]?.connected);
    if (!connected && !pinned.includes(id)) continue;
    // An auto app that's pinned but not connected yet shows as a faded circle you can tap to connect.
    const ready = p.kind === 'manual' || connected;
    const profile = profiles[id] ?? {};
    const name = !connected ? p.label : id === 'bluesky' ? `@${status.bluesky.handle}` : status.youtube.channelTitle;
    const avatar = profile.avatar ?? (p.kind === 'manual' ? circlePics[id] : undefined);
    list.push({ id, ...p, name, ready, avatar, included: ready && !excluded.has(id) });
  }
  return list;
}

const included = () => accounts().filter((a) => a.included);

async function refresh() {
  status = await api('/api/status');
  // Keep connected apps in the saved list so they can be reordered like the rest.
  for (const [id, s] of Object.entries(status)) if (s.connected) pin(id);
  const anyConnected = Object.values(status).some((s) => s.connected);
  profiles = anyConnected ? await api('/api/profiles') : {};

  // Prefill the editor from the first connected account that has data.
  const first = Object.values(profiles).find((p) => p && !p.error);
  currentAvatar = Object.values(profiles).find((p) => p?.avatar)?.avatar ?? null;
  if (first && !$('#bio').value) $('#bio').value = first.bio;

  render();
}

function render() {
  renderCircles();
  renderDetail();
  renderAvatar();
  updateBioCount();
  renderPost();
  $('#apply').disabled = !accounts().some((a) => a.ready);
  $('#apply').textContent = 'Update profiles';
}

function renderCircles() {
  const row = $('#account-row');
  row.querySelectorAll('.circle:not(.add)').forEach((c) => c.remove());
  const list = accounts();

  row.classList.toggle('editing', editing);
  for (const a of list) {
    const circle = el('button', {
      className: `circle${a.ready ? (a.included ? '' : ' excluded') : ' pending'}${a.id === activeId ? ' active' : ''}`,
      title: a.ready ? `${a.label}: ${a.name}` : `${a.label}: tap to connect`,
      onclick: () => {
        if (justDragged) return;
        activeId = activeId === a.id ? null : a.id;
        render();
      },
    });
    circle.dataset.id = a.id;
    circle.style.background = a.color;
    circle.style.color = a.fg ?? '#fff';
    if (a.avatar) circle.append(el('img', { src: a.avatar, alt: '' }), brandDot(a.id, 'badge'));
    else circle.append(logo(a.id));
    if (editing) {
      const x = el('span', { className: 'remove-x', role: 'button', ariaLabel: `Remove ${a.label}`, textContent: '×' });
      x.onclick = (e) => {
        e.stopPropagation();
        removeApp(a);
      };
      circle.append(x);
    }
    circle.addEventListener('pointerdown', (e) => startDrag(e, circle));
    row.insertBefore(circle, $('#add-account'));
  }

  $('#edit-apps').hidden = list.length === 0;
  $('#edit-apps').textContent = editing ? 'Done' : 'Edit';
  $('#account-hint').textContent = !list.length
    ? 'Tap + to link your first account.'
    : editing
      ? 'Drag circles to reorder them. Tap × to remove one.'
      : 'Tap a circle to manage it. Drag to reorder.';
}

// ---------- reorder and remove ----------

let editing = false;
let justDragged = false; // stops the click that follows a drag from opening the panel

$('#edit-apps').onclick = () => {
  editing = !editing;
  activeId = null;
  render();
};

function moveApp(id, toIndex) {
  const order = accounts().map((a) => a.id);
  const from = order.indexOf(id);
  if (from === -1 || toIndex === from) return;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, id);
  pinned = order;
  savePinned();
  render();
}

async function removeApp(a) {
  const connected = a.kind === 'auto' && a.ready;
  if (connected && !confirm(`Remove ${a.label}? This also disconnects your ${a.label} account from this app.`)) return;
  if (connected) await api(`/api/${a.id}/disconnect`, { method: 'POST' });
  pinned = pinned.filter((id) => id !== a.id);
  savePinned();
  if (activeId === a.id) activeId = null;
  await refresh();
}

// Drag with mouse or finger. A drag only starts after moving a few pixels,
// so a normal tap still opens the circle's panel.
function startDrag(e, circle) {
  if (e.button !== 0 || e.target.closest('.remove-x')) return;
  const row = $('#account-row');
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let target = null;

  const others = () => [...row.querySelectorAll('.circle:not(.add)')].filter((c) => c !== circle);
  // Capture right away so fast moves that leave the circle still reach us.
  circle.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 8) return;
      dragging = true;
      circle.classList.add('dragging');
    }
    circle.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;

    // Find the circle nearest the pointer and drop before or after it.
    let best = null;
    for (const c of others()) {
      const r = c.getBoundingClientRect();
      const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
      if (!best || d < best.d) best = { c, d, after: ev.clientX > r.left + r.width / 2 };
    }
    others().forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    target = best;
    if (best) best.c.classList.add(best.after ? 'drop-after' : 'drop-before');
  };

  const onUp = () => {
    circle.removeEventListener('pointermove', onMove);
    circle.removeEventListener('pointerup', onUp);
    circle.removeEventListener('pointercancel', onUp);
    if (!dragging) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    circle.classList.remove('dragging');
    circle.style.transform = '';
    if (target) {
      const ids = accounts().map((a) => a.id).filter((id) => id !== circle.dataset.id);
      const index = ids.indexOf(target.c.dataset.id) + (target.after ? 1 : 0);
      moveApp(circle.dataset.id, index);
    } else {
      render();
    }
  };

  circle.addEventListener('pointermove', onMove);
  circle.addEventListener('pointerup', onUp);
  circle.addEventListener('pointercancel', onUp);
}

function renderDetail() {
  const box = $('#account-detail');
  const a = accounts().find((x) => x.id === activeId);
  box.hidden = !a;
  if (!a) return;

  const connected = a.kind === 'auto' && a.ready;

  // Remove takes the circle away entirely (and logs out of auto apps).
  const remove = el('button', { className: 'danger', textContent: 'Remove', onclick: () => removeApp(a) });

  // Move left/right: an easy alternative to dragging, especially on phones.
  const order = accounts().map((x) => x.id);
  const index = order.indexOf(a.id);
  const moveLeft = el('button', { className: 'secondary move', textContent: '←', title: 'Move left', ariaLabel: 'Move left', disabled: index === 0, onclick: () => moveApp(a.id, index - 1) });
  const moveRight = el('button', { className: 'secondary move', textContent: '→', title: 'Move right', ariaLabel: 'Move right', disabled: index === order.length - 1, onclick: () => moveApp(a.id, index + 1) });

  const title = el('div', { className: 'title' }, [
    el('strong', { textContent: a.label }),
    el('span', { className: 'title-side' }, [
      el('span', { className: 'muted', textContent: !a.ready ? 'Not connected' : a.kind === 'manual' ? 'Manual' : a.name }),
      moveLeft,
      moveRight,
    ]),
  ]);

  if (!a.ready) {
    const available = a.id !== 'youtube' || status.youtube?.configured;
    const connect = el('button', { textContent: `Connect ${a.label}`, disabled: !available, onclick: () => connectAuto(a.id) });
    box.replaceChildren(
      title,
      el('p', { className: 'hint', textContent: available ? a.blurb : `${a.label} isn't set up on this server yet, so it can't be connected.` }),
      el('div', { className: 'actions' }, [connect, remove]),
    );
    return;
  }

  const toggle = el('input', { type: 'checkbox', checked: a.included });
  toggle.onchange = () => {
    toggle.checked ? excluded.delete(a.id) : excluded.add(a.id);
    store.set('ph_excluded', [...excluded]);
    render();
  };

  const actions = el('div', { className: 'actions' }, a.kind === 'manual' ? manualActions(a) : []);
  if (a.kind === 'manual') {
    // Let people pick what this circle shows, e.g. a screenshot of their current picture.
    const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        setCirclePic(a.id, await shrinkImage(await resizeImage(file)));
        render();
      } catch (err) {
        showError(err.message);
      }
    };
    actions.append(picker, el('button', { className: 'secondary', textContent: circlePics[a.id] ? 'Change circle picture' : 'Set circle picture', onclick: () => picker.click() }));
    if (circlePics[a.id]) {
      actions.append(el('button', { className: 'secondary', textContent: 'Use logo', onclick: () => { setCirclePic(a.id, null); render(); } }));
    }
  }
  if (connected) {
    // Disconnect logs out but keeps the circle, so it's easy to reconnect.
    const disconnect = el('button', { className: 'secondary', textContent: 'Disconnect' });
    disconnect.onclick = async () => {
      pin(a.id);
      await api(`/api/${a.id}/disconnect`, { method: 'POST' });
      await refresh();
    };
    actions.append(disconnect);
  }
  actions.append(remove);

  const tip = a.tip ? [el('p', { className: 'tip', textContent: a.tip })] : [];
  box.replaceChildren(title, el('p', { className: 'hint', textContent: a.blurb }), ...tip, el('label', { className: 'check' }, [toggle, ' Include when updating']), actions);
}

function connectAuto(id) {
  pin(id);
  if (id === 'youtube') {
    location.href = '/auth/youtube';
  } else {
    openAddDialog();
    addPlatform(id);
  }
}

// ---------- helpers for manual apps ----------

// Phones get the share sheet (with "Save Image" and direct sharing to apps);
// computers get a normal download.
const isTouch = matchMedia('(pointer: coarse)').matches;
const SAVE_LABEL = isTouch ? 'Save picture' : 'Download picture';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older method; still works in some browsers that block the clipboard API.
    const area = el('textarea', { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length); // needed on iPhone
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) showError("Couldn't copy automatically. Select the bio and copy it by hand.");
    return ok;
  }
}

// Built synchronously on purpose: iPhone Safari only opens the share sheet if
// navigator.share() runs straight from the tap, with no await before it.
function dataUrlToFile(dataUrl) {
  const [head, base64] = dataUrl.split(',');
  const type = head.match(/data:([^;]+)/)[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], 'profile-picture.jpg', { type });
}

async function savePicture(dataUrl) {
  if (isTouch && navigator.canShare) {
    const file = dataUrlToFile(dataUrl);
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false; // they closed the share sheet
      }
    }
  }
  const link = el('a', { href: dataUrl, download: 'profile-picture.jpg' });
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}

// Buttons that help with platforms we can't update for you.
function manualActions(a) {
  const copy = el('button', { className: 'secondary', textContent: 'Copy bio' });
  copy.onclick = async () => {
    if (!(await copyText($('#bio').value))) return;
    copy.textContent = 'Copied!';
    setTimeout(() => (copy.textContent = 'Copy bio'), 1500);
  };
  const buttons = [copy];
  if (newAvatar) {
    const picture = newAvatar;
    buttons.push(el('button', { className: 'secondary', textContent: SAVE_LABEL, onclick: () => savePicture(picture) }));
  }
  buttons.push(el('a', { className: 'button secondary', href: a.settingsUrl, target: '_blank', rel: 'noopener', textContent: `Open ${a.label}` }));
  return buttons;
}

// ---------- step-by-step guide ----------
// Walks through each manual app one at a time, then moves on to the next.
// Profile mode: copy bio, save picture, open the app's profile settings.
// Post mode: copy caption, share/download the video, open the app's upload page.

let guide = null; // { mode, steps, index, done: Set, bio, avatar, smallAvatar, caption, video }

function startGuide(steps, { mode = 'profile', bio, avatar, caption, video } = {}) {
  guide = { mode, steps, index: 0, bio, avatar, caption, video, done: new Set(), smallAvatar: null };
  if (avatar) shrinkImage(avatar).then((small) => { if (guide) guide.smallAvatar = small; }).catch(() => {});
  renderGuide();
  $('#guide').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function guideTask(key, number, label, doneLabel, action) {
  const done = guide.done.has(key);
  const btn = el('button', { className: `task${done ? ' done' : ''}` }, [
    el('span', { className: 'task-num', textContent: done ? '✓' : number }),
    el('span', { textContent: done ? doneLabel : label }),
  ]);
  btn.onclick = async () => {
    if ((await action()) === false) return;
    guide.done.add(key);
    renderGuide();
  };
  return btn;
}

function renderGuide() {
  const box = $('#guide');
  box.hidden = !guide;
  if (!guide) return;
  const { steps, index } = guide;

  const close = el('button', { className: 'secondary', textContent: 'Close', onclick: () => { guide = null; renderGuide(); } });

  const posting = guide.mode === 'post';

  if (index >= steps.length) {
    const summary = posting
      ? `You went through ${steps.length} app${steps.length === 1 ? '' : 's'}. Your video should be up everywhere you picked.`
      : `You went through ${steps.length} app${steps.length === 1 ? '' : 's'}. Your profiles should all match now.`;
    box.replaceChildren(
      el('h2', { textContent: 'All done 🎉' }),
      el('p', { className: 'muted', textContent: summary }),
      el('div', { className: 'guide-foot' }, [close]),
    );
    return;
  }

  const a = steps[index];
  const progress = el('div', { className: 'progress' }, [el('span')]);
  progress.firstChild.style.width = `${(index / steps.length) * 100}%`;

  const tasks = [];
  const tips = [];
  let n = 1;
  if (posting) {
    const v = VIDEO[a.id] ?? {};
    if (guide.caption) tasks.push(guideTask(`${a.id}:caption`, n++, 'Copy caption', 'Caption copied', () => copyText(guide.caption)));
    tasks.push(guideTask(`${a.id}:video`, n++, isTouch ? 'Share video' : 'Download video', isTouch ? 'Video shared' : 'Video downloaded', () => shareVideo(guide.video)));
    tasks.push(guideTask(`${a.id}:open`, n++, `Open ${a.label}`, `${a.label} opened`, () => { window.open(v.uploadUrl ?? a.settingsUrl, '_blank', 'noopener'); }));

    if (guide.caption && v.captionLimit && countChars(guide.caption) > v.captionLimit) {
      tips.push(el('p', { className: 'warn', textContent: `Heads up: ${a.label} captions can only be ${v.captionLimit} characters, so yours will get cut off there.` }));
    }
    if (isTouch) tips.push(el('p', { className: 'tip', textContent: `Share video opens your phone's share menu. Pick ${a.label} there and it opens with your video ready.` }));
    if (v.tip) tips.push(el('p', { className: 'tip', textContent: v.tip }));
    if (v.desktopTip && !isTouch) tips.push(el('p', { className: 'tip', textContent: v.desktopTip }));
    tips.push(el('p', { className: 'hint', textContent: `In ${a.label}, start a new post, choose the video${guide.caption ? ', paste the caption' : ''}, post it, then come back here.` }));
  } else {
    if (guide.bio !== undefined) {
      tasks.push(guideTask(`${a.id}:bio`, n++, 'Copy bio', 'Bio copied', () => copyText(guide.bio)));
    }
    if (guide.avatar) {
      tasks.push(guideTask(`${a.id}:pic`, n++, SAVE_LABEL, isTouch ? 'Picture saved' : 'Picture downloaded', () => savePicture(guide.avatar)));
    }
    tasks.push(guideTask(`${a.id}:open`, n++, `Open ${a.label}`, `${a.label} opened`, () => { window.open(a.settingsUrl, '_blank', 'noopener'); }));

    if (guide.bio !== undefined && a.bioLimit && countChars(guide.bio) > a.bioLimit) {
      tips.push(el('p', { className: 'warn', textContent: `Heads up: ${a.label} only allows ${a.bioLimit} characters, so your bio will get cut off there.` }));
    }
    if (a.tip) tips.push(el('p', { className: 'tip', textContent: a.tip }));
    tips.push(el('p', { className: 'hint', textContent: `In ${a.label}, edit your profile, paste the bio${guide.avatar ? ' and pick the new picture' : ''}, save, then come back here.` }));
  }

  const next = el('button', { textContent: index === steps.length - 1 ? 'Done, finish' : `Done, next: ${steps[index + 1].label} →` });
  const advance = () => { guide.index++; renderGuide(); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // "Done" means they set the new picture there, so the circle shows it from now on.
  next.onclick = () => {
    if (!posting && guide.smallAvatar) {
      setCirclePic(a.id, guide.smallAvatar);
      render();
    }
    advance();
  };
  const skip = el('button', { className: 'link', textContent: 'Skip', onclick: advance });

  box.replaceChildren(
    el('div', { className: 'guide-head' }, [
      brandDot(a.id, 'guide-logo'),
      el('div', {}, [el('h2', { textContent: a.label }), el('p', { className: 'hint', textContent: `Step ${index + 1} of ${steps.length}` })]),
      el('button', { className: 'icon-btn', ariaLabel: 'Close guide', textContent: '×', onclick: close.onclick }),
    ]),
    progress,
    el('div', { className: 'tasks' }, tasks),
    ...tips,
    el('div', { className: 'guide-foot' }, [skip, next]),
  );
}

// ---------- add-account dialog ----------

const dialog = $('#add-dialog');

function renderPlatformList() {
  const list = $('#platform-list');
  const query = $('#platform-search').value.trim().toLowerCase();
  const linked = new Set(accounts().map((a) => a.id));
  list.replaceChildren();
  // Manual apps first, then auto ones; each group keeps the popularity order.
  const entries = Object.entries(PLATFORMS).sort(([, a], [, b]) => (a.kind === 'manual' ? 0 : 1) - (b.kind === 'manual' ? 0 : 1));
  for (const [id, p] of entries) {
    if (linked.has(id) || !p.label.toLowerCase().includes(query)) continue;
    const unavailable = id === 'youtube' && !status.youtube?.configured;
    const tag = el('span', {
      className: `kind ${p.kind}`,
      textContent: p.kind === 'auto' ? 'Auto' : 'Manual',
      title: p.kind === 'auto' ? 'Updates automatically for you' : "This app blocks profile edits, so you'll paste it in yourself",
    });
    const btn = el('button', { className: 'platform', disabled: unavailable }, [
      brandDot(id, 'dot'),
      el('span', { className: 'grow' }, [el('strong', { textContent: p.label }), el('small', { textContent: unavailable ? 'Not set up on this server yet' : p.blurb })]),
      tag,
    ]);
    btn.onclick = () => addPlatform(id);
    list.append(btn);
  }
  if (!list.children.length) {
    list.append(el('p', { className: 'muted', textContent: query ? 'No apps match that search.' : 'Every app is already linked.' }));
  }
}

function openAddDialog() {
  $('#platform-search').value = '';
  renderPlatformList();
  showPlatformList();
  dialog.showModal();
  $('#platform-search').focus();
}

function showPlatformList() {
  $('#platform-picker').hidden = false;
  $('#bluesky-form').hidden = true;
}

$('#platform-search').addEventListener('input', renderPlatformList);

function addPlatform(id) {
  if (id === 'bluesky') {
    $('#platform-picker').hidden = true;
    $('#bluesky-form').hidden = false;
    $('#bluesky-form').handle.focus();
  } else if (id === 'youtube') {
    pin(id);
    location.href = '/auth/youtube';
  } else {
    pin(id);
    dialog.close();
    render();
  }
}

$('#add-account').onclick = openAddDialog;
dialog.querySelector('[data-close]').onclick = () => dialog.close();
dialog.querySelector('[data-back]').onclick = showPlatformList;
dialog.addEventListener('click', (e) => e.target === dialog && dialog.close()); // click backdrop to close

$('#bluesky-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api('/api/bluesky/connect', {
      method: 'POST',
      body: { handle: form.handle.value, appPassword: form.appPassword.value },
    });
    form.reset();
    dialog.close();
    showError('');
    pin('bluesky');
    await refresh();
  } catch (err) {
    showError(err.message);
    dialog.close();
  } finally {
    button.disabled = false;
  }
});

// ---------- editor ----------

function renderAvatar() {
  const src = newAvatar || currentAvatar;
  $('#avatar-img').hidden = !src;
  if (src) $('#avatar-img').src = src;
  $('#avatar-placeholder').hidden = Boolean(src);
  $('#avatar-tag').hidden = !newAvatar;
  $('#avatar-undo').hidden = !newAvatar;
}

function updateBioCount() {
  const n = countChars($('#bio').value);
  const limits = included().filter((a) => a.bioLimit);
  $('#bio-count').textContent = limits.length
    ? limits.map((a) => `${a.label} ${n}/${a.bioLimit}${n > a.bioLimit ? ' (too long)' : ''}`).join(' · ')
    : `${n} characters`;
}

$('#bio').addEventListener('input', updateBioCount);

// Crop to a centered square and shrink to 800x800 JPEG so it fits every
// platform's size limit (Bluesky's is 1 MB).
// Tiny version of a picture for a circle (about 5-10 KB).
function shrinkImage(dataUrl, size = 160) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = dataUrl;
  });
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 800;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 800, 800);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = URL.createObjectURL(file);
  });
}

$('#avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    newAvatar = await resizeImage(file);
    render();
  } catch (err) {
    showError(err.message);
  }
  e.target.value = '';
});

$('#avatar-undo').onclick = () => {
  newAvatar = null;
  render();
};

// ---------- choose which apps to update ----------

const chooser = $('#choose-dialog');
let chooserMode = 'profile'; // 'profile' or 'post'

function chosenIds() {
  return [...chooser.querySelectorAll('.choose-list input:checked')].map((i) => i.value);
}

function updateChooserButton() {
  const n = chosenIds().length;
  const btn = chooser.querySelector('[data-confirm]');
  btn.disabled = n === 0;
  const verb = chooserMode === 'post' ? 'Post to' : 'Update';
  btn.textContent = n ? `${verb} ${n} app${n === 1 ? '' : 's'}` : 'Pick at least one app';
  const all = chooser.querySelector('[data-toggle-all]');
  all.textContent = n === chooser.querySelectorAll('.choose-list input:not(:disabled)').length ? 'Select none' : 'Select all';
}

// Why an app can't take this video, or null if it can.
function videoProblem(a) {
  if (a.id === 'bluesky' && videoFile?.size > BLUESKY_MAX_VIDEO_BYTES) return 'Video is over 100 MB';
  const limit = VIDEO[a.id]?.captionLimit;
  if (limit && countChars($('#video-caption').value) > limit) return `Caption too long (max ${limit})`;
  return null;
}

function openChooser(mode = 'profile') {
  chooserMode = mode;
  const posting = mode === 'post';
  const bio = $('#bio').value;
  const updateBio = $('#update-bio').checked;
  const list = chooser.querySelector('.choose-list');
  list.replaceChildren();
  const candidates = posting ? accounts().filter((a) => VIDEO[a.id]) : accounts();
  for (const a of candidates) {
    const box = el('input', { type: 'checkbox', value: a.id, checked: a.included, disabled: !a.ready });
    box.onchange = updateChooserButton;
    const problem = !a.ready ? null : posting ? videoProblem(a) : updateBio && a.bioLimit && countChars(bio) > a.bioLimit ? `Bio too long (max ${a.bioLimit})` : null;
    const over = Boolean(problem);
    const note = !a.ready
      ? 'Not connected yet. Tap its circle to connect'
      : problem ?? (a.kind === 'auto' ? (posting ? 'Uploads automatically' : 'Updates automatically') : posting ? 'Guided share' : 'Guided copy & paste');
    list.append(
      el('label', { className: 'choose-item' }, [
        box,
        brandDot(a.id, 'dot'),
        el('span', { className: 'grow' }, [el('strong', { textContent: a.label }), el('small', { className: over ? 'warn' : '', textContent: note })]),
        el('span', { className: `kind ${a.kind}`, textContent: a.kind === 'auto' ? 'Auto' : 'Manual' }),
      ]),
    );
  }
  updateChooserButton();
  chooser.showModal();
}

$('#apply').addEventListener('click', () => {
  if (!$('#update-bio').checked && !newAvatar) return showError('Nothing to update: choose a new picture or tick "Update bio".');
  showError('');
  openChooser();
});

chooser.querySelector('[data-toggle-all]').onclick = () => {
  const boxes = chooser.querySelectorAll('.choose-list input:not(:disabled)');
  const selectAll = chosenIds().length !== boxes.length;
  boxes.forEach((b) => (b.checked = selectAll));
  updateChooserButton();
};
chooser.querySelector('[data-cancel]').onclick = () => chooser.close();
chooser.addEventListener('click', (e) => e.target === chooser && chooser.close()); // click backdrop to close

chooser.querySelector('[data-confirm]').onclick = () => {
  const ids = new Set(chosenIds());
  const targets = accounts().filter((a) => ids.has(a.id));
  if (chooserMode === 'post') {
    // Auto apps would reject it, so stop here; manual apps just get a warning in the guide.
    const blocked = targets.filter((a) => a.kind === 'auto' && videoProblem(a));
    chooser.close();
    if (blocked.length) return showError(blocked.map((a) => `${a.label}: ${videoProblem(a)}.`).join(' ') + ' Fix it or untick those apps.');
    return runPost(targets);
  }
  const updateBio = $('#update-bio').checked;
  const bio = $('#bio').value;
  // Only block on apps we update ourselves; manual ones just get a warning in the guide.
  const tooLong = targets.filter((a) => updateBio && a.kind === 'auto' && countChars(bio) > a.bioLimit);
  if (tooLong.length) {
    chooser.close();
    return showError(`Bio is too long for ${tooLong.map((a) => a.label).join(', ')}. Shorten it or untick those apps.`);
  }
  chooser.close();
  runUpdate(targets, updateBio, bio);
};

async function runUpdate(targets, updateBio, bio) {
  showError('');
  const button = $('#apply');
  button.disabled = true;
  button.textContent = 'Updating…';
  const list = $('#results');
  list.replaceChildren();
  const avatar = newAvatar; // keep it for the guide; newAvatar is cleared after auto updates
  try {
    const autoIds = targets.filter((a) => a.kind === 'auto').map((a) => a.id);
    const results = autoIds.length
      ? await api('/api/apply', { method: 'POST', body: { targets: autoIds, bio: updateBio ? bio : undefined, avatar } })
      : {};
    for (const id of autoIds) {
      const r = results[id];
      list.append(el('li', { className: r.ok ? 'ok' : 'bad', textContent: `${PLATFORMS[id].label}: ${r.message}` }));
    }
    if (autoIds.length) {
      newAvatar = null;
      await refresh(); // show the updated pictures in the circles
    }
    const manual = targets.filter((a) => a.kind === 'manual');
    if (manual.length) startGuide(manual, { mode: 'profile', bio: updateBio ? bio : undefined, avatar });
  } catch (err) {
    showError(err.message);
  } finally {
    render();
  }
}

// ---------- tabs ----------

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('#tab-profile').hidden = name !== 'profile';
  $('#tab-post').hidden = name !== 'post';
  store.set('ph_tab', name);
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
showTab(store.get('ph_tab', 'profile'));

// ---------- post a video ----------

let videoFile = null;
let videoMeta = null; // { width, height, duration }
let videoUrl = null;

const formatSize = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`);
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const postTargets = () => included().filter((a) => VIDEO[a.id]);

function renderPost() {
  $('#post-video').disabled = !videoFile || !accounts().some((a) => a.ready && VIDEO[a.id]);
  const n = countChars($('#video-caption').value);
  const limits = postTargets().filter((a) => VIDEO[a.id].captionLimit);
  $('#caption-count').textContent = limits.length
    ? limits.map((a) => {
        const max = VIDEO[a.id].captionLimit;
        return `${a.label} ${n}/${max}${n > max ? ' (too long)' : ''}`;
      }).join(' · ')
    : `${n} characters`;
}

function setVideo(file) {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoFile = file;
  videoMeta = null;
  videoUrl = file ? URL.createObjectURL(file) : null;
  const preview = $('#video-preview');
  preview.hidden = !file;
  $('#video-empty').hidden = Boolean(file);
  if (file) preview.src = videoUrl;
  else preview.removeAttribute('src');
  $('#video-info').textContent = file ? `${file.name} · ${formatSize(file.size)}` : '';
  renderPost();
  renderThumb();
}

$('#video-preview').addEventListener('loadedmetadata', (e) => {
  const v = e.target;
  videoMeta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  const shape = v.videoHeight > v.videoWidth ? 'vertical' : v.videoHeight < v.videoWidth ? 'horizontal' : 'square';
  if (videoFile) $('#video-info').textContent = `${videoFile.name} · ${formatSize(videoFile.size)} · ${formatTime(v.duration)} · ${shape}`;
  renderThumb();
});

// ---------- YouTube thumbnail ----------

let thumbnail = null; // data URL, 1280x720 JPEG

// YouTube treats vertical or square videos up to 3 minutes as Shorts.
const looksLikeShort = () => Boolean(videoMeta && videoMeta.height >= videoMeta.width && videoMeta.duration <= 180);

function renderThumb() {
  $('#thumb-img').hidden = !thumbnail;
  if (thumbnail) $('#thumb-img').src = thumbnail;
  $('#thumb-empty').hidden = Boolean(thumbnail);
  $('#thumb-remove').hidden = !thumbnail;
  $('#shorts-note').hidden = !(thumbnail && looksLikeShort());
}

// Crop to 16:9 and size to 1280x720, YouTube's recommended thumbnail size,
// keeping it under YouTube's 2 MB limit.
function makeThumbnail(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const scale = Math.max(1280 / img.width, 720 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      canvas.getContext('2d').drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      let quality = 0.92;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length * 0.75 > 2 * 1024 * 1024 && quality > 0.5) {
        quality -= 0.1;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(data);
    };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = URL.createObjectURL(file);
  });
}

$('#thumb-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    thumbnail = await makeThumbnail(file);
    renderThumb();
  } catch (err) {
    showError(err.message);
  }
});

$('#thumb-remove').onclick = () => {
  thumbnail = null;
  renderThumb();
};

$('#video-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && !file.type.startsWith('video/') && file.type !== '') return showError('Please choose a video file.');
  showError('');
  setVideo(file ?? null);
  e.target.value = '';
});

$('#video-caption').addEventListener('input', renderPost);

$('#post-video').addEventListener('click', () => {
  if (!videoFile) return showError('Choose a video first.');
  showError('');
  openChooser('post');
});

// Phones get the share sheet, so the video can go straight into TikTok,
// Instagram and so on; computers get a normal download.
async function shareVideo(file) {
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false; // they closed the share sheet
    }
  }
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: file.name || 'video.mp4' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

// Raw upload with progress (fetch can't report upload progress).
function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload/video');
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

function setPostProgress(fraction, text) {
  const box = $('#post-progress');
  box.hidden = fraction === null;
  if (fraction === null) return;
  box.querySelector('.progress span').style.width = `${Math.round(fraction * 100)}%`;
  box.querySelector('p').textContent = text;
}

async function runPost(targets) {
  const file = videoFile;
  const title = $('#video-title').value.trim();
  const caption = $('#video-caption').value;
  const privacy = $('#yt-privacy').value;
  const button = $('#post-video');
  const list = $('#post-results');
  list.replaceChildren();
  button.disabled = true;
  button.textContent = 'Posting…';
  try {
    const auto = targets.filter((a) => a.kind === 'auto');
    if (auto.length) {
      setPostProgress(0, 'Uploading your video…');
      const { id } = await uploadVideo(file, (p) => setPostProgress(p * 0.9, `Uploading your video… ${Math.round(p * 100)}%`));
      setPostProgress(0.95, `Posting to ${auto.map((a) => a.label).join(' and ')}… big videos can take a minute.`);
      const results = await api('/api/post-video', {
        method: 'POST',
        body: {
          uploadId: id,
          targets: auto.map((a) => a.id),
          title,
          caption,
          privacy,
          aspectRatio: videoMeta,
          thumbnail: auto.some((a) => a.id === 'youtube') ? thumbnail : null,
        },
      });
      for (const a of auto) {
        const r = results[a.id] ?? { ok: false, message: 'No response.' };
        const parts = [el('span', { textContent: `${a.label}: ${r.message}` })];
        if (r.url) parts.push(el('a', { className: 'button secondary', href: r.url, target: '_blank', rel: 'noopener', textContent: 'View post' }));
        list.append(el('li', { className: r.ok ? 'ok' : 'bad' }, parts));
      }
    }
    const manual = targets.filter((a) => a.kind === 'manual');
    if (manual.length) startGuide(manual, { mode: 'post', caption, video: file });
  } catch (err) {
    showError(err.message);
  } finally {
    setPostProgress(null);
    button.textContent = 'Post video';
    renderPost();
  }
}

// ---------- reset ----------
// Puts the app back to how a brand-new visitor sees it: logs out of
// connected apps, forgets saved choices, and clears the editor.

$('#reset').onclick = async () => {
  if (!confirm('Reset everything? This disconnects your accounts, brings back the default apps, and clears your bio and picture. Your real profiles on each app are not changed.')) return;
  for (const [id, s] of Object.entries(status)) {
    if (s.connected) await api(`/api/${id}/disconnect`, { method: 'POST' }).catch(() => {});
  }
  ['ph_apps', 'ph_manual', 'ph_excluded', 'ph_ios_hint_closed', 'ph_pics'].forEach((key) => {
    try { localStorage.removeItem(key); } catch {}
  });
  circlePics = {};
  pinned = DEFAULT_APPS;
  excluded = new Set();
  activeId = null;
  editing = false;
  newAvatar = null;
  guide = null;
  $('#bio').value = '';
  $('#update-bio').checked = true;
  $('#results').replaceChildren();
  setVideo(null);
  $('#video-title').value = '';
  $('#video-caption').value = '';
  $('#yt-privacy').value = 'private';
  thumbnail = null;
  renderThumb();
  $('#post-results').replaceChildren();
  showTab('profile');
  showError('');
  renderGuide();
  await refresh();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ---------- install on home screen ----------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  // Android/desktop Chrome: show our own Install button instead of the browser's banner.
  e.preventDefault();
  installPrompt = e;
  $('#install').hidden = false;
});
$('#install').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install').hidden = true;
};

// iPhone/iPad Safari has no install prompt, so explain the Share → Add to Home Screen steps once.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (isIOS && !installed && !store.get('ph_ios_hint_closed', false)) $('#ios-install').hidden = false;
$('#ios-install button').onclick = () => {
  $('#ios-install').hidden = true;
  store.set('ph_ios_hint_closed', true);
};

// ---------- start ----------

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  showError(params.get('error'));
  history.replaceState(null, '', '/');
}
refresh().catch((err) => showError(err.message));
