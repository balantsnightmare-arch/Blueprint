import 'dotenv/config';
import crypto from 'node:crypto';
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
const sessions = new Map(); // sid -> { bluesky, youtube, youtubeOAuthState, lastSeen }

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sessionMiddleware(req, res, next) {
  let sid = readCookie(req, SESSION_COOKIE);
  let session = sid && sessions.get(sid);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      // Evict the least recently used session to keep memory bounded.
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      sessions.delete(oldest[0]);
    }
    sid = crypto.randomBytes(32).toString('base64url');
    session = { bluesky: null, youtube: null, youtubeOAuthState: null, lastSeen: Date.now() };
    sessions.set(sid, session);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_IDLE_MS / 1000}${secure}`);
  }
  session.lastSeen = Date.now();
  req.session = session;
  next();
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [sid, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(sid);
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

app.get('/auth/youtube', (req, res) => {
  if (!youtubeConfigured()) return res.status(400).send('YouTube is not set up on this server yet.');
  req.session.youtubeOAuthState = crypto.randomBytes(16).toString('hex');
  const url = newYoutubeAuth().generateAuthUrl({
    access_type: 'online',
    scope: ['https://www.googleapis.com/auth/youtube'],
    state: req.session.youtubeOAuthState,
    prompt: 'select_account',
  });
  res.redirect(url);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(`YouTube: ${error}`));
  if (!state || state !== req.session.youtubeOAuthState) return res.status(400).send('Invalid OAuth state. Try connecting again.');
  req.session.youtubeOAuthState = null;
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
    res.redirect('/?error=' + encodeURIComponent(`YouTube: ${err.message}`));
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

app.listen(PORT, HOST, () => {
  console.log(`Profile Hub running at ${BASE_URL} (listening on ${HOST}:${PORT})`);
});
