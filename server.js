import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { AtpAgent } from '@atproto/api';
import { google } from 'googleapis';

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Connections live in memory only. Nothing is written to disk, so restarting
// the server logs you out of everything. That's deliberate for a first version:
// no stored tokens means nothing to steal.
const connections = {
  bluesky: null, // { agent, handle }
  youtube: null, // { auth, channelTitle }
};
let youtubeOAuthState = null;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

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
  res.json({
    bluesky: { connected: Boolean(connections.bluesky), handle: connections.bluesky?.handle },
    youtube: {
      configured: youtubeConfigured(),
      connected: Boolean(connections.youtube),
      channelTitle: connections.youtube?.channelTitle,
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
    connections.bluesky = { agent, handle: agent.session.handle };
    res.json({ ok: true, handle: agent.session.handle });
  } catch (err) {
    res.status(401).json({ error: `Bluesky login failed: ${err.message}` });
  }
});

app.post('/api/bluesky/disconnect', (req, res) => {
  connections.bluesky = null;
  res.json({ ok: true });
});

// ---------- YouTube ----------

app.get('/auth/youtube', (req, res) => {
  if (!youtubeConfigured()) return res.status(400).send('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first.');
  youtubeOAuthState = crypto.randomBytes(16).toString('hex');
  const url = newYoutubeAuth().generateAuthUrl({
    access_type: 'online',
    scope: ['https://www.googleapis.com/auth/youtube'],
    state: youtubeOAuthState,
    prompt: 'select_account',
  });
  res.redirect(url);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(`YouTube: ${error}`));
  if (!state || state !== youtubeOAuthState) return res.status(400).send('Invalid OAuth state. Try connecting again.');
  youtubeOAuthState = null;
  try {
    const auth = newYoutubeAuth();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const yt = google.youtube({ version: 'v3', auth });
    const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
    if (!data.items?.length) throw new Error('This Google account has no YouTube channel.');
    connections.youtube = { auth, channelTitle: data.items[0].snippet.title };
    res.redirect('/');
  } catch (err) {
    res.redirect('/?error=' + encodeURIComponent(`YouTube: ${err.message}`));
  }
});

app.post('/api/youtube/disconnect', (req, res) => {
  connections.youtube = null;
  res.json({ ok: true });
});

// ---------- read current profiles ----------

app.get('/api/profiles', async (req, res) => {
  const out = {};
  if (connections.bluesky) {
    try {
      const { agent } = connections.bluesky;
      const { data } = await agent.getProfile({ actor: agent.session.did });
      out.bluesky = { name: data.displayName || data.handle, bio: data.description ?? '', avatar: data.avatar ?? null };
    } catch (err) {
      out.bluesky = { error: err.message };
    }
  }
  if (connections.youtube) {
    try {
      const yt = google.youtube({ version: 'v3', auth: connections.youtube.auth });
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

async function applyBluesky({ bio, avatar }) {
  const { agent } = connections.bluesky;
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

async function applyYoutube({ bio, avatar }) {
  const notes = [];
  if (bio !== undefined) {
    const yt = google.youtube({ version: 'v3', auth: connections.youtube.auth });
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
      if (!appliers[target]) return (results[target] = { ok: false, message: 'Unknown platform.' });
      if (!connections[target]) return (results[target] = { ok: false, message: 'Not connected.' });
      try {
        results[target] = { ok: true, message: await appliers[target]({ bio, avatar }) };
      } catch (err) {
        results[target] = { ok: false, message: err.message };
      }
    }),
  );
  res.json(results);
});

// Bind to localhost only so nobody else on your network can reach the panel.
app.listen(PORT, 'localhost', () => {
  console.log(`Profile Hub running at ${BASE_URL}`);
});
