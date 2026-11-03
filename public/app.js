const PLATFORMS = {
  bluesky: { label: 'Bluesky', bioLimit: 256 },
  youtube: { label: 'YouTube', bioLimit: 1000 },
};

const $ = (sel) => document.querySelector(sel);
const segmenter = new Intl.Segmenter();
const countChars = (text) => [...segmenter.segment(text)].length;

let status = {};
let avatarDataUrl = null;

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
  const el = $('#error');
  el.textContent = message;
  el.hidden = !message;
}

// ---------- connection cards ----------

async function refresh() {
  status = await api('/api/status');

  const bsky = $('#card-bluesky');
  bsky.classList.toggle('connected', status.bluesky.connected);
  bsky.querySelector('.status').textContent = status.bluesky.connected ? `@${status.bluesky.handle}` : 'Not connected';
  $('#bluesky-form').hidden = status.bluesky.connected;
  bsky.querySelector('.disconnect').hidden = !status.bluesky.connected;

  const yt = $('#card-youtube');
  yt.classList.toggle('connected', status.youtube.connected);
  yt.querySelector('.status').textContent = status.youtube.connected ? status.youtube.channelTitle : 'Not connected';
  yt.querySelector('.connect-link').hidden = status.youtube.connected || !status.youtube.configured;
  yt.querySelector('.not-configured').hidden = status.youtube.configured;
  yt.querySelector('.disconnect').hidden = !status.youtube.connected;

  renderTargets();
  await loadCurrentBio();
}

function renderTargets() {
  const box = $('#targets');
  box.innerHTML = '';
  for (const [id, { label }] of Object.entries(PLATFORMS)) {
    if (!status[id]?.connected) continue;
    const wrap = document.createElement('label');
    wrap.className = 'check';
    wrap.innerHTML = `<input type="checkbox" value="${id}" checked /> ${label}`;
    box.append(wrap);
  }
  if (!box.children.length) box.innerHTML = '<span class="muted">Connect an account to start.</span>';
  updateApplyButton();
  updateBioCount();
}

// Prefill the bio box with whatever the first connected platform currently has.
async function loadCurrentBio() {
  if ($('#bio').value) return;
  const profiles = await api('/api/profiles');
  const first = Object.values(profiles).find((p) => p && !p.error);
  if (first) {
    $('#bio').value = first.bio;
    updateBioCount();
  }
}

$('#bluesky-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/bluesky/connect', {
      method: 'POST',
      body: { handle: form.handle.value, appPassword: form.appPassword.value },
    });
    form.reset();
    showError('');
    await refresh();
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('.disconnect').forEach((btn) =>
  btn.addEventListener('click', async () => {
    await api(`/api/${btn.dataset.platform}/disconnect`, { method: 'POST' });
    await refresh();
  }),
);

// ---------- editor ----------

function selectedTargets() {
  return [...document.querySelectorAll('#targets input:checked')].map((i) => i.value);
}

function updateApplyButton() {
  $('#apply').disabled = selectedTargets().length === 0;
}

function updateBioCount() {
  const n = countChars($('#bio').value);
  const parts = selectedTargets().map((id) => {
    const { label, bioLimit } = PLATFORMS[id];
    return `${label}: ${n}/${bioLimit}${n > bioLimit ? ' — too long' : ''}`;
  });
  $('#bio-count').textContent = parts.length ? parts.join(' · ') : `${n} characters`;
}

$('#bio').addEventListener('input', updateBioCount);
$('#targets').addEventListener('change', () => {
  updateApplyButton();
  updateBioCount();
});

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

function setAvatar(dataUrl) {
  avatarDataUrl = dataUrl;
  $('#avatar-preview').hidden = !dataUrl;
  $('#avatar-empty').hidden = Boolean(dataUrl);
  $('#avatar-clear').hidden = !dataUrl;
  $('#download-avatar').hidden = !dataUrl;
  if (dataUrl) {
    $('#avatar-preview').src = dataUrl;
    $('#download-avatar').href = dataUrl;
  }
}

$('#avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    setAvatar(await resizeImage(file));
  } catch (err) {
    showError(err.message);
  }
  e.target.value = '';
});

$('#avatar-clear').addEventListener('click', () => setAvatar(null));

$('#apply').addEventListener('click', async () => {
  const targets = selectedTargets();
  const updateBio = $('#update-bio').checked;
  if (!updateBio && !avatarDataUrl) return showError('Nothing to update: choose a picture or tick "Update bio".');

  const bio = $('#bio').value;
  const tooLong = targets.filter((id) => updateBio && countChars(bio) > PLATFORMS[id].bioLimit);
  if (tooLong.length) return showError(`Bio is too long for ${tooLong.map((id) => PLATFORMS[id].label).join(', ')}.`);

  showError('');
  const button = $('#apply');
  button.disabled = true;
  button.textContent = 'Updating…';
  try {
    const results = await api('/api/apply', {
      method: 'POST',
      body: { targets, bio: updateBio ? bio : undefined, avatar: avatarDataUrl },
    });
    const list = $('#results');
    list.innerHTML = '';
    for (const [id, r] of Object.entries(results)) {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'bad';
      li.textContent = `${PLATFORMS[id]?.label ?? id}: ${r.message}`;
      list.append(li);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    button.textContent = 'Update selected profiles';
    updateApplyButton();
  }
});

// ---------- manual platforms ----------

$('#copy-bio').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#bio').value);
  $('#copy-bio').textContent = 'Copied!';
  setTimeout(() => ($('#copy-bio').textContent = 'Copy bio'), 1500);
});

// ---------- start ----------

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  showError(params.get('error'));
  history.replaceState(null, '', '/');
}
refresh().catch((err) => showError(err.message));
