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

## Put it online (Render, free)

1. Push this repo to GitHub.
2. Sign in at https://render.com with GitHub, then choose **New → Blueprint** and pick this repo. `render.yaml` sets everything up.
3. When it's live you get a URL like `https://profile-hub-xxxx.onrender.com`.
4. For YouTube: in Render, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` under **Environment**, and in Google Cloud add this redirect URI to your OAuth client:
   `https://<your-render-url>/auth/youtube/callback`

Notes about the free plan:
- The app sleeps after about 15 minutes with no visitors. The next visit takes up to a minute to wake it, and everyone has to reconnect.
- While your Google OAuth app is in *Testing* mode, only the Google accounts you add as test users can connect YouTube. Opening it to everyone requires Google's verification review.

## Security notes

- Every visitor gets their own private session (a random cookie). Nobody can see or change accounts someone else connected.
- Logins are kept in memory only, so restarting the server disconnects everything. Nothing is saved to disk.
- Run locally, the server only listens on `localhost`. Hosted, `HOST=0.0.0.0` lets the host reach it.
- `.env` holds your Google secret and is git-ignored. Don't commit it.
