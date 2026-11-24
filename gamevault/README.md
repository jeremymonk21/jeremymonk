# GameVault

A Windows desktop app for managing your personal video game collection: physical and digital, PC and console. It centres on a box-art gallery.

- Dark theme, sidebar with **All Games**, **Playing**, **Backlog**, **Favorites**, **Wishlist**, your systems and your own **collections**
- Responsive box-art gallery with a card-size slider. Artwork is never stretched: you can fill and crop it with drag-to-position and zoom, or show the whole image over a blurred backdrop.
- Search, filters that work together (system → genre / custom category / play status / format / favorites) and four sort orders
- Multiple copies per game (for example PS5 physical plus PC digital on Steam), custom systems, genres kept separate from your own categories
- 1–5 star ratings (or unrated), autosaving personal notes, play status, favorites you can toggle from any card
- Launches installed games: Steam games through Steam, any other game through an `.exe` or a Windows shortcut, with optional arguments and working directory
- Optional Steam library import with a preview. Re-imports never create duplicates, and your notes, ratings and edits are kept when metadata is refreshed.
- One-file backup and restore (collection, artwork, notes, ratings, categories) and CSV export
- Play time tracking for everything launched from GameVault, a **Stats** page and **Surprise me**
- Optional online details from **IGDB** and artwork from **SteamGridDB**, for any system including Nintendo and retro
- **Emulator** support: point GameVault at your game folders, it finds the games, and **Play** opens them in the right emulator
- **Big Picture** mode: full-screen and controller-driven (Xbox controller), with background music and video clips
- Works fully offline. All data stays on your PC.

---

## Installing on Windows

### Option A: download the installer that CI builds

Every push that changes `gamevault/` runs the **GameVault – Windows build** GitHub Actions workflow on a real Windows machine. It type-checks, runs the unit and end-to-end tests, then builds the installer.

1. Open the repository on GitHub, go to **Actions** and pick **GameVault – Windows build**.
2. Open the latest green run and download the **GameVault-Windows-Installer** artifact (a zip).
3. Unzip it and run `GameVault-Setup-1.1.0.exe`.

The installer isn't code-signed, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. The installer asks where to install. It also creates Start-menu and desktop shortcuts and adds a normal uninstaller under *Settings → Apps*.

### Option B: build it yourself

Requirements: **Windows 10/11 x64** and **Node.js 20 LTS** (from <https://nodejs.org>). No Visual Studio is needed, because the SQLite module ships prebuilt binaries for Electron.

```powershell
git clone <this repository>
cd <repo>\gamevault
npm ci                 # installs everything and fetches the Windows SQLite binary for Electron
npm run dist           # builds the app and the installer
```

The installer is written to `gamevault\release\1.1.0\GameVault-Setup-1.1.0.exe`. If you only want an unpacked folder you can run directly (`release\1.1.0\win-unpacked\GameVault.exe`), use `npm run dist:dir`.

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
| Fill in details automatically | Type the title in **Add Game**. GameVault searches the Steam Store catalogue and lists matches. Click the right one to fill in the description, developer, publisher, release date, genres and box art. Works for games you own anywhere (disc, other stores, downloads), with no Steam account or key needed. |
| Edit any metadata | Open a game, then **Edit** |
| Box art | Upload it or drag a file onto the frame in the editor. Drag the image to reposition it, use **Zoom**, or switch to **Show whole**. |
| More images | **Upload images…** in the editor. Any of them can become the box art. |
| Several systems / formats | **Add copy** in the editor: one row per copy (system, physical or digital, store) |
| Custom categories | Create them on a game's page, from the **Category** filter, or under **Settings & Data**. You can rename or remove them there. |
| Custom systems | **Settings & Data → Game systems** |
| Search | `Ctrl+F` or `/` |
| Launch a game | Open it, go to **Copies & launching**, then **Set up launch…**. **Play** appears once a working launch method exists. |
| Remove the sample games | **Remove samples** in the banner, or in Settings |

### Organizing: Playing, Backlog, Collections, Wishlist

- **Playing** lists exactly the games you set to *Playing*. Launching a *Not Started* game from GameVault sets it to Playing for you.
- **Backlog** holds only games you mark with **+ Backlog** (on the game page, in the editor, or with Select). Setting a game to Playing takes it off the backlog.
- **Collections** are groups you make yourself (e.g. *Digimon*), shown in the sidebar. Click **+** next to Collections to create one. Add games with **Add games…** on the collection page, the **Collections** box on a game's page, or **Select** several cards and choose **Add to collection…**. A game can be in as many collections as you like, and removing it from a collection never deletes the game.
- **Wishlist** keeps games you want but don't own yet, with box art and a note. They don't count towards your collection, filters or stats. When you get one, click **I got it!**, pick the system and format, and it moves into your collection with its note.
- **Select** (top right) turns on multi-select: tick cards, then add them to a collection, mark them Backlog or Playing, or favorite them in one go.
- **Surprise me** picks a random game from your backlog, a system, a collection or everything.

### Play time and stats

GameVault times every session it launches:

- **Programs and emulators** are timed from start to exit.
- **Windows shortcuts (`.lnk`)** are timed by starting the program the shortcut points to.
- **Steam** starts its games itself, so GameVault watches the *RunningAppID* value Steam keeps in the Windows registry while a game runs.
- Hours from your **Steam import** are included in the total.
- `.url` shortcuts (for example some Epic Games links) can be launched but can't be timed.
- Sessions shorter than 15 seconds are ignored.

Each game page shows the total, the number of sessions, when you last played and a 14-day chart. **Stats** (bottom of the sidebar) shows games owned, completed, hours played per month, the most-played games and games per system.

### Owned vs installed

Every copy is an **owned** collection entry. A copy only counts as **installed** and gets a **Play** button when it has a launch method that GameVault can confirm works on this PC:

- **Steam** copies launch through the Steam client (`steam://rungameid/<appid>`). GameVault reads Steam's local `appmanifest_*.acf` files to check that the game really is installed. Importing from Steam does **not** mark games as installed. Only games that Steam reports as installed on this PC get Steam launching turned on automatically.
- **Program / shortcut** copies run an `.exe`, `.lnk`, `.url`, `.bat` or `.cmd` file, with optional arguments and an optional working directory.
- If the file has moved, or Steam or the game isn't installed, the detail page explains the problem and hides **Play**. You can then **Edit launch…** or **Remove** the launch method. The game stays in your collection either way.
- **Emulator** copies open a game file in one of your emulator setups. See *Emulation* below.
- Console and physical games stay plain collection entries unless you set up a local launch method yourself, such as an emulator.

---

## Online details and artwork (optional)

**Add Game** searches as you type the title. Results from **IGDB** (every platform) and the **Steam Store** appear together, each labeled with its source. Click the right one to fill in:

- The description, developer, publisher, release date and genres
- Box art
- Up to three screenshots
- Trailers, if any
- The system, set from the platform it came out on

If SteamGridDB is set up, a strip of community box art appears underneath. GameVault also picks a wide background and a logo for Big Picture; you can change them with **Artwork…**. Everything stays editable. Fields you change by hand, and covers you pick yourself, are kept when you later use **Refresh details**.

Set the services up in **Settings & Data → Online sources**:

| Service | What it gives | How to get access |
| --- | --- | --- |
| **IGDB** | Details and covers for every system, including Nintendo, PS1–PS5 and retro | Sign in at dev.twitch.tv/console, then **Register Your Application** (name `GameVault`, OAuth redirect `http://localhost`, category *Application Integration*, client type *Confidential*). Copy the **Client ID**, click **New Secret** and copy the secret. Paste both into GameVault and click **Save & test**. |
| **SteamGridDB** | Box art, Big Picture backgrounds and logos | On steamgriddb.com go to Profile → Preferences → **API**, then **Generate API Key**. Paste the key into GameVault and click **Save & test**. |

The keys are stored only on this PC, encrypted with your Windows account, and are never included in backups. IGDB is free for non-commercial use and allows 4 requests per second, which GameVault respects.

## Emulation

Use game files and BIOS files that you have dumped from discs, cartridges and consoles you own.

1. Install your emulators, for example DuckStation (PS1), PCSX2 (PS2), RPCS3 (PS3), PPSSPP (PSP), Dolphin (GameCube/Wii), Cemu (Wii U), or RetroArch with cores for older systems.
2. Keep one folder per system, for example `D:\Games\PS1`, `D:\Games\PS2` and `D:\Games\GameCube`.
3. In **Settings & Data → Emulators**, click **Add emulator** and pick one from the list. The arguments and file types are filled in for you; they stay editable because emulator options can change between versions. Then choose the emulator's `.exe`, the game folder and, for PS1 and PS2, the **BIOS folder**. GameVault warns you if the BIOS folder is empty.
4. Click **Scan**. GameVault lists the new games it found:
   - Titles are guessed from the file names, and you can fix any before adding.
   - Multi-disc games with an `.m3u` playlist show up as a single game, and the `.bin` files behind a `.cue` sheet are skipped.
   - Choose **Physical** or **Digital**. With IGDB set up, it also looks up each game's details and art for that system.
5. **Play** on a game's page, or **A** in Big Picture, opens the game in the emulator. Play time is tracked. If a game file is moved or deleted, the game page says so and hides Play.

Run **Scan** again whenever you add games to a folder. Files already in your collection are skipped.

Nintendo Switch emulation is legally contested, so GameVault doesn't include a preset for it. Switch games stay normal collection entries. PS4 emulation is still early, and many games don't run.

## Big Picture

**Big Picture** (bottom of the sidebar, or **F11**) is a full-screen view built for a TV or a big monitor such as a 34" ultrawide, driven by an Xbox controller.

| Controller | Keyboard | Home | Game page |
| --- | --- | --- | --- |
| D-pad / left stick | Arrow keys | Move between games and shelves | Move between actions |
| **A** | Enter | Play | Select the highlighted action |
| **B** | Esc | Menu | Back |
| **X** | X | Game page (details & video) | Add to / remove from Backlog |
| **Y** | Y | Favorite | Favorite |
| **LB / RB** | Q / E | Previous / next shelf | Previous / next game |
| **Menu** | Tab | Menu (music on/off, Exit Big Picture) | Menu |

- **Shelves**: Playing, Backlog, Favorites, All Games, then each system and each of your collections.
- **Music**: choose a folder of your own music in **Settings → Big Picture**. MP3, OGG, FLAC, WAV and M4A are supported. It plays shuffled, lowers while a clip plays, and pauses while a game is running.
- **Video clips**: on a game's page, your own clip plays first. Add an MP4 or WebM of up to 200 MB in the game's editor under *Big Picture*. After that come the game's IGDB trailers (YouTube, so only when online; can be switched off), then screenshots.
- **Background and logo** come from SteamGridDB. Without them the box art is used.
- **Start GameVault in Big Picture** is an option under **Settings → Big Picture**.

## Steam integration (optional)

GameVault works fully without Steam. It uses only Valve's supported, documented mechanisms, and **it never asks for or stores your Steam password.**

| What | Mechanism | Requirement |
| --- | --- | --- |
| Your owned library | Steam Web API `IPlayerService/GetOwnedGames` | Your own **Steam Web API key** and your **SteamID64** or profile URL |
| Custom profile URLs | Steam Web API `ISteamUser/ResolveVanityURL` | Same key |
| Description, genres, developer, publisher, release date | Steam Store `appdetails` endpoint | None, but it is rate-limited, so GameVault spaces its requests about 1.6 s apart |
| Box art | Steam CDN portrait capsule (`library_600x900`), falling back to the header image | None. Images are downloaded once and cached in the data folder. |
| Details lookup when adding any game | Steam Store `storesearch` + `appdetails` (public catalogue) | None. Your copy stays recorded as you entered it, not as a Steam purchase. Console-only games usually aren't listed, so enter those by hand. |
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
- A game whose details came from the lookup is linked by Steam App ID, so a later Steam import matches it instead of duplicating it, and **Refresh from Steam** works for it too.
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

- **Backup** writes a single `.zip` containing the database and every image and video clip. That covers games, copies, ratings, notes, favorites, statuses, backlog, wishlist, collections, play time, emulator setups, systems, genres, categories, artwork and Big Picture settings. API keys are not included.
- **Restore** checks the zip and verifies its database integrity. It saves a safety backup of your current data, then swaps the restored data in. If anything fails, your current data is left unchanged.
- **Export CSV** writes UTF-8 with a BOM, so Excel opens it correctly. Columns: title, systems, formats, stores, genres, categories, status, rating, favorite, release date, developer, publisher, date added, Steam App ID, notes, collections, backlog, wishlist, hours played and last played.

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
│  ├─ sources.ts    IGDB (Twitch auth) and SteamGridDB
│  ├─ emulators.ts  emulator status and game-folder scanning
│  ├─ backup.ts     zip backup/restore, CSV export
│  ├─ samples.ts    removable sample games for the first-run preview
│  └─ index.ts      window, IPC, Steam import job, lifecycle
├─ src/preload/     safe IPC bridge (window.api)
├─ src/renderer/    React UI (gallery, filters, detail view, editor, settings, Steam import, stats)
│  └─ bigpicture/   Big Picture mode and controller input
├─ src/shared/      types + filter/sort logic shared by both sides
└─ tests/
   ├─ unit/         Vitest: combined filters, sorting, date parsing
   ├─ e2e/run.cjs        Playwright drives the real app against a local mock Steam server
   └─ e2e/features*.cjs  collections, wishlist, play time, IGDB/SteamGridDB (mocked), emulators, Big Picture
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
6. **Add Game** looks up details online for a PS5 disc game without marking it as a Steam purchase, and only the hand-edited field is protected from refreshes.
7. A repeat import creates **no duplicates**, refreshes metadata, and keeps notes, ratings, favorites and hand-edited fields.
8. A local program launches with arguments. A **missing launch file** is explained, Play is hidden, and the path can be removed.
9. Backup, delete and restore round-trip correctly, including the safety backup. CSV export works.

The feature suite starts by creating a database exactly as version 1.0 did, with a game, notes and a rating. It then checks that the upgrade keeps everything. After that it covers:
- Collections and multi-select
- Backlog, Playing and the wishlist
- Play time and stats
- IGDB and SteamGridDB lookups, run against a stand-in server
- Emulator setup, scanning and launching, using a stand-in emulator
- Big Picture navigation, launching, music and the menu

If you switch between running tests in plain Node and running the app, rebuild the native module for Electron with `npm run rebuild:native`.
