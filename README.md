# Sortbox Planner

A planner that works without an internet connection and installs like an app. Write a note and Sortbox puts it under Uni, Work, Private or Projects and reads the due date from the text. It also has a week calendar with repeating events. It runs fully in the browser: no server, no account, no Claude needed.

## Put it online (GitHub Pages, free)

1. Create a new repository on GitHub, for example `sortbox`. A private repo only works with Pages on a paid plan, so use a **public** one. The repo holds only the app's code. Your notes never go into it.
2. Upload everything in this folder to the root of the repo: `index.html`, `styles.css`, the `.js` files, `manifest.webmanifest`, `sw.js` and the `icons/` folder.
   Using git instead:
   ```bash
   git init && git add . && git commit -m "Sortbox"
   git branch -M main
   git remote add origin https://github.com/<you>/sortbox.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages**. Under "Build and deployment", set **Deploy from a branch**, choose `main` and `/ (root)`, then click **Save**.
4. After about a minute the app is live at `https://<you>.github.io/sortbox/`.

Netlify or Cloudflare Pages work too: drag this folder onto their deploy page. The app needs HTTPS to install and to work offline, and all of these hosts give you that.

## Install it

- **Laptop (Chrome or Edge):** open the URL and click **Install app** in Sortbox's header, or the install icon in the address bar. Sortbox then opens in its own window from your app list or dock.
- **iPhone:** open the URL in Safari, tap **Share → Add to Home Screen**.
- **Android:** open the URL in Chrome, tap **⋮ → Install app** (or **Add to Home screen**).

After the first visit it opens without a connection.

## Your data

- Notes are saved in that browser on that device. They aren't uploaded anywhere.
- **Moving notes to another device:** open **Settings → Export backup**, send the file to the other device, then use **Settings → Import backup…** there. Importing adds to what's already on that device and never deletes anything.
- **Bringing over your list from the Claude version:** import `sortbox-backup-2026-10-06.json`, which is delivered alongside this folder and is not part of it.
- If you delete the browser's site data for the app's URL, its notes go with it. Export a backup now and then.
- Each device keeps its own list, so a change on your phone doesn't appear on your laptop. Live sync would need a small backend such as Supabase or Firebase. All saving goes through `putDoc`, `patchDoc` and `deleteDoc` in `app.js`, so those three functions are the place to add it.

## Google Calendar

Each dated task or event has a calendar button that opens Google Calendar with the event filled in, repeats included. **Settings → Export (.ics)** exports everything at once. Import that file in Google Calendar under Settings → Import & export.

## Changing the app

- **Keywords and categories:** edit them in the app under **Settings**. The defaults are in `cats.js`.
- **Date and time parsing:** `parser.js`.
- **After you change any file,** bump `VERSION` in `sw.js` (for example `sortbox-v2`). Otherwise installed copies keep serving the old files. Updates appear the next time the app is opened.
- **Testing locally:** run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`. Opening `index.html` directly as a file works, but without offline support.
