# Architecture

State: plugin 1.1.0.0, Jellyfin 12.4.0.

## Overview

```
browser (jellyfin-web 12.4)                    Jellyfin server 12.4
┌──────────────────────────────┐              ┌────────────────────────────────────────────┐
│ index.html  ◄────────────────┼── GET /web ──┤ ScriptInjectionMiddleware (startup filter) │
│  + <script …/ClientScript>   │              │   adds one script tag to the response      │
│                              │              │                                            │
│ client.js                    │              │ PlaylistToolkitController  /PlaylistToolkit/…    │
│  table, dialogs, guard for   ├── REST ──────►   PlaylistAccessService  (who may what)    │
│  "add to playlist"           │              │   PlaylistContentService (rows, duplicates)│
│                              │              │   SmartShuffler          (pure algorithm)  │
│ stock player (queue filled   │              │   M3uService             (export/import)   │
│  in parts by client.js)      │              │                                            │
└──────────────────────────────┘              └────────────────────────────────────────────┘
```

Everything is one assembly, `Jellyfin.Plugin.PlaylistToolkit.dll`. The web client script is an embedded
resource; there is no build step for JavaScript.

| Path | Content |
|------|---------|
| `src/…/Plugin.cs`, `PluginServiceRegistrator.cs` | Plugin entry, service registration |
| `src/…/Configuration/` | Settings class and the dashboard settings page |
| `src/…/Web/ScriptInjection*.cs`, `ClientScript.cs` | Injection of the script tag, script with content hash |
| `src/…/Web/client.js` | Web client part |
| `src/…/Api/` | Controller and DTOs |
| `src/…/Services/` | Access rules, playlist content, smart shuffle, M3U |
| `tests/` | Unit tests (xunit): smart shuffle, M3U parser, injection |
| `testserver/` | Local test server, test data and end-to-end checks |

## Script injection

`PluginServiceRegistrator` registers an `IStartupFilter`. Jellyfin calls plugin registrators before the
web host is built, so the filter puts `ScriptInjectionMiddleware` in front of Jellyfin's own pipeline.
For `GET …/web/` and `GET …/web/index.html` the middleware

1. removes `Accept-Encoding` and the conditional request headers, so the document arrives complete and
   uncompressed,
2. buffers the response and inserts
   `<script defer data-playlisttoolkit src="../PlaylistToolkit/ClientScript?v=<hash>">` before `</body>`,
3. sends it with `Cache-Control: no-cache` and without `ETag`.

If anything in steps 2 and 3 fails, the buffered stock response is passed on unchanged and the error is
logged; the entry document never fails because of the plugin (unit tested).

`<hash>` is a hash of the script content. The script itself is served with a one-year cache lifetime; a
changed script gets a new URL. No file of the web client is modified on disk, so an image update cannot
leave a half-patched client behind, and switching the plugin off (setting *Load the client script*, or
removing the plugin) restores the stock client on the next page load.

The community plugins *File Transformation* and *JavaScript Injector* solve the same problem. They are
not needed and not used; the middleware wraps whatever the pipeline returns, so it also works alongside
them.

## API

All routes are below `/PlaylistToolkit`, need a logged-in user and return JSON. An owner never needs an administrator.
A playlist that the caller cannot see answers 404, a missing right 403.

| Route | Right | Purpose |
|-------|-------|---------|
| `GET ClientScript` | none | The web client script |
| `GET Config` | user | Settings the client needs |
| `GET Users` | user | Id and name of all other users (for the share dialog) |
| `GET Admin/Playlists` | administrator | Every playlist of every user with owner, visibility and size |
| `GET Playlists/{id}` | read | Name, description, owner, the caller's rights; shares for callers who may share |
| `GET Playlists/{id}/Items` | read | Table rows (`TrackRowDto`) in playlist order |
| `POST Playlists/{id}/Image` | manage | Raw image body (JPEG, PNG, WebP, GIF), size limit from the settings |
| `DELETE Playlists/{id}/Image` | manage | Remove the image |
| `POST Playlists/{id}/Description` | manage | `{ "Overview": "…" }` |
| `POST Playlists/{id}/Sharing` | share | `{ "OpenAccess": bool?, "Shares": [{ "UserId", "CanEdit" }]? }`, replaces the list |
| `POST Playlists/{id}/Duplicates` | read | `{ "Ids": […] }` → duplicates (`exact` / `similar`) and new ids |
| `POST Playlists/{id}/Items` | edit | `{ "Ids": […] }`, appends tracks |
| `DELETE Playlists/{id}/Items?entryIds=…` | edit | Removes entries |
| `POST Playlists/{id}/Items/{entryId}/Move/{newIndex}` | edit | Moves an entry (400 for a position outside the list, 404 for an unknown entry) |
| `GET Playlists/{id}/SmartShuffle` | read | Item ids in smart shuffle order (`?after=<item id>`: the order follows that track, its artist does not open it; `?seed=` for a reproducible order) |
| `POST Playlists/{id}/SmartShuffle` | read | `{ "After": id, "Pending": [ids] }`: next round for endless mode; pending tracks come last |
| `POST Play` | user | `{ "ItemIds": […], "StartIndex": n, "Mode": "play"/"next"/"last" }`, plays on the calling client; fallback only, limited to one part |
| `GET Playlists/{id}/Export` | read | Extended M3U (UTF-8) |
| `POST Import` | user / edit | `{ "Name" or "PlaylistId", "Content" }` |

Rights (`PlaylistAccessService`): *read* = the playlist is visible to the caller (same lookup as the stock
API), or the caller is an administrator; *edit* = owner, share with `CanEdit`, or administrator; *manage* =
owner or administrator, optionally also editors (setting); *share* = owner or administrator. An
administrator therefore reaches every playlist, also private ones of other users that the stock API does
not show them. Requests with an API key instead of a user are refused.

Track visibility (`PlaylistContentService.VisibilityCheck`): rows, smart shuffle, export, the duplicate
check and adding through the plugin only handle tracks the caller may see, including library access.
This is stricter than the stock endpoint `GET /Playlists/{id}/Items`, which on 12.4.0 lists tracks from
libraries the user has no access to (observed in the tests). The classic list view uses that stock
endpoint.

### Notes on single features

- **Image, description**: saved with the same calls the stock (admin-only) endpoints use
  (`IProviderManager.SaveImage`, `UpdateToRepositoryAsync`). They live in Jellyfin's own data and survive
  metadata refreshes (tested). The stock page renders the description as Markdown.
- **Sharing**: writes `Playlist.Shares` directly. The stock endpoint `POST /Playlists/{id}/Users/{userId}`
  fails with HTTP 500 for private playlists (jellyfin/jellyfin#18534, reproduced on 12.4.0) because it
  looks the playlist up as the user who is about to get access.
- **Duplicates**: albums, artists, genres and folders are expanded to tracks exactly as the stock add does.
  `exact` = the same library item is already in the playlist; `similar` = another item with the same
  title and first artist (for example the album and the single version).
- **Smart shuffle** (`SmartShuffler`): tracks are grouped by first artist (track artist, else album
  artist; tracks without artist never block each other). With R tracks left and artist L played last, an
  order without repeats exists exactly when no other artist has more than ⌈R/2⌉ tracks and L at most
  ⌊R/2⌋. Each step picks a random track among the artists that keep this true, so a repeat only happens
  when no repeat-free order exists at all (one artist owns more than half of the list). Recency is the
  tie-breaker inside that rule: tracks the *calling user* played within the configured window
  (default 72 hours) are taken last, the most recently played half at the very end. The artist rule
  wins when both cannot be met.
- **Playback**: smart shuffle and "play from here" play the whole list. The web player takes a list of
  ids with one GET request, which fits about 227 ids (URL limit), so `client.js` starts the first part
  (*Tracks per queue request*, default 200) and appends the rest part by part while the music runs,
  each part only after the previous one is in, so the order is exact. For this it needs the web
  client's player object (`playbackManager`), which is not global: it is looked up once in the web
  client's module registry (`window.webpackChunk`; the module is found by a text only it contains, the
  object by its methods; if the lookup would have to load the module itself, it is not used).
  The script remembers the entry ids the player gave to what it appended. Before and after every part
  it checks that one of them is still in the queue; if the user started something else meanwhile, a
  part that slipped into the new queue is removed again and appending and endless mode end. If the player object cannot be found, `POST Play` makes the server
  send the regular remote-control "Play" message to the calling device; that path is limited to one part.
- **Endless**: when a smart shuffle queue has 5 or fewer tracks left, the script asks for a new order
  (`POST Playlists/{id}/SmartShuffle` with the last track of the queue and the tracks still waiting)
  and appends it, so playback never stops and nothing is reloaded at the end. The new order follows
  the same rules: the artist of the last track does not open it, and what was heard recently comes
  late. The running track and the tracks still waiting in the queue have no play date yet; the server
  puts them last of all in the new order, otherwise they would open it and play twice within a few
  minutes. The switch is stored per user in Jellyfin's display preferences (id and client
  `playlisttoolkit`, key `endless`), default on. Until a user changes it under the new id, the value saved
  under the former id `playlistplus` (plugin name before 1.1.0.0) is used. It is hidden when the web player object is not found,
  because endless mode cannot work then.
- **Administrator view**: a dialog listing every playlist (`GET Admin/Playlists`) and showing one of
  them with the same table and menus (video playlists and a switched-off table: menu only, as on the
  playlist page). It exists because the stock details page cannot open a playlist
  that is not visible to the user. Moves and removals always go through the plugin's endpoints, since
  the stock ones refuse administrators on playlists of other users.
- **M3U**: export writes `#EXTINF:<seconds>,<artist> - <title>` plus the file path as the server sees it.
  Import matches by exact path, then by file name if it is unique in the library, then by title and
  artist from the `#EXTINF` line; only tracks the importing user can see are matched. Unmatched entries
  are reported. A new playlist is private and owned by the importing user.

## Web client (`client.js`)

Plain JavaScript, no dependencies, English and German texts (chosen by the client's display language).

- **Hook**: listens for the web client's `viewshow` event on the item details page and asks
  `GET Playlists/{id}`; a 404 means "not a playlist" and the stock page is left alone.
- **Table**: rows are absolutely positioned in a container with the full height; only the rows near the
  viewport exist in the DOM (about 20 to 40). Sorting and filtering work on the loaded row objects.
  Below 480 px table width the artist moves under the title (phone layout).
- **Columns** are a list at the top of the file (`COLUMNS`). A new column (date added, last played,
  play count) needs a field in `TrackRowDto` plus one entry in that list:
  `{ id, labelKey, width, text(row), sortValue(row)?, link(row)?, hideBelow? }`.
  Jellyfin does not store when a track was added to a playlist; that column needs its own storage first.
- **Stock list**: the stock page renders the playlist through `fetchData`/`getItemsHtml` properties on
  `#childrenContent .itemsContainer`. The script traps `fetchData` and answers with an empty list while
  the table is shown, so the stock page does not download and build thousands of hidden rows. *Classic
  list view* in the `…` menu switches back to the stock list (drag and drop, stock context menu).
- **Duplicate warning**: the script wraps `fetch` and `XMLHttpRequest` and holds back
  `POST /Playlists/{id}/Items?ids=…` until the duplicate check (and the user's answer) is in. For "add a
  selection" or "cancel" the tracks are added through the plugin and the stock request is sent with an
  empty id list, which the server treats as a no-op; the stock dialog then closes normally. If the check
  fails, the request goes out unchanged.

## Limits

- **Long queues**: a queue of 2,500 tracks was filled in 1.4 s and added about 11 MB to the browser's
  memory (Chrome, test server). Jellyfin's own queue page draws every entry (2,500 entries, about
  40,000 page elements, 1.5 s to open); that is stock behaviour. In endless mode the queue grows by
  one playlist length per round.
- **Endless needs the browser tab**: the next round is fetched by the script in the open tab. Only
  smart shuffle is endless; "play from here" ends at the end of the list.
- **Adding to a playlist the administrator cannot see**: Jellyfin's *Add to playlist* dialog only lists
  visible playlists. In the administrator view tracks are added by M3U import (append); the API
  accepts ids directly.
- **Audio playlists only**: the table, filter, smart shuffle and M3U are offered for music playlists.
  Video playlists (watch orders) keep the stock list; the `…` menu there offers image, description and
  sharing.
- **Web client only**: table, dialogs and duplicate warning exist where the web client runs. Native apps
  see image, description and sharing, but not the UI additions. The TV layout is left untouched.
- **Duplicate entries**: Jellyfin identifies a playlist entry by the id of its track. If the same track is
  in a playlist twice, "remove" removes both entries (stock behaviour).
- **Artist rule**: only the first artist of a track counts. "A feat. B" followed by "B" is allowed.
- **Reordering**: the table offers move to top / up / down / bottom; drag and drop is in the classic view.
- **Row menu**: play, play next, add to queue, go to album, move, remove. "Add to another playlist" and
  favourites are in the classic view.
- **Export paths**: the M3U export contains file paths as the server sees them (`/data/music/…`). Every
  user who can see the playlist can read these paths.
- **Sorting on phones**: in the phone layout only title and duration have a header to sort by.
- **After saving image or description** the page reloads its data by changing the address
  (`&pp=<number>` is appended).

## What depends on Jellyfin internals

Check these after a Jellyfin update (procedure: [update-jellyfin.md](update-jellyfin.md)).

Server (compile-time; the build fails if they change):
`IPlaylistManager`, `Playlist` (`Shares`, `OpenAccess`, `OwnerUserId`, `GetManageableItems`,
`GetPlaylistItems`), `IProviderManager.SaveImage`, `IUserDataManager.GetUserDataBatch`,
`ISessionManager.SendPlayCommand`, `IAuthorizationContext`, `IPluginServiceRegistrator`.

Server (runtime): plugin registrators run before the web host is built (needed for the startup filter);
the web client is served below `/web/` with `index.html` containing `</body>`.

Web client (runtime; a change makes a feature disappear silently, the stock client keeps working):

| Used | For |
|------|-----|
| `viewshow` DOM event, `event.detail.params.id`, class `itemDetailPage` | Detecting the playlist page |
| `#childrenContent`, `.itemsContainer` with `fetchData` and `refreshItems` | Replacing the stock list |
| `window.ApiClient`: `setRequestHeaders`, `getUrl`, `serverId`, `getCurrentUserId`, `getDisplayPreferences`, `updateDisplayPreferences` | Calling the server, endless switch |
| `window.webpackChunk`, the text "Remote players are disabled" in the player module, the player's `play`, `queue`, `queueNext`, `getPlaylist`, `getCurrentPlaylistIndex`, `removeFromPlaylist`, queue entries with `PlaylistItemId`, `window.Events` with `playbackstart` | Playing whole lists, endless mode (fallback: one part through the server) |
| `POST /Playlists/{id}/Items?ids=…` sent by the stock add dialog | Duplicate warning |
| "Play" websocket message handled by the web client, queue fetched by ids | Playback fallback |
| `.MuiAppBar-root` / `.skinHeader` | Offset of the sticky table header |
| z-index of stock dialogs (999999) and spinner (9999999) | Duplicate dialog must be above them |
| `material-icons` classes | Icons |

`testserver/test_api.py` covers the server side. The web client side was checked by hand in Chrome
(table, sort, filter, play from here, smart shuffle queue, image, description, sharing, classic view,
export, import, duplicate warning from the stock dialog, view of a listen-only user, phone width; for
1.0.1.0: full queue of 2,500 tracks, endless mode over 4 rounds, switch off and on, play from here in
sorted order, administrator view with stacked dialogs; for 1.0.2.0: starting something else while the
queue is being filled, round change with tracks still waiting, playback without the player object,
administrator view of a video playlist).
