---
title: Supabase login gate + Electron UX polish
---
# Supabase Login Gate + Electron UX Polish

## What & Why
Add a login screen to the Electron desktop app so that only testers with a
valid Supabase account can use it. A copied installer is useless without
credentials. Also add an update-ready notification banner so non-technical
users know when to restart for an update — no manual checking required.
The web/Replit dev version is completely unaffected.

Supabase credentials to store as env secrets:
- VITE_SUPABASE_URL = https://fodnipoqwervrgodouim.supabase.co
- VITE_SUPABASE_ANON_KEY = sb_publishable_z2I23CmsWY5NK1QSuH-qVw_sU8lju_b

## Done looks like
- Opening the installed Electron app shows a clean login screen (email +
  password, DJ-themed, dark background) before anything else is visible
- Entering valid credentials → session stored → main app loads
- Wrong credentials or a banned/disabled account → clear error message
- On every subsequent launch → session re-validated silently in the background;
  a loading spinner is shown instead of a blank flash
- If the user's account is banned in the Supabase dashboard, their app shows
  "Account disabled. Contact support." on next launch
- A "Sign out" option is visible in the app header only when running inside
  the installed Electron app (not visible in the web/Replit version)
- When a new version has downloaded in the background, a dismissable banner
  appears at the top: "A new version is ready — click Restart to install."
  Clicking it restarts the app and installs the update automatically
- The Replit web version works exactly as before — no login, no update banner
- The installer build script automatically includes the Supabase env vars so
  the built app has them baked in without any manual steps

## Out of scope
- Device fingerprinting (can be added later)
- An in-app admin panel (Supabase dashboard handles user management)
- Periodic background re-validation while the app is running (launch check
  is enough for now)
- Password reset UI inside the app (Supabase handles this via email)
- Email verification flow

## Tasks
1. **Install Supabase JS client and store credentials as env secrets** —
   Install `@supabase/supabase-js`. Store `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` as Replit environment secrets. Update
   `script/build.electron.ts` to forward these two env vars into the Vite
   build so they are baked into the frontend bundle automatically.

2. **Create a Supabase client helper** — A small singleton file that
   initialises the Supabase client from the Vite env vars. Returns `null`
   when the vars are absent so nothing breaks in the Replit dev environment.

3. **Build the Login page** — A full-screen login form (email + password +
   Sign In button). Shows a spinner while validating. Shows inline error
   messages for wrong credentials, unknown accounts, and disabled accounts.
   Styled to match the existing dark DJ theme.

4. **Add an AuthGate component to App.tsx** — On mount, detect if running
   inside Electron by checking `window.electronAPI`. If yes: show a loading
   spinner while re-validating the existing session with Supabase. If session
   is valid → show the main app. If not → show the Login page. On login
   success → store session → switch to main app. Add a "Sign out" button to
   the header visible only in Electron mode.

5. **Add update-ready notification banner** — In the AuthGate or App root,
   listen to `window.electronAPI.onUpdateDownloaded`. When it fires, show a
   non-blocking sticky banner at the top of the screen: "A new version is
   ready — Restart to install." with a Restart button that calls
   `window.electronAPI.installUpdate()`. The banner can be dismissed.

## Relevant files
- `client/src/App.tsx`
- `electron/preload.js`
- `script/build.electron.ts`