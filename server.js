import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { AtpAgent } from '@atproto/api';
import { google } from 'googleapis';

const PORT = Number(process.env.PORT) || 3000;
// Locally, only listen on localhost. When hosted, set HOST=0.0.0.0.
const HOST = process.env.HOST || 'localhost';
const BASE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ---------- per-visitor sessions ----------
// Each browser gets a random session id in a cookie, and its connections are
// kept in memory under that id, so visitors can only touch the accounts they
// connected themselves. Nothing is written to disk: a restart logs everyone out.

const SESSION_COOKIE = 'ph_sid';
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SESSIONS = 1000;
const sessions = new Map(); // sid -> { bluesky, youtube, upload, lastSeen }

// A session holds at most one uploaded video, as a temp file on disk.
function dropUpload(session) {
  if (session?.upload) fs.rm(session.upload.file, { force: true }, () => {});
  if (session) session.upload = null;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// append (not setHeader) so several cookies can be set on one response.
function setCookie(req, res, name, value, { path = '/', maxAge }) {
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function sessionMiddleware(req, res, next) {
  let sid = readCookie(req, SESSION_COOKIE);
  let session = sid && sessions.get(sid);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      // Evict the least recently used session to keep memory bounded.
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      dropUpload(oldest[1]);
      sessions.delete(oldest[0]);
    }
    sid = crypto.randomBytes(32).toString('base64url');
    session = { bluesky: null, youtube: null, upload: null, lastSeen: Date.now() };
    sessions.set(sid, session);
    setCookie(req, res, SESSION_COOKIE, sid, { maxAge: SESSION_IDLE_MS / 1000 });
  }
  session.lastSeen = Date.now();
  req.session = session;
  next();
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  const uploadCutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [sid, s] of sessions) {
    if (s.lastSeen < cutoff) {
      dropUpload(s);
      sessions.delete(sid);
    } else if (s.upload && s.upload.at < uploadCutoff) {
      dropUpload(s);
    }
  }
}, 10 * 60 * 1000).unref();

// Cross-site pages can't send a JSON POST without a CORS preflight, which we
// never allow. Requiring the JSON content type blocks forged form submissions.
function requireJson(req, res, next) {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected JSON.' });
  }
  next();
}

const app = express();
app.set('trust proxy', 1); // hosts like Render terminate HTTPS in front of us
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));
app.use(sessionMiddleware);
app.use('/api', requireJson);

// ---------- helpers ----------

function youtubeConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function newYoutubeAuth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/youtube/callback`,
  );
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Profile picture must be a PNG or JPEG.');
  return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
}

// ---------- status ----------

app.get('/api/status', (req, res) => {
  const { bluesky, youtube } = req.session;
  res.json({
    bluesky: { connected: Boolean(bluesky), handle: bluesky?.handle },
    youtube: {
      configured: youtubeConfigured(),
      connected: Boolean(youtube),
      channelTitle: youtube?.channelTitle,
    },
  });
});

// ---------- Bluesky ----------

app.post('/api/bluesky/connect', async (req, res) => {
  const { handle, appPassword } = req.body ?? {};
  if (!handle || !appPassword) return res.status(400).json({ error: 'Handle and app password are required.' });
  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle.trim().replace(/^@/, ''), password: appPassword });
    req.session.bluesky = { agent, handle: agent.session.handle };
    res.json({ ok: true, handle: agent.session.handle });
  } catch (err) {
    res.status(401).json({ error: `Bluesky login failed: ${err.message}` });
  }
});

app.post('/api/bluesky/disconnect', (req, res) => {
  req.session.bluesky = null;
  res.json({ ok: true });
});

// ---------- YouTube ----------

// The OAuth state lives in a short-lived cookie rather than server memory, so a
// sign-in still works if the server restarts (or a deploy swaps servers) while
// the person is on Google's page.
const OAUTH_COOKIE = 'ph_oauth_state';
const OAUTH_COOKIE_PATH = '/auth/youtube';

const backWithError = (res, message) => res.redirect('/?error=' + encodeURIComponent(message));

app.get('/auth/youtube', (req, res) => {
  if (!youtubeConfigured()) return backWithError(res, 'YouTube is not set up on this server yet.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, OAUTH_COOKIE, state, { path: OAUTH_COOKIE_PATH, maxAge: 10 * 60 });
  const url = newYoutubeAuth().generateAuthUrl({
    access_type: 'online',
    scope: ['https://www.googleapis.com/auth/youtube'],
    state,
    prompt: 'select_account',
  });
  res.redirect(url);
});

function sameState(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = readCookie(req, OAUTH_COOKIE);
  setCookie(req, res, OAUTH_COOKIE, '', { path: OAUTH_COOKIE_PATH, maxAge: 0 }); // one use only
  if (error === 'access_denied') return backWithError(res, 'YouTube: you cancelled the sign-in, so nothing was connected.');
  if (error) return backWithError(res, `YouTube: ${error}`);
  if (typeof state !== 'string' || !sameState(state, expected)) {
    return backWithError(res, 'YouTube sign-in expired or was started twice. Tap Connect YouTube to try again.');
  }
  try {
    const auth = newYoutubeAuth();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const yt = google.youtube({ version: 'v3', auth });
    const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
    if (!data.items?.length) throw new Error('This Google account has no YouTube channel.');
    req.session.youtube = { auth, channelTitle: data.items[0].snippet.title };
    res.redirect('/');
  } catch (err) {
    const message = /invalid_grant/i.test(err.message)
      ? 'That YouTube sign-in link was already used. Tap Connect YouTube to try again.'
      : `YouTube: ${err.message}`;
    backWithError(res, message);
  }
});

app.post('/api/youtube/disconnect', (req, res) => {
  req.session.youtube = null;
  res.json({ ok: true });
});

// ---------- read current profiles ----------

app.get('/api/profiles', async (req, res) => {
  const { bluesky, youtube } = req.session;
  const out = {};
  if (bluesky) {
    try {
      const { agent } = bluesky;
      const { data } = await agent.getProfile({ actor: agent.session.did });
      out.bluesky = { name: data.displayName || data.handle, bio: data.description ?? '', avatar: data.avatar ?? null };
    } catch (err) {
      out.bluesky = { error: err.message };
    }
  }
  if (youtube) {
    try {
      const yt = google.youtube({ version: 'v3', auth: youtube.auth });
      const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
      const s = data.items[0].snippet;
      out.youtube = { name: s.title, bio: s.description ?? '', avatar: s.thumbnails?.default?.url ?? null };
    } catch (err) {
      out.youtube = { error: err.message };
    }
  }
  res.json(out);
});

// ---------- apply changes everywhere ----------

async function applyBluesky({ agent }, { bio, avatar }) {
  let avatarBlob;
  if (avatar) {
    const { mime, bytes } = parseDataUrl(avatar);
    if (bytes.length > 1_000_000) throw new Error('Bluesky profile pictures must be under 1 MB.');
    const { data } = await agent.uploadBlob(bytes, { encoding: mime });
    avatarBlob = data.blob;
  }
  await agent.upsertProfile((existing = {}) => ({
    ...existing,
    ...(bio !== undefined && { description: bio }),
    ...(avatarBlob && { avatar: avatarBlob }),
  }));
  return 'Updated.';
}

async function applyYoutube({ auth }, { bio, avatar }) {
  const notes = [];
  if (bio !== undefined) {
    const yt = google.youtube({ version: 'v3', auth });
    // channels.update replaces the whole brandingSettings part, so read it first
    // and send everything back with only the description changed.
    const { data } = await yt.channels.list({ part: ['brandingSettings'], mine: true });
    const channel = data.items[0];
    channel.brandingSettings.channel = { ...channel.brandingSettings.channel, description: bio };
    await yt.channels.update({
      part: ['brandingSettings'],
      requestBody: { id: channel.id, brandingSettings: channel.brandingSettings },
    });
    notes.push('Description updated.');
  }
  if (avatar) notes.push("YouTube's API can't change profile pictures. Change it in YouTube Studio.");
  return notes.join(' ');
}

const appliers = { bluesky: applyBluesky, youtube: applyYoutube };

app.post('/api/apply', async (req, res) => {
  const { bio, avatar, targets = [] } = req.body ?? {};
  const results = {};
  await Promise.all(
    targets.map(async (target) => {
      if (!Object.hasOwn(appliers, target)) return (results[target] = { ok: false, message: 'Unknown platform.' });
      const connection = req.session[target];
      if (!connection) return (results[target] = { ok: false, message: 'Not connected.' });
      try {
        results[target] = { ok: true, message: await appliers[target](connection, { bio, avatar }) };
      } catch (err) {
        results[target] = { ok: false, message: err.message };
      }
    }),
  );
  res.json(results);
});

// ---------- post a video ----------
// Step 1: the browser sends the video once to /upload/video and it's saved as a
// temp file. Step 2: /api/post-video uploads that file to each chosen app.

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
const UPLOAD_TTL_MS = 60 * 60 * 1000; // temp videos are deleted after an hour
const BLUESKY_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

// Not under /api, because the body is the raw video rather than JSON. Requiring
// a video/* content type still blocks forged cross-site posts: browsers can't
// send that type from another site without a CORS preflight, which we never allow.
app.post('/upload/video', async (req, res) => {
  const type = String(req.headers['content-type'] ?? '');
  if (!/^video\/[\w.+-]+$/.test(type)) return res.status(415).json({ error: 'Please choose a video file.' });
  if (Number(req.headers['content-length']) > MAX_VIDEO_BYTES) {
    return res.status(413).json({ error: 'That video is too big. The limit is 1 GB.' });
  }

  const file = path.join(os.tmpdir(), `null-video-${crypto.randomBytes(16).toString('hex')}`);
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_VIDEO_BYTES) req.destroy(new Error('too big'));
  });
  try {
    await pipeline(req, fs.createWriteStream(file));
  } catch (err) {
    fs.rm(file, { force: true }, () => {});
    const tooBig = size > MAX_VIDEO_BYTES;
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That video is too big. The limit is 1 GB.' : `Upload failed: ${err.message}` });
  }

  dropUpload(req.session);
  const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'video')).slice(0, 200);
  req.session.upload = { id: crypto.randomBytes(16).toString('hex'), file, type, size, name, at: Date.now() };
  res.json({ ok: true, id: req.session.upload.id, size });
});

// Sets a custom thumbnail. YouTube only allows this on verified channels, and
// not on Shorts, so a failure here shouldn't count against the upload itself.
async function setYoutubeThumbnail(yt, videoId, thumbnail) {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(thumbnail);
  if (!match) return ' The thumbnail must be a PNG or JPEG, so it was skipped.';
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) return ' The thumbnail is over 2 MB, so it was skipped.';
  try {
    await yt.thumbnails.set({ videoId, media: { mimeType: match[1], body: Readable.from(bytes) } });
    return ' Thumbnail set.';
  } catch (err) {
    const why = /forbidden|permission|verif/i.test(err.message)
      ? 'custom thumbnails need a verified channel (youtube.com/verify)'
      : err.message;
    return ` The thumbnail wasn't set: ${why}.`;
  }
}

async function postYoutubeVideo({ auth }, video, { title, caption, privacy, thumbnail }) {
  const yt = google.youtube({ version: 'v3', auth });
  const { data } = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: (title || video.name || 'New video').slice(0, 100), description: caption ?? '' },
      status: { privacyStatus: ['private', 'unlisted', 'public'].includes(privacy) ? privacy : 'private', selfDeclaredMadeForKids: false },
    },
    media: { mimeType: video.type, body: fs.createReadStream(video.file) },
  });
  const thumbNote = thumbnail ? await setYoutubeThumbnail(yt, data.id, thumbnail) : '';
  const note = privacy !== 'private' ? " If it shows as private, that's Google's rule for apps that haven't been verified yet." : '';
  return { message: `Uploaded.${thumbNote}${note}`, url: `https://youtu.be/${data.id}` };
}

async function postBlueskyVideo({ agent }, video, { caption, aspectRatio }) {
  if (video.size > BLUESKY_MAX_VIDEO_BYTES) throw new Error('Bluesky videos must be under 100 MB.');
  const bytes = await fs.promises.readFile(video.file);
  const { data } = await agent.uploadBlob(bytes, { encoding: video.type });
  const ratio = aspectRatio?.width > 0 && aspectRatio?.height > 0
    ? { width: Math.round(aspectRatio.width), height: Math.round(aspectRatio.height) }
    : undefined;
  const { uri } = await agent.post({
    text: caption ?? '',
    embed: { $type: 'app.bsky.embed.video', video: data.blob, ...(ratio && { aspectRatio: ratio }) },
    createdAt: new Date().toISOString(),
  });
  const postId = uri.split('/').pop();
  return { message: 'Posted.', url: `https://bsky.app/profile/${agent.session.handle}/post/${postId}` };
}

const videoPosters = { youtube: postYoutubeVideo, bluesky: postBlueskyVideo };

app.post('/api/post-video', async (req, res) => {
  const { uploadId, targets = [], title, caption, privacy, aspectRatio, thumbnail } = req.body ?? {};
  const video = req.session.upload;
  if (!video || video.id !== uploadId) return res.status(400).json({ error: 'The video upload expired. Please post again.' });
  const results = {};
  // One at a time, so a big video isn't read into memory twice at once.
  for (const target of targets) {
    if (!Object.hasOwn(videoPosters, target)) {
      results[target] = { ok: false, message: 'Unknown platform.' };
      continue;
    }
    const connection = req.session[target];
    if (!connection) {
      results[target] = { ok: false, message: 'Not connected.' };
      continue;
    }
    try {
      results[target] = { ok: true, ...(await videoPosters[target](connection, video, { title, caption, privacy, aspectRatio, thumbnail })) };
    } catch (err) {
      const quota = /quota/i.test(err.message);
      results[target] = { ok: false, message: quota ? "YouTube's daily upload limit for this app was reached. Try again tomorrow." : err.message };
    }
  }
  res.json(results);
});

app.listen(PORT, HOST, () => {
  console.log(`null running at ${BASE_URL} (listening on ${HOST}:${PORT})`);
});
