# Kharcha Khata Offline

An offline-first personal expense tracker based on the existing Kharcha Khata interface. Expense records are stored in the browser's IndexedDB database on the device that uses the app. There is no account login, backend API, cloud database, or automatic synchronization in this version.

## Features

- Dashboard, ledger, reports, categories, payment methods, date filters, and PDF report export.
- Local IndexedDB storage. Expense entries remain available on the same browser/device across restarts and can be recorded without an internet connection after the app shell has been cached/installed.
- JSON backup export and restore. **Restoring a backup replaces the current local expense entries.**
- No online login or required paid service.
- Installable PWA when served over HTTPS (or localhost during development).

## Requirements

- Node.js 20.19+ or 22.12+ recommended.
- npm.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The service worker is enabled in production builds, not in the development server.

## Build and preview

```bash
npm run build
npm run preview
```

Deploy the contents of `dist/` to a static HTTPS host. A static host such as Cloudflare Pages or Netlify can host the frontend without an application server. For a project-site URL under a subpath, update the Vite `base`, PWA manifest paths, service-worker registration, and scope to match that subpath before deploying.

## Install on Android

1. Deploy the production build to an HTTPS URL.
2. Open that URL in Chrome on Android while online.
3. Wait for the page to finish loading, then use Chrome's menu and choose **Install app** or **Add to Home screen**.
4. Open the installed app once while online so the app shell is cached. Then test airplane mode.

## Data and privacy

- Records are stored locally in this browser profile/device. They are not synced between devices.
- Clearing browser/site data, uninstalling, or losing the device can remove records. Export JSON backups regularly and store them somewhere safe.
- A restored JSON backup replaces the current entries; export a backup before restoring if you need to preserve the current data.
- Browser storage is not a substitute for a password-protected encrypted vault. This version has no app PIN.
- The PWA can open offline after its shell has been cached. The first visit/install requires internet access to load the app.

## Open source

Released under the MIT License. Review the repository before publishing to ensure it contains no private data, secrets, or personal backups.
