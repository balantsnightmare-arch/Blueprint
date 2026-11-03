// "auto" platforms are updated by the server. "manual" ones can't be edited by
// apps, so we just help you copy your bio/picture and open their settings page.
const PLATFORMS = {
  bluesky: { label: 'Bluesky', kind: 'auto', color: '#1185fe', letter: 'B', bioLimit: 256, blurb: 'Bio and picture update automatically' },
  youtube: { label: 'YouTube', kind: 'auto', color: '#ff0033', letter: 'Y', bioLimit: 1000, blurb: 'Channel description updates automatically' },
  instagram: { label: 'Instagram', kind: 'manual', color: '#d62976', letter: 'I', settingsUrl: 'https://www.instagram.com/accounts/edit/', blurb: 'Copy and paste (Instagram blocks apps)' },
  discord: { label: 'Discord', kind: 'manual', color: '#5865f2', letter: 'D', settingsUrl: 'https://discord.com/app', blurb: 'Copy and paste (Discord blocks apps)' },
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
    if (a.avatar) circle.append(el('img', { src: a.avatar, alt: '' }));
    else circle.append(a.letter);
    const badge = el('span', { className: 'badge', textContent: a.letter });
    badge.style.background = a.color;
    if (a.avatar) circle.append(badge);
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

function openAddDialog() {
  const list = $('#platform-list');
  const linked = new Set(accounts().map((a) => a.id));
  list.replaceChildren();
  for (const [id, p] of Object.entries(PLATFORMS)) {
    if (linked.has(id)) continue;
    const unavailable = id === 'youtube' && !status.youtube?.configured;
    const dot = el('span', { className: 'dot', textContent: p.letter });
    dot.style.background = p.color;
    const btn = el('button', { className: 'platform', disabled: unavailable }, [
      dot,
      el('span', {}, [el('strong', { textContent: p.label }), el('small', { textContent: unavailable ? 'Not set up on this server yet' : p.blurb })]),
    ]);
    btn.onclick = () => addPlatform(id);
    list.append(btn);
  }
  if (!list.children.length) list.append(el('p', { className: 'muted', textContent: 'Every available platform is already linked.' }));
  showPlatformList();
  dialog.showModal();
}

function showPlatformList() {
  $('#platform-list').hidden = false;
  $('#bluesky-form').hidden = true;
}

function addPlatform(id) {
  if (id === 'bluesky') {
    $('#platform-list').hidden = true;
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
  const tooLong = targets.filter((a) => updateBio && a.bioLimit && countChars(bio) > a.bioLimit);
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
