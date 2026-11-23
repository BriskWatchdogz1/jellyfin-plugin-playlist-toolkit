# Architecture

State: plugin 1.4.6.0, Jellyfin 12.4.0.

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
│   AutoPlaylistService/Worker (favourites,  │
│     dislikes mirrored into playlists)      │
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
| `src/…/AutoPlaylists/` | Automatic playlists: planner and track order (pure), mark store, service, worker, scheduled task, fixed cover images (`AutoPlaylistImage`) |
| `tests/` | Unit tests (xunit): smart shuffle (with the album and artist dislike rule), M3U parser, injection, automatic playlists (planner, order, registry, worker filter, access rules) |
| `testserver/` | Local test server, test data and end-to-end checks |

## Script injection

`PluginServiceRegistrator` registers an `IStartupFilter`. Jellyfin calls plugin registrators before the
web host is built, so the filter puts `ScriptInjectionMiddleware` in front of Jellyfin's own pipeline.
For `GET …/web/` and `GET …/web/index.html` the middleware

1. removes `Accept-Encoding` and the conditional request headers, so the document arrives complete and
   uncompressed,
2. buffers the response and inserts
   `<script defer data-playlisttoolkit src="../PlaylistToolkit/ClientScript?v=<hash>">` before `</body>`,
3. sends it with `Cache-Control: no-cache` and without `ETag` (the server's own pipeline sets that header after the plugin; a different value set here has no effect on the response), so the browser has nothing to revalidate with and fetches the page on every load.

If anything in steps 2 and 3 fails, the buffered stock response is passed on unchanged and the error is
logged; the entry document never fails because of the plugin (unit tested).

`<hash>` is a hash of the script content (the first 8 bytes of its SHA-256; the script text carries the plugin version, token `__PT_VERSION__`, replaced when it is served, so every version has its own hash; checked 2026-11-23: `69aee96b5d48fa44` is the hash of the 1.4.4.0 script). If a browser still runs an older script than the server (the server's version comes with `GET Config`), the script fetches the page afresh and reloads once per version (`checkVersion`, key `pt-reloaded-<version>` in sessionStorage). The script itself is served with a one-year cache lifetime; a
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
| `GET AutoPlaylists` | user | The caller's 2 automatic playlists: `{ Favorites, Dislikes }`, each `{ Enabled, PlaylistId?, ItemCount }` (id missing until created) |
| `POST AutoPlaylists/Sync` | user | Reconciles the caller now (no delay), returns the same object |
| `GET Playlists/{id}` | read | Name, description, owner, the caller's rights; shares for callers who may share |
| `GET Playlists/{id}/Items` | read | Table rows (`TrackRowDto`, with the caller's `IsFavorite`) in playlist order |
| `GET Targets?itemId=` | user | The playlists the caller can edit (own, or shared with the edit right; no automatic ones, music only; administrators get no extra ones) with, for the track, `Contains` (already in) and `SimilarAlbum` (same title and first artist from another album) |
| `POST Membership` | user | `{ "ItemId", "Add": [playlist ids], "Remove": [playlist ids] }`: adds the track where it is not and removes every entry of it where it is, in one call. Each playlist is checked as for `Targets`; refused or failed ones come back in `Failed`, the others are still done |
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
owner or administrator, optionally also editors (setting); *share* = owner or administrator. On an automatic playlist
(see below) *edit* and *share* are refused for everybody, administrators included, and *manage* is left to the
user it belongs to and administrators (`ApplyAutoRules`). An
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
- **Smart shuffle** (`SmartShuffler`): songs the caller disliked (Jellyfin's rating, `Likes == false`) do not take part, unless nothing else is left (setting `SmartShuffleSkipDisliked`, default on; `SmartShuffler.WithoutDisliked`). Since 1.3.2.0 the same goes for songs of an album or artist the caller disliked, unless the song has a heart (`IsFavorite`; a dislike on the song itself wins): `UserDataContainerDislikeReader` reads the album and artist ratings of the user from `UserData` (one query per shuffle: album ids and the clean names of the rated artists), `ContainerDislikeRule.Covers` decides per song: the song's nearest album ancestor is disliked, or a disliked artist is one of its album artists, or (setting `SmartShuffleArtistDislikeScope`: `AlbumArtist`, `AlbumOrMainArtist` default, `AnyArtist`) its first track artist, or any track artist. Artists are matched by clean name like the server's artist filter. No dependency on the Dislike plugin; the rule is a copy of its default rule. The playlist "Dislikes" still holds only songs disliked one by one. Tested by `ContainerDislikeRuleTests` and, with both plugins installed, by the Dislike plugin's end-to-end check 14d. Tracks are grouped by first artist (track artist, else album
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

## Automatic playlists

Every user gets 2 real Jellyfin playlists that fill themselves: favourites (name setting
`FavoritesPlaylistName`, default "Favoriten") and dislikes (`DislikesPlaylistName`, default "Dislikes";
Jellyfin's rating `Likes = false`). Both kinds are on by default and each has a server-wide switch
(`EnableFavoritesPlaylist`, `EnableDislikesPlaylist`); no per-user opt-out. Songs only.

- **One-way mirror (A2).** Jellyfin's user data is the truth, the playlist a copy. Nothing is written back
  to hearts or ratings, so an emptied playlist cannot delete favourites.
- **Shape (A3).** `OwnerUserId = Guid.Empty`, `OpenAccess = false`, `Shares = [(user, CanEdit false)]`. The user
  sees the playlist in every client; every stock write answers 403, a normal user cannot delete it, clients
  hide their edit controls (they read `GET /Playlists/{id}/Users/{me}`). Other users and administrators do not
  get it in their stock lists. The shape is enforced on every run. Proven on 12.4.0 (checks AP3, AP7 and a
  repeat after library scan and server restart). The fallback of the plan (user-owned playlist plus a request
  guard) was not needed.
- **Trigger and delay (A5, A6).** `AutoPlaylistWorker` (hosted service, log line "Automatic playlists:
  listening") handles `IUserDataManager.UserDataSaved` with a type check, a reason check
  (`PlaybackStart/Progress/Finished`, `TogglePlayed` are ignored) and a queue write; the loop waits
  `AutoPlaylistSyncDelaySeconds` (default 2) and reconciles the users that changed. Also queued: settings
  saved (all users) and removal of a registered playlist.
- **Reconcile (A5).** Always the same code: read the user's marks in 1 query on the `UserData` table
  (`UserDataMarkStore`), compare with the playlist, write the difference under 1 lock. `AutoPlaylistService`
  sets `Playlist.LinkedChildren` and calls `UpdateToRepositoryAsync(MetadataEdit)` plus `QueueRefresh`
  (decision A14, the stock add/remove calls are not used).
- **Order (A8).** The playlist's own order is the memory (Jellyfin stores no date for a heart): new songs go to
  the top (`AutoPlaylistNewestFirst`), several songs of one run are ordered by album artist, album, disc,
  track, name. The first fill is such a run, so it is album order.
- **Cover (1.3.1.0).** `Resources/favorites.png` and `dislikes.png` (800x800, embedded; SVG sources in `assets/`,
  made with `rsvg-convert -w 800 -h 800`) are saved as primary image by the reconcile (`EnsureImageAsync`:
  `IProviderManager.SaveImage`, then `UpdateToRepositoryAsync(ImageUpdate)`). The registry entry carries
  `ImageChecksum` (SHA-256 of the file on disk right after the plugin saved it) and `CustomImage`. Rule
  (`AutoPlaylistImage.Decide`, unit tested): `CustomImage` set: keep. No image: apply. Image but no checksum
  (playlist from 1.3.0.0, Jellyfin's generated collage): apply, nobody chose that image. Checksum equals the
  file: it is the plugin's own, refreshed only when the bundled image changed. Checksum differs from the file:
  somebody else (for example an administrator through the stock image API) replaced it: set `CustomImage`, keep
  for good. The plugin's own image endpoints on an automatic playlist set `CustomImage` (upload) or clear it
  (delete, so the fixed cover returns with the next sync). Decision: a custom image is detected by marker and
  checksum, never by guessing from the file; the cost is that a playlist whose collage was generated before the
  first marker is replaced once.
- **Created at once (1.4.0.0, was lazy A9).** Both playlists are created by the first reconcile, also with no matching song, and stay when they become empty. A user created later gets them through the first `GET Config` of the web client (`AutoPlaylistService.IsMissingFor` queues the user in the worker; startup, settings save and the daily task cover the rest).
- **Registry (A13).** `AutoPlaylists` in the configuration maps user and kind to the playlist id. A lost entry
  is healed by adopting a playlist of the shape with the configured name (check AP14). The settings page
  posts the whole configuration back, so the registry survives a save.
- **Cleanup (A15).** The scheduled task "Synchronise automatic playlists" (key `PlaylistToolkitAutoPlaylists`,
  startup and every 24 hours) reconciles all users, deletes playlists of deleted users and of switched-off kinds.
  Switching a kind off deletes its playlists for all users; switching it on rebuilds them in album order.
- **Web client.** Hint line above the table, and for the user it belongs to a row menu entry "Remove from
  favourites" / "Remove dislike" that calls the stock API (`updateFavoriteStatus`, `clearUserItemRating`; both
  exist in the 12.4.0 client, with an `ajax` fallback) and then `POST AutoPlaylists/Sync`. Move and remove
  entries disappear by themselves (`CanEditItems` is false). The administrator list shows "automatic (user)".
- **Dislike plugin.** No dependency. With its mutual exclusion a heart on a disliked song moves it from
  "Dislikes" to the favourites playlist and back (check CX1, tested with Dislike 1.0.1.0). Not solved here:
  with that plugin a stock shuffle or play-all on "Dislikes" in the web client is filtered to nothing, because
  all its songs are disliked. That needs a "review list" rule in the Dislike plugin (part B of the plan,
  not done); until then it is a documented limit. Smart shuffle of this plugin plays all songs of "Dislikes" (when nothing else is left in the list). With Dislike 1.1.0.0, disliked albums and artists do not enter "Dislikes" (check 14c of that plugin), and this plugin's smart shuffle leaves their songs out (since 1.3.2.0).
- **Measured** (test server, 2,000 songs): first fill 395 ms, 1 added song 221 ms (log lines of the service).

Limits: favourite albums and artists add no songs; a user restricted to "allowed tags" does not see the
playlists (the stock exemption is for owners only); an administrator cannot delete one with the stock delete
(it answers 404, the administrator cannot see the playlist), so only switching the kind off removes them; a
user who already has an own playlist with the same name gets 2 with that name; favourites of songs in a
library the user may no longer see are not added; the dashboard page and the plugin both write the
configuration file (healed by adoption). Not verified on devices: Finamp and Wholphin listing, playing and
showing no edit controls, and an empty playlist there.

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
- **Heart column (1.4.0.0)**: `COLUMNS` has a `fav` entry; the cell is a button that calls the stock `updateFavoriteStatus` (as the stock heart does), updates all loaded rows of that song at once, and on an automatic playlist syncs and reloads. The heart state comes from `TrackRowDto.IsFavorite` (one `GetUserDataBatch` per table load). Sorting by the column puts favourites first. The Dislike plugin needs no change: a favourite set through the API removes a dislike on the server (its exclusivity filter), and its page state follows with its next refresh.
- **Queue page (1.4.3.0, new layout 1.4.5.0, newest on top 1.4.6.0)**: `QueueView` is set up on `viewshow` of the page `.nowPlayingPage` when the address is `#/queue`. Stock markup used: `.remoteControlContent` with `.nowPlayingInfoContainer` (the player head) and `.playlistSection > .playlist` (one `.listItem` per queue entry). The page gets the class `pt-q-on`; its `.remoteControlContent` becomes a CSS grid as high as the window (height set by script on setup and on resize; the page does not scroll): the player head spans the top row, the history frame (our `section.pt-q-pane`, inserted before `.playlistSection`) and the stock `.playlistSection` (restyled as the "Up next" frame, with our heading) share the second row (2 columns above 900 px width, 2 rows below). Both frames scroll on their own. Because nothing is moved, the stock list keeps its rows, drag and drop and handlers. In "Up next" the rows up to and including the running track get `pt-hidden` (the stock rows stay in the DOM, so row indexes stay valid). The history frame lists newest first and holds two blocks: first `session`, a log of the queue entries this page has seen play (`QueueView.played`, newest first: at the first call the entries before the running one are taken over, afterwards the entry that was running before the current one is added at every change; an entry that a dislike skip or a removal took out of the queue stays in the log, which is why a skipped track shows up at once), then the history rows from Jellyfin. The view is refreshed (`decorate`) by the list observer and by `refreshQueueView`, which `onTrackStart` (event `playbackstart`) and the wrapped `removeFromPlaylist` call; the queue's own rows are drawn at once when the page opens, the Jellyfin history follows. The hearts of the log rows are read again from the server (queue entries carry the user data of the time they were queued). History comes from `GET /Items` (audio, `Filters=IsPlayed`, `SortBy=DatePlayed` descending, 50 per page, `StartIndex`). Only entries with a play date and `PlayCount` above 0 count as heard: Jellyfin sets PlayCount with every real playback, while `Played` with `PlayCount` 0 comes from something that wrote user data without playing (seen on 2026-11-23); up to 4 requests per page are spent skipping them. The frame opens at the top; a `scroll` event near the bottom loads the next older page and appends it (nothing the user looks at moves; a new log row at the top while the user has scrolled down adds its height to `scrollTop`); a frame that is not full is filled until the history is through; "Loading …" is an absolutely placed label, so it shifts nothing. A failed load is retried 3 times; every start of the view has a generation number, so answers of an earlier start (page shown again) are dropped. History rows of tracks that are in the queue up to and including the running one are hidden (the queue's own rows show them). Rows carry cover (track or album image, else a coloured tile with a note), the stock heart (`button[is="emby-ratingbutton"]`, so the Dislike plugin adds its thumb and both keep their state by themselves), and name, artist and album as links. A click on a history row (`QueueView.play`) calls `queueNext` and then `nextTrack`: the track plays now, the track that ran before it goes to the top of the history, what was lined up plays after it (with an empty queue it starts a play); the player head and that row are lit up. The inserted entry is not one of the playlist session's entries. A heart does not change the queue. Not tested in this layout: the Firefox engine (no driver on the development machine), widths below 900 px.
- **Marks during playback (1.4.4.0)**: on the test server (Jellyfin 12.4.0) a heart or rating that is set while a song plays is wiped by the next playback report for that song (progress or stop): the report saves the user data it read before. Reproduced with scripted reports and with the stock web client (dislike of the running track on the queue page, followed by the skip, left no dislike). `AutoPlaylistWorker.GuardMarks` remembers heart and rating of every explicit change (`UpdateUserRating`, `UpdateUserData`; per user and song, 24 hours) and, when a `PlaybackStart/Progress/Finished` save carries different marks, writes the remembered ones back (150 ms later, `GetUserData` object, reason `UpdateUserRating`; log line "wiped by a playback report and written back"). One write-back was enough per song in the test: later reports did not wipe it again. Explicit removals update the memory first, so taking a heart back is not undone. Tested by `PB1`, `PB2`.
- **Links in the table (1.4.4.0)**: the artist column renders each artist as a link (`data-pt-artist`); a click looks the artist up by name (`ApiClient.getArtist`) and opens the artist page; the album column links to the album as before. The same links are in the history rows. A click on any other part of a row keeps its old action.
- **Artist names without article (1.4.2.0)**: settings `EnableArtistSortFix` (default on) and `SortArticles` (default `The,Die`; `ArticleRule.ParseArticles`). Server: `ArtistSortService.ApplyAsync` goes through all `MusicArtist` items; one whose name starts with an article as a whole first word (`ArticleRule.Split`, unit tested) and has no forced sort name and whose computed sort name is not already the name without the article gets `ForcedSortName` = the name without the article and `UpdateToRepositoryAsync(MetadataEdit)`. A forced sort name that is already set (by a person or by an earlier run) is never touched. It runs as scheduled task "Sort artists without leading article" (key `PlaylistToolkitArtistSort`, startup and every 24 hours) and as `ILibraryPostScanTask` after every library scan. `SortRemoveWords` of the server is not changed (it would also move song titles such as "Die For You"). Tested: a full metadata refresh with replace-all does not remove the forced sort name (test server). Client: `GET Config` returns `SortArticles` (empty when the fix is switched off); `core.splitArticle`, `artistLabel` rewrite the name text of every element with `data-type="MusicArtist"` (tile text `.cardText-first`, list row `.listItemBodyText`) from a `MutationObserver`, and the artist column of the table (display and `sortText`, the sort ignores the article even when the display is off). Joint artists are joined by "; " when one name was moved, so the commas stay readable. The per-user switch is stored as key `articlesAfter` in the same display preferences object as `endless` (shared, so neither save overwrites the other); it is in the `…` menu of a playlist. Not changed: the playback bar, album pages and every other place that prints an artist name without a `data-type="MusicArtist"` element.
- **User data trace (1.4.2.0)**: the worker logs one Information line for every change of a song's user data that is not playback bookkeeping (`User data of a song changed: …`): user id, song, save reason, favourite, played, play count, rating, request method and path (no query), and `Client=` / `Device=` of the authorization header (no token). Jellyfin keeps no record of the caller; this line says who flipped a heart or marked a song as played.
- **Dislike column and skipping (1.4.1.0)**: `TrackRowDto.IsDisliked` (`Likes == false` of the caller). The `dislike` column calls `updateUserItemRating(userId, id, false)` / `clearUserItemRating` (the calls the Dislike plugin and the stock buttons use); heart and thumb exclude each other (the table clears the other mark first, the Dislike plugin's server filter does the same). "Skipped for this user" is client-side and per user because the rows are the caller's: `pruneQueue` (at every track start, after removals, and after every rating call that `hookRatings` sees on the API client, so also ratings from the playback bar, the queue page and the Dislike plugin's menu) treats session entries whose track is disliked as stale: upcoming ones are removed, the running one is skipped (`nextTrack`). Disliked rows are also left out of a click start (the clicked row itself always plays: `keepEntry`; rating that very song ends the exemption). Smart shuffle on the server already leaves disliked songs out (setting `SmartShuffleSkipDisliked`), so this also covers the case that setting is off. Exempt: the automatic playlist "Dislikes" (`source.skipDisliked` false) and a playlist in which every song is disliked.
- **Queue removals stay removed (1.4.1.0)**: the session remembers which track belongs to each entry it appended (`entryTrack`). The player's `playlistitemremove` event (fired by the stock queue page, the playback bar menu and the Dislike plugin's guard; not by this script's own removals, which go through `removeOwn`) puts the track into `session.skip`: a second upcoming entry of it is removed, parts that are appended later and every endless round leave it out. Before this, endless mode appended the whole playlist again when 5 tracks were left, so a track removed from the queue came back with the next round (reproduced on the test server with an 8-track playlist: removed from round 1, present again at the start of round 2). The skip set lasts until another playback replaces the session.
- **Playlist heart (1.4.0.0)**: the heart in the page head of a playlist marks the playlist item itself; the plugin leaves that as it is and shows a note (toast, and as tooltip). Songs get into "Favoriten" only through their own heart.
- **One smart shuffle per playlist page (1.4.0.0)**: a capture-phase click handler turns the stock `.btnShuffle` of the page head into the smart shuffle (music playlists with a panel only). "Smart shuffle on" (`pt-active`, `aria-pressed`) is computed by `smartActive`: the session's source is a smart shuffle of this playlist, the queue still holds one of its entries, and the player's own queue shuffle (`getQueueShuffleMode`) is not "Shuffle". It refreshes on every track start and every 2 seconds. Nothing is stored in the browser any more (1.3.3.0 kept a flag in localStorage that stayed on for ever). A click on a row calls `smartActive`: on, it plays that track first and the rest in smart order; off, it plays the list from there in the order shown. The playback bar's shuffle toggle stays the player's own: switching it on reorders the queue randomly, so the indicator goes off and endless mode abandons the session.
- **Queue button (1.4.0.0)**: `#/queue`, the web client's play queue page (route `queue`, drawer entry "Now Playing" in 12.4.0). It lists the whole queue with the running track marked; a split into "next" and "history" is not built.
- **Add to several playlists (1.4.0.0)**: `playlistsDialog(trackId, name)` loads `GET Targets`, shows a tick per playlist, and sends one `POST Membership` on *Confirm*; removals call `playlistShrank` so a running queue follows. It opens from the row menu of the table and replaces the stock window: a `MutationObserver` on the body looks for the stock editor (`#selectPlaylistToAddTo`, hidden field `.fldSelectedItemIds`). If it was opened for exactly 1 id and that item is a song (`getItem`), the stock window is hidden, closed through its `.btnCancel`, and the plugin's window opens; otherwise the stock window is shown as before. The duplicate warning of the stock add stays for albums and several songs; for one song the window itself carries it (a playlist with the same song from another album says so on its row).
- **Queue follows the playlist (1.3.3.0, extended in 1.4.0.0)**: the player's queue is a copy. The session remembers the entry ids it
  appended; at every track start, and after a removal (panel menu, or the stock `DELETE /Playlists/{id}/Items`
  seen by the fetch/XHR wrapper), entries of the session whose track is no longer in the playlist are removed
  from the queue (never the running one, never entries the user queued from elsewhere). The player's
  `clearQueue` is wrapped and ends the session. Appended parts are recognised by their new entry ids, not by an
  exact run, so another script changing the queue meanwhile does not end the session. A click on a row while
  the playlist's smart shuffle mode is on (localStorage `pt-smart-<id>`) plays that track first and the rest in
  smart order. At every track start the queue is also compared with the playlist for the running entry: a session track that was removed from the playlist meanwhile is skipped (`nextTrack`) and taken out. Pure rules (`core` in `client.js`) are tested by `./test-js.sh`.
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
- **Row menu**: play, play next, add to queue, add to playlist (several at once), go to album, move, remove. "Add to another playlist" and
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
`ISessionManager.SendPlayCommand`, `IAuthorizationContext`, `IPluginServiceRegistrator`; for automatic
playlists: `IUserDataManager.UserDataSaved` and `UserDataSaveReason`, `JellyfinDbContext.UserData` (`UserId`,
`ItemId`, `IsFavorite`, `Rating`, `Item.Type`), `UserItemData.MinLikeValue`, `Playlist.LinkedChildren`,
`LinkedChild.Create`, `IPlaylistManager.CreatePlaylist`, `IProviderManager.QueueRefresh`, `IScheduledTask`,
`IHostedService` registered from a plugin, `ILibraryManager.ItemRemoved`.

Server (runtime): the stock permission checks of `PlaylistsController` (owner or share with edit right; they make
the automatic playlists read-only), playlist visibility through `Shares` for a playlist without owner (check AP3
after every update), plugin registrators run before the web host is built (needed for the startup filter);
the web client is served below `/web/` with `index.html` containing `</body>`.

Web client (runtime; a change makes a feature disappear silently, the stock client keeps working):

| Used | For |
|------|-----|
| `viewshow` DOM event, `event.detail.params.id`, class `itemDetailPage` | Detecting the playlist page |
| `#childrenContent`, `.itemsContainer` with `fetchData` and `refreshItems` | Replacing the stock list |
| `window.ApiClient`: `updateFavoriteStatus`, `clearUserItemRating` (fallback `ajax`), `setRequestHeaders`, `getUrl`, `serverId`, `getCurrentUserId`, `getDisplayPreferences`, `updateDisplayPreferences` | Calling the server, endless switch |
| `window.webpackChunk`, the text "Remote players are disabled" in the player module, the player's `play`, `queue`, `queueNext`, `getPlaylist`, `getCurrentPlaylistIndex`, `removeFromPlaylist`, `nextTrack`, `getQueueShuffleMode`, the queue page markup (`.nowPlayingPage`, `.playlistSection .playlist .listItem`, `.playlistIndexIndicatorImage`), `ApiClient.getItems`, `playlistitemremove`, `ApiClient.updateUserItemRating`, `clearUserItemRating` (wrapped), queue entries with `PlaylistItemId`, `window.Events` with `playbackstart` | Playing whole lists, endless mode (fallback: one part through the server) |
| `POST /Playlists/{id}/Items?ids=…` sent by the stock add dialog | Duplicate warning |
| The stock playlist editor: `#selectPlaylistToAddTo`, `.fldSelectedItemIds`, `.btnCancel`; `ApiClient.getItem`; `.btnShuffle` and `.mainDetailButtons button[is="emby-ratingbutton"]` of the details page; route `#/queue` | Several-playlists window, shuffle in the page head, playlist heart note, queue button |
| "Play" websocket message handled by the web client, queue fetched by ids | Playback fallback |
| `.MuiAppBar-root` / `.skinHeader` | Offset of the sticky table header |
| z-index of stock dialogs (999999) and spinner (9999999) | Duplicate dialog must be above them |
| `material-icons` classes | Icons |

`testserver/test_api.py` covers the server side (172 checks; TM1 to TM7: hearts in rows, targets, membership; AP2 and AP26: playlists from the start). The web client side was checked by hand in Chrome
(table, sort, filter, play from here, smart shuffle queue, image, description, sharing, classic view,
export, import, duplicate warning from the stock dialog, view of a listen-only user, phone width; for
1.0.1.0: full queue of 2,500 tracks, endless mode over 4 rounds, switch off and on, play from here in
sorted order, administrator view with stacked dialogs; for 1.0.2.0: starting something else while the
queue is being filled, round change with tracks still waiting, playback without the player object,
administrator view of a video playlist).
