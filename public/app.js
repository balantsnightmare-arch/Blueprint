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
  discord: { label: 'Discord', kind: 'manual', color: '#5865F2', bioLimit: 190, settingsUrl: 'https://discord.com/app', blurb: MANUAL },
  twitch: { label: 'Twitch', kind: 'manual', color: '#9146FF', bioLimit: 300, settingsUrl: 'https://www.twitch.tv/settings/profile', blurb: MANUAL },
  steam: { label: 'Steam', kind: 'manual', color: '#000000', settingsUrl: 'https://steamcommunity.com/my/edit/info', blurb: MANUAL },
  github: { label: 'GitHub', kind: 'manual', color: '#181717', bioLimit: 160, settingsUrl: 'https://github.com/settings/profile', blurb: MANUAL },
  bluesky: { label: 'Bluesky', kind: 'auto', color: '#1185FE', bioLimit: 256, blurb: 'A newer X/Twitter alternative. Updates bio and picture automatically' },
  mastodon: { label: 'Mastodon', kind: 'manual', color: '#6364FF', bioLimit: 500, settingsUrl: 'https://mastodon.social/settings/profile', blurb: `${MANUAL} (opens mastodon.social)` },
};

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

function accounts() {
  const list = [];
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const connected = p.kind === 'auto' && Boolean(status[id]?.connected);
    if (!connected && !pinned.includes(id)) continue;
    // An auto app that's pinned but not connected yet shows as a faded circle you can tap to connect.
    const ready = p.kind === 'manual' || connected;
    const profile = profiles[id] ?? {};
    const name = !connected ? p.label : id === 'bluesky' ? `@${status.bluesky.handle}` : status.youtube.channelTitle;
    list.push({ id, ...p, name, ready, avatar: profile.avatar, included: ready && !excluded.has(id) });
  }
  return list;
}

const included = () => accounts().filter((a) => a.included);

async function refresh() {
  status = await api('/api/status');
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
  $('#apply').disabled = !accounts().some((a) => a.ready);
  $('#apply').textContent = 'Update profiles';
}

function renderCircles() {
  const row = $('#account-row');
  row.querySelectorAll('.circle:not(.add)').forEach((c) => c.remove());
  const list = accounts();

  for (const a of list) {
    const circle = el('button', {
      className: `circle${a.ready ? (a.included ? '' : ' excluded') : ' pending'}${a.id === activeId ? ' active' : ''}`,
      title: a.ready ? `${a.label}: ${a.name}` : `${a.label}: tap to connect`,
      onclick: () => {
        activeId = activeId === a.id ? null : a.id;
        render();
      },
    });
    circle.style.background = a.color;
    circle.style.color = a.fg ?? '#fff';
    if (a.avatar) circle.append(el('img', { src: a.avatar, alt: '' }), brandDot(a.id, 'badge'));
    else circle.append(logo(a.id));
    row.insertBefore(circle, $('#add-account'));
  }

  $('#account-hint').textContent = list.length
    ? 'Tap a circle to manage it. Faded ones start unticked when you update.'
    : 'Tap + to link your first account.';
}

function renderDetail() {
  const box = $('#account-detail');
  const a = accounts().find((x) => x.id === activeId);
  box.hidden = !a;
  if (!a) return;

  const connected = a.kind === 'auto' && a.ready;

  // Remove takes the circle away entirely (and logs out of auto apps).
  const remove = el('button', { className: 'danger', textContent: 'Remove' });
  remove.onclick = async () => {
    if (connected) await api(`/api/${a.id}/disconnect`, { method: 'POST' });
    pinned = pinned.filter((id) => id !== a.id);
    savePinned();
    activeId = null;
    await refresh();
  };

  const title = el('div', { className: 'title' }, [
    el('strong', { textContent: a.label }),
    el('span', { className: 'muted', textContent: !a.ready ? 'Not connected' : a.kind === 'manual' ? 'Manual' : a.name }),
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

  box.replaceChildren(title, el('p', { className: 'hint', textContent: a.blurb }), el('label', { className: 'check' }, [toggle, ' Include when updating']), actions);
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
// Walks through each manual app one at a time: copy bio, save picture,
// open the app, then move on to the next.

let guide = null; // { steps, index, bio, avatar, done: Set }

function startGuide(steps, bio, avatar) {
  guide = { steps, index: 0, bio, avatar, done: new Set() };
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

  if (index >= steps.length) {
    box.replaceChildren(
      el('h2', { textContent: 'All done 🎉' }),
      el('p', { className: 'muted', textContent: `You went through ${steps.length} app${steps.length === 1 ? '' : 's'}. Your profiles should all match now.` }),
      el('div', { className: 'guide-foot' }, [close]),
    );
    return;
  }

  const a = steps[index];
  const progress = el('div', { className: 'progress' }, [el('span')]);
  progress.firstChild.style.width = `${(index / steps.length) * 100}%`;

  const tasks = [];
  let n = 1;
  if (guide.bio !== undefined) {
    tasks.push(guideTask(`${a.id}:bio`, n++, 'Copy bio', 'Bio copied', () => copyText(guide.bio)));
  }
  if (guide.avatar) {
    tasks.push(guideTask(`${a.id}:pic`, n++, SAVE_LABEL, isTouch ? 'Picture saved' : 'Picture downloaded', () => savePicture(guide.avatar)));
  }
  tasks.push(guideTask(`${a.id}:open`, n++, `Open ${a.label}`, `${a.label} opened`, () => { window.open(a.settingsUrl, '_blank', 'noopener'); }));

  const tips = [];
  if (guide.bio !== undefined && a.bioLimit && countChars(guide.bio) > a.bioLimit) {
    tips.push(el('p', { className: 'warn', textContent: `Heads up: ${a.label} only allows ${a.bioLimit} characters, so your bio will get cut off there.` }));
  }
  tips.push(el('p', { className: 'hint', textContent: `In ${a.label}, edit your profile, paste the bio${guide.avatar ? ' and pick the new picture' : ''}, save, then come back here.` }));

  const next = el('button', { textContent: index === steps.length - 1 ? 'Done, finish' : `Done, next: ${steps[index + 1].label} →` });
  next.onclick = () => { guide.index++; renderGuide(); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const skip = el('button', { className: 'link', textContent: 'Skip', onclick: next.onclick });

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
      title: p.kind === 'auto' ? 'Profile Hub updates it for you' : "This app blocks profile edits, so you'll paste it in yourself",
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

function chosenIds() {
  return [...chooser.querySelectorAll('.choose-list input:checked')].map((i) => i.value);
}

function updateChooserButton() {
  const n = chosenIds().length;
  const btn = chooser.querySelector('[data-confirm]');
  btn.disabled = n === 0;
  btn.textContent = n ? `Update ${n} app${n === 1 ? '' : 's'}` : 'Pick at least one app';
  const all = chooser.querySelector('[data-toggle-all]');
  all.textContent = n === accounts().filter((a) => a.ready).length ? 'Select none' : 'Select all';
}

function openChooser() {
  const bio = $('#bio').value;
  const updateBio = $('#update-bio').checked;
  const list = chooser.querySelector('.choose-list');
  list.replaceChildren();
  for (const a of accounts()) {
    const box = el('input', { type: 'checkbox', value: a.id, checked: a.included, disabled: !a.ready });
    box.onchange = updateChooserButton;
    const over = a.ready && updateBio && a.bioLimit && countChars(bio) > a.bioLimit;
    const note = !a.ready
      ? 'Not connected yet. Tap its circle to connect'
      : over ? `Bio too long (max ${a.bioLimit})` : a.kind === 'auto' ? 'Updates automatically' : 'Guided copy & paste';
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
    if (manual.length) startGuide(manual, updateBio ? bio : undefined, avatar);
  } catch (err) {
    showError(err.message);
  } finally {
    render();
  }
}

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
