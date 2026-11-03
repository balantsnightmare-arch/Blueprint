# Profile Hub

Change your profile picture and bio once, and update them on every linked platform.

## What works

| Platform | Bio | Profile picture |
|---|---|---|
| Bluesky | ✅ automatic | ✅ automatic |
| YouTube | ✅ automatic (channel description) | ❌ API doesn't allow it; change it in YouTube Studio |
| Discord, Instagram | Copy and paste | Download and upload |

Discord and Instagram don't offer an API for editing profiles, and automating them breaks their rules, so they stay manual on purpose.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000.

## Connect Bluesky

1. In Bluesky go to **Settings → Privacy and security → App passwords** and create one.
2. Enter your handle and that app password in Profile Hub. Don't use your real password.

## Connect YouTube

1. Go to https://console.cloud.google.com, create a project, and enable **YouTube Data API v3**.
2. Under **APIs & Services → OAuth consent screen**, set it up as *External* and add your Google account as a test user.
3. Under **Credentials**, create an **OAuth client ID** of type *Web application* and add this redirect URI:
   `http://localhost:3000/auth/youtube/callback`
4. Put the client ID and secret in `.env`, then restart the server.

## Security notes

- Logins are kept in memory only, so restarting the server disconnects everything. Nothing is saved to disk.
- The server only listens on `localhost`, so other devices on your network can't reach it.
- `.env` holds your Google secret and is git-ignored. Don't commit it.
