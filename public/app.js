// "auto" platforms are updated by the server. "manual" ones can't be edited by
// apps, so we just help you copy your bio/picture and open their settings page.
// Ordered from most to least popular (roughly, by monthly users).
// Logos are from Simple Icons (public/icons, CC0). LinkedIn isn't in that set,
// so it uses a text mark instead.
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
let manualAdded = store.get('ph_manual', []); // e.g. ['instagram']
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

// The platform's logo, tinted with CSS mask so it can sit on its brand color.
function logo(id) {
  const p = PLATFORMS[id];
  if (p.text) return el('span', { className: 'logo-text', textContent: p.text });
  const mark = el('span', { className: 'logo', role: 'img', ariaLabel: p.label });
  mark.style.setProperty('--icon', `url(icons/${id}.svg)`);
  mark.style.background = p.fg ?? '#fff';
  return mark;
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
    const linked = p.kind === 'auto' ? status[id]?.connected : manualAdded.includes(id);
    if (!linked) continue;
    const profile = profiles[id] ?? {};
    const name =
      id === 'bluesky' ? `@${status.bluesky.handle}` : id === 'youtube' ? status.youtube.channelTitle : p.label;
    list.push({ id, ...p, name, avatar: profile.avatar, included: !excluded.has(id) });
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
  const n = included().length;
  $('#apply').disabled = n === 0;
  $('#apply').textContent = n ? `Update ${n} profile${n === 1 ? '' : 's'}` : 'Update profiles';
}

function renderCircles() {
  const row = $('#account-row');
  row.querySelectorAll('.circle:not(.add)').forEach((c) => c.remove());
  const list = accounts();

  for (const a of list) {
    const circle = el('button', {
      className: `circle${a.included ? '' : ' excluded'}${a.id === activeId ? ' active' : ''}`,
      title: `${a.label}: ${a.name}`,
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
    ? 'Tap a circle to manage it. Faded ones are skipped when you update.'
    : 'Tap + to link your first account.';
}

function renderDetail() {
  const box = $('#account-detail');
  const a = accounts().find((x) => x.id === activeId);
  box.hidden = !a;
  if (!a) return;

  const toggle = el('input', { type: 'checkbox', checked: a.included });
  toggle.onchange = () => {
    toggle.checked ? excluded.delete(a.id) : excluded.add(a.id);
    store.set('ph_excluded', [...excluded]);
    render();
  };

  const remove = el('button', { className: 'danger', textContent: a.kind === 'auto' ? 'Disconnect' : 'Remove' });
  remove.onclick = async () => {
    if (a.kind === 'auto') await api(`/api/${a.id}/disconnect`, { method: 'POST' });
    else {
      manualAdded = manualAdded.filter((id) => id !== a.id);
      store.set('ph_manual', manualAdded);
    }
    activeId = null;
    await refresh();
  };

  const actions = el('div', { className: 'actions' }, a.kind === 'manual' ? manualActions(a) : []);
  actions.append(remove);

  box.replaceChildren(
    el('div', { className: 'title' }, [el('strong', { textContent: a.label }), el('span', { className: 'muted', textContent: a.name === a.label ? 'Manual' : a.name })]),
    el('p', { className: 'hint', textContent: a.blurb }),
    el('label', { className: 'check' }, [toggle, ' Include when updating']),
    actions,
  );
}

// Buttons that help with platforms we can't update for you.
function manualActions(a) {
  const copy = el('button', { className: 'secondary', textContent: 'Copy bio' });
  copy.onclick = async () => {
    await navigator.clipboard.writeText($('#bio').value);
    copy.textContent = 'Copied!';
    setTimeout(() => (copy.textContent = 'Copy bio'), 1500);
  };
  const buttons = [copy];
  if (newAvatar) buttons.push(el('a', { className: 'button secondary', href: newAvatar, download: 'profile.jpg', textContent: 'Download picture' }));
  buttons.push(el('a', { className: 'button secondary', href: a.settingsUrl, target: '_blank', rel: 'noopener', textContent: `Open ${a.label}` }));
  return buttons;
}

// ---------- add-account dialog ----------

const dialog = $('#add-dialog');

function renderPlatformList() {
  const list = $('#platform-list');
  const query = $('#platform-search').value.trim().toLowerCase();
  const linked = new Set(accounts().map((a) => a.id));
  list.replaceChildren();
  for (const [id, p] of Object.entries(PLATFORMS)) {
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
    location.href = '/auth/youtube';
  } else {
    manualAdded.push(id);
    store.set('ph_manual', manualAdded);
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

$('#apply').addEventListener('click', async () => {
  const targets = included();
  const updateBio = $('#update-bio').checked;
  if (!updateBio && !newAvatar) return showError('Nothing to update: choose a new picture or tick "Update bio".');

  const bio = $('#bio').value;
  // Only block on apps we update ourselves; manual ones just show a warning in the counter.
  const tooLong = targets.filter((a) => updateBio && a.kind === 'auto' && countChars(bio) > a.bioLimit);
  if (tooLong.length) return showError(`Bio is too long for ${tooLong.map((a) => a.label).join(', ')}.`);

  showError('');
  const button = $('#apply');
  button.disabled = true;
  button.textContent = 'Updating…';
  const list = $('#results');
  list.replaceChildren();
  try {
    const autoIds = targets.filter((a) => a.kind === 'auto').map((a) => a.id);
    const results = autoIds.length
      ? await api('/api/apply', { method: 'POST', body: { targets: autoIds, bio: updateBio ? bio : undefined, avatar: newAvatar } })
      : {};
    for (const a of targets) {
      if (a.kind === 'manual') {
        list.append(el('li', {}, [el('span', { textContent: `${a.label}: paste it in yourself` }), el('div', { className: 'actions' }, manualActions(a))]));
      } else {
        const r = results[a.id];
        list.append(el('li', { className: r.ok ? 'ok' : 'bad', textContent: `${a.label}: ${r.message}` }));
      }
    }
    if (autoIds.length) {
      newAvatar = null;
      await refresh(); // show the updated pictures in the circles
    }
  } catch (err) {
    showError(err.message);
  } finally {
    render();
  }
});

// ---------- start ----------

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  showError(params.get('error'));
  history.replaceState(null, '', '/');
}
refresh().catch((err) => showError(err.message));
