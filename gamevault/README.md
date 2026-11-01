# GameVault

A Windows desktop app for managing your personal video game collection: physical and digital, PC and console. It centres on a box-art gallery.

- Dark theme, sidebar with **All Games**, **Favorites** and your systems
- Responsive box-art gallery with a card-size slider. Artwork is never stretched: you can fill and crop it with drag-to-position and zoom, or show the whole image over a blurred backdrop.
- Search, filters that work together (system → genre / custom category / play status / format / favorites) and four sort orders
- Multiple copies per game (for example PS5 physical plus PC digital on Steam), custom systems, genres kept separate from your own categories
- 1–5 star ratings (or unrated), autosaving personal notes, play status, favorites you can toggle from any card
- Launches installed games: Steam games through Steam, any other game through an `.exe` or a Windows shortcut, with optional arguments and working directory
- Optional Steam library import with a preview. Re-imports never create duplicates, and your notes, ratings and edits are kept when metadata is refreshed.
- One-file backup and restore (collection, artwork, notes, ratings, categories) and CSV export
- Works fully offline. All data stays on your PC.

---

## Installing on Windows

### Option A: download the installer that CI builds

Every push that changes `gamevault/` runs the **GameVault – Windows build** GitHub Actions workflow on a real Windows machine. It type-checks, runs the unit and end-to-end tests, then builds the installer.

1. Open the repository on GitHub, go to **Actions** and pick **GameVault – Windows build**.
2. Open the latest green run and download the **GameVault-Windows-Installer** artifact (a zip).
3. Unzip it and run `GameVault-Setup-1.0.0.exe`.

The installer isn't code-signed, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. The installer asks where to install. It also creates Start-menu and desktop shortcuts and adds a normal uninstaller under *Settings → Apps*.

### Option B: build it yourself

Requirements: **Windows 10/11 x64** and **Node.js 20 LTS** (from <https://nodejs.org>). No Visual Studio is needed, because the SQLite module ships prebuilt binaries for Electron.

```powershell
git clone <this repository>
cd <repo>\gamevault
npm ci                 # installs everything and fetches the Windows SQLite binary for Electron
npm run dist           # builds the app and the installer
```

The installer is written to `gamevault\release\1.0.0\GameVault-Setup-1.0.0.exe`. If you only want an unpacked folder you can run directly (`release\1.0.0\win-unpacked\GameVault.exe`), use `npm run dist:dir`.

> Build the installer **on Windows**. If you cross-build from Linux or macOS, the package contains that OS's SQLite binary and the app won't start on Windows.

### Run in development mode

```powershell
npm ci
npm run dev        # hot-reloading app window
```

---

## Using GameVault

| Task | How |
| --- | --- |
| Add a game | **Add Game** (sidebar) or `Ctrl+N` |
| Edit any metadata | Open a game, then **Edit** |
| Box art | Upload it or drag a file onto the frame in the editor. Drag the image to reposition it, use **Zoom**, or switch to **Show whole**. |
| More images | **Upload images…** in the editor. Any of them can become the box art. |
| Several systems / formats | **Add copy** in the editor: one row per copy (system, physical or digital, store) |
| Custom categories | Create them on a game's page, from the **Category** filter, or under **Settings & Data**. You can rename or remove them there. |
| Custom systems | **Settings & Data → Game systems** |
| Search | `Ctrl+F` or `/` |
| Launch a game | Open it, go to **Copies & launching**, then **Set up launch…**. **Play** appears once a working launch method exists. |
| Remove the sample games | **Remove samples** in the banner, or in Settings |

### Owned vs installed

Every copy is an **owned** collection entry. A copy only counts as **installed** and gets a **Play** button when it has a launch method that GameVault can confirm works on this PC:

- **Steam** copies launch through the Steam client (`steam://rungameid/<appid>`). GameVault reads Steam's local `appmanifest_*.acf` files to check that the game really is installed. Importing from Steam does **not** mark games as installed. Only games that Steam reports as installed on this PC get Steam launching turned on automatically.
- **Program / shortcut** copies run an `.exe`, `.lnk`, `.url`, `.bat` or `.cmd` file, with optional arguments and an optional working directory.
- If the file has moved, or Steam or the game isn't installed, the detail page explains the problem and hides **Play**. You can then **Edit launch…** or **Remove** the launch method. The game stays in your collection either way.
- Console and physical games stay plain collection entries unless you set up a local launch method yourself, such as an emulator shortcut.

---

## Steam integration (optional)

GameVault works fully without Steam. It uses only Valve's supported, documented mechanisms, and **it never asks for or stores your Steam password.**

| What | Mechanism | Requirement |
| --- | --- | --- |
| Your owned library | Steam Web API `IPlayerService/GetOwnedGames` | Your own **Steam Web API key** and your **SteamID64** or profile URL |
| Custom profile URLs | Steam Web API `ISteamUser/ResolveVanityURL` | Same key |
| Description, genres, developer, publisher, release date | Steam Store `appdetails` endpoint | None, but it is rate-limited, so GameVault spaces its requests about 1.6 s apart |
| Box art | Steam CDN portrait capsule (`library_600x900`), falling back to the header image | None. Images are downloaded once and cached in the data folder. |
| Installed games | Local `steamapps/libraryfolders.vdf` and `appmanifest_<appid>.acf` files | Steam installed on this PC. **No key needed.** |
| Launching | `steam://rungameid/<appid>` | Steam client installed |

**Setup:**

1. Get a key at <https://steamcommunity.com/dev/apikey>. Any domain name works, for example `localhost`. Valve only issues keys to accounts that have Steam Guard enabled and have made a purchase.
2. In Steam go to **Profile → Edit Profile → Privacy Settings** and set **Game details** to **Public**. If it's private, Steam returns an empty library.
3. In GameVault, open **Settings & Data → Steam**, paste the key and your SteamID64 or profile URL, then click **Save**.
4. Click **Import Steam library…**. You'll see a preview where you can tick the games you want, then import them.

Without a key, you can still use **Import installed Steam games…**, which reads the games installed on this PC.

**What a re-import or refresh changes:**

- Games are matched by **Steam App ID**, so importing again updates existing entries instead of duplicating them.
- These are **never touched** by a refresh: notes, ratings, favorites, play status, categories, other copies and launch settings.
- Any metadata field you edit by hand (title, description, developer, publisher, release date, genres, box art) is **locked**, and later refreshes keep your version. The editor marks these fields with *"Kept on refresh · unlock"*.
- If Steam has no store data for a game (delisted titles, tools and so on), it's still imported so you can fill in details and upload art yourself.
- The API key is stored only on this PC, encrypted with your Windows account (DPAPI). It's kept out of the database and out of backups.

---

## Your data

| | Location |
| --- | --- |
| Collection database (SQLite) | `%APPDATA%\GameVault\data\gamevault.db` |
| Box art and images (copied in when you upload, or cached from Steam) | `%APPDATA%\GameVault\data\images\` |
| Automatic safety backups made before each restore | `%APPDATA%\GameVault\data\backups\` |

**Settings & Data → Open data folder** opens it. Uploaded images are **copied** into this folder, so moving or deleting the originals never breaks a cover. Uninstalling keeps your data. Delete the folder yourself if you want it gone.

- **Backup** writes a single `.zip` containing the database and every image. That covers games, copies, ratings, notes, favorites, statuses, systems, genres, categories and artwork.
- **Restore** checks the zip and verifies its database integrity. It saves a safety backup of your current data, then swaps the restored data in. If anything fails, your current data is left unchanged.
- **Export CSV** writes UTF-8 with a BOM, so Excel opens it correctly. Columns: title, systems, formats, stores, genres, categories, status, rating, favorite, release date, developer, publisher, date added, Steam App ID and notes.

The database runs SQLite in WAL mode with `synchronous=FULL`. Notes autosave as you type. Any unsaved keystrokes are also written when you leave the notes box, switch games or close the window.

---

## Technology choice

**Electron + React + TypeScript, with SQLite (better-sqlite3), packaged by electron-builder as an NSIS installer.**

- A box-art gallery with smooth hover effects, a blurred hero backdrop and a responsive grid is simplest to make look polished with web UI. Electron renders it identically on every Windows 10/11 machine and needs no runtime install.
- The Node main process does the Windows-specific work that a browser can't: spawning executables, opening `.lnk` and `.url` shortcuts, reading the Steam registry key and manifests, and DPAPI encryption through `safeStorage`.
- SQLite is the standard embedded database. It handles transactions, survives crashes, and backs up and restores as a single file. better-sqlite3 is synchronous, fast and ships prebuilt Windows binaries.
- electron-builder produces a standard per-user installer with shortcuts and an uninstaller.

Alternatives considered: WinUI 3 or WPF would be Windows-native but much slower to polish. Tauri would give smaller installers, but its Rust toolchain and WebView2 variability add build risk for little user benefit here.

---

## Development

```text
gamevault/
├─ src/main/        Electron main process
│  ├─ db.ts         schema, migrations, queries, metadata-merge rules
│  ├─ images.ts     image import/download/cache (gvimg:// protocol)
│  ├─ launcher.ts   launch checks + launching (Steam / exe / shortcut)
│  ├─ steam.ts      Steam Web API, Store metadata, CDN art, local install detection
│  ├─ backup.ts     zip backup/restore, CSV export
│  ├─ samples.ts    removable sample games for the first-run preview
│  └─ index.ts      window, IPC, Steam import job, lifecycle
├─ src/preload/     safe IPC bridge (window.api)
├─ src/renderer/    React UI (gallery, filters, detail view, editor, settings, Steam import)
├─ src/shared/      types + filter/sort logic shared by both sides
└─ tests/
   ├─ unit/         Vitest: combined filters, sorting, date parsing
   └─ e2e/run.cjs   Playwright drives the real app against a local mock Steam server
```

```powershell
npm run typecheck
npm test            # unit tests
npm run build
npm run test:e2e    # end-to-end (opens app windows)
```

The end-to-end suite runs these checks against the real app, restarting it twice:

1. Sample games appear on first run and can be removed in one click.
2. A game is added manually, then given a rating, status, favorite, category and notes.
3. Data persists across restarts, including notes typed right before the window closed.
4. System → genre → status, format and favorites filters combine correctly, along with search.
5. A Steam preview import with selected games caches artwork locally and marks only installed games as launchable.
6. A repeat import creates **no duplicates**, refreshes metadata, and keeps notes, ratings, favorites and hand-edited fields.
7. A local program launches with arguments. A **missing launch file** is explained, Play is hidden, and the path can be removed.
8. Backup, delete and restore round-trip correctly, including the safety backup. CSV export works.

If you switch between running tests in plain Node and running the app, rebuild the native module for Electron with `npm run rebuild:native`.
