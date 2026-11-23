# Playlist Toolkit for Jellyfin

A Jellyfin server plugin that lets the **owner of a playlist do everything with it** without being an
administrator, and makes long music playlists usable in the web client.

The code of this plugin was written by Claude (Anthropic), an AI model, and is provided as is.

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | Set, replace and remove the playlist image as the owner (stock Jellyfin: administrators only) | Playlist page → `…` → *Image and description* |
| 2 | Track table with the columns title, artist, album (artist and album names are links to their pages), duration; click a header to sort (third click returns to playlist order) | Playlist page |
| 3 | Share a playlist with selected users, per user "can listen" or "can edit", plus the stock "public" switch | Playlist page → `…` → *Share* |
| 4 | Smart shuffle: never the same artist twice in a row, recently played tracks last. The whole playlist is queued. With *Endless* (default on, remembered per user) the playlist is shuffled again when it is through and keeps playing. Since 1.2.0.0 it also leaves out songs the user disliked, and (since 1.3.2.0) songs of albums and artists the user disliked unless the song has a heart (setting *Smart shuffle leaves out songs the user disliked, and songs of albums and artists the user disliked*, default on; which artist counts is a second setting, default: album artist or first-named artist) | Playlist page → *Smart shuffle* (also the shuffle button in the page head), switch *Endless* |
| 5 | Warning before adding tracks that are already in the playlist, with a choice per track | Stock *Add to playlist* dialog |
| 6 | Description text for a playlist | Playlist page → `…` → *Image and description* |
| 7 | Filter inside a playlist; M3U export and import | Playlist page |
| 8 | Administrators open every playlist of every user, also private ones: image, description, sharing, tracks | Dashboard → Plugins → Playlist Toolkit → *Manage all playlists*, or `…` → *All playlists (admin)* on a playlist page |
| 9 | Automatic playlists (since 1.3.0.0): every user gets a read-only playlist with all songs they marked as favourite ("Favoriten") and one with all songs they disliked ("Dislikes"); both exist from the start, also while empty (since 1.4.0.0). They are real playlists, so every client lists them, and stock shuffle works on them. A heart or thumbs-down changes the list within a few seconds, from any client; new songs go to the top. Both have a fixed cover that comes with the plugin (since 1.3.1.0) | Playlist list of the user; settings *Favourites playlist*, *Dislikes playlist*, names, order, delay |
| 10 | Heart per song (since 1.4.0.0): a heart column in the track table sets and takes back the favourite of the song at once (the same favourite the stock heart uses). A heart on the playlist itself only marks the playlist; the page says so | Playlist page |
| 11 | Several playlists at once (since 1.4.0.0): *Add to playlist* in the context menu of a song (anywhere in the web client, and in the table's row menu) opens one window with every playlist the user can edit, ticked where the song already is. Ticking and unticking changes nothing until *Confirm*; then all additions and removals are applied together. A playlist that holds the same song from another album says so on its row; automatic playlists are not offered; a new playlist can be created from the same window. Albums and several songs keep the stock window | Context menu of a song |
| 12 | *Queue* button on the playlist page: opens the web client's queue page (current and upcoming tracks) | Playlist page |
| 13 | Dislike per song (since 1.4.1.0): a thumb-down column next to the heart sets and takes back the dislike (the same rating the Dislike plugin uses; heart and dislike exclude each other). A song the user disliked stays in the playlist but is skipped in that user's own queue: smart shuffle, endless rounds and a click start leave it out, and it leaves a running queue at once, whichever client set the dislike (this table, the playback bar, the queue page). Per user: someone else listening to the same playlist is not affected. The playlist "Dislikes" is exempt | Playlist page |
| 14 | Artist names without the leading article (since 1.4.2.0): "The Pretty Reckless" is shown as "Pretty Reckless, The" and "Die Antwoord" as "Antwoord, Die" on the artist tiles and lists of the web client and in the artist column of the track table (which also sorts without the article). Only a whole first word from the list of articles counts (setting *Articles*, default The, Die; "Diesel" and "Theory" stay). On the server a scheduled task and a step after every library scan give such artists a forced sort name without the article, so they sort under P and A (the server's own list of ignored words is not changed, because it would also move song titles). A sort name set by hand is never overwritten. Each user can switch the display off in the `…` menu of a playlist | Library → Music → Artists, playlist page; settings *Sort artists without a leading article*, *Articles* |
| 15 | Queue page (since 1.4.3.0, new layout 1.4.5.0): the web client's queue page (`#/queue`, reached by the *Queue* button) keeps the player (cover, title, controls) fixed at the top; the page itself does not scroll. Below are 2 framed areas with their own scroll bars, side by side on wide windows and one above the other on narrow ones: *Recently played* (newest on top, right under the player: first what this page saw play, which appears at once when the track changes, also a track skipped by a dislike; below it the last played tracks Jellyfin remembers for the user, 50 more each time the frame is scrolled to its bottom). Reading order: player, then what was just heard going down into the past on the left, what comes next going down on the right and *Up next* (the stock queue list with remove, heart, thumb, drag and drop). History rows look like queue rows: cover, title, artist and album as links, heart, thumb; the date is small in the second line. A click on a history row plays it at once, right behind the running track; the queue goes on after it, and the player and the new top row light up | Queue page |
| 16 | Hearts and dislikes stay (since 1.4.4.0): Jellyfin 12.4 wipes a heart or rating that is set while a song plays when the next playback report of that song arrives (progress or stop). The plugin remembers every explicit change and writes it back when a playback report removed it | server |

The table only keeps the visible rows in the page, so playlists with thousands of tracks scroll, sort and
filter without delay (measured with 2,500 tracks: rows load in 0.2 s, sorting takes 10 ms).

Automatic playlists: they are on by default (switch each kind off in the settings; switching off deletes
the playlists of all users). Songs only; favourite albums and artists add nothing. They are read-only for
everybody, the user included: a song leaves the list when its heart or dislike is taken back (in the web
client also through the row menu of the list). The first fill is in album order. A user restricted to
"allowed tags" does not see them. The fixed covers (a white heart on a warm gradient, a thumb down on a dark violet gradient, 800x800 PNG, sources in `assets/`) are set when a playlist is created and on existing automatic playlists that have no cover of the plugin: a generated collage or no image is replaced. An image set by a person through the plugin ("Image and description") is remembered and never replaced; removing it brings the fixed cover back with the next sync. With the Dislike plugin installed, the stock shuffle and play-all in the
web client skip all songs of "Dislikes" (they are all disliked); the smart shuffle of this plugin plays them.

Shuffle on a music playlist page (since 1.4.0.0): the page has one smart shuffle. The *Smart shuffle* button and the
shuffle button in the page head start the same thing. The button shows *Smart shuffle on* while the running queue is a
smart shuffle of that playlist (it is read from the live queue, nothing is remembered). While it is on, a click on a
track plays that track first and keeps the rest shuffled; otherwise a click plays from that track in the order
shown. The shuffle toggle in the playback bar is the web player's own mode and is not changed: switching it on
reorders the queue randomly, which turns *Smart shuffle on* off and stops endless mode. Tracks taken out of a
playlist leave the running queue, and a track that was removed just before it started is skipped. A track the user takes out of the running queue by hand (queue page, playback bar) also stays out of the endless rounds that follow, until something else is played.

Playlist Toolkit does not touch Jellyfin's *Instant Mix*. On other pages the stock *Shuffle* button is
filtered by the separate Dislike plugin (see Compatibility). The web client is shown in
English or German, following the language of the web client page (else the browser).

Who may do what:

| Action | Owner | User with "can edit" | User with "can listen" | Administrator (every playlist) |
|--------|-------|----------------------|------------------------|--------------------------------|
| See table, filter, sort, smart shuffle, export | yes | yes | yes | yes |
| Add, remove, move tracks | yes | yes | no | yes |
| Image and description | yes | no (setting) | no | yes |
| Change sharing | yes | no | no | yes |

- Users with "can edit" do not change image and description by default; the setting *Users with edit
  permission may change image and description* allows it.
- An administrator can do everything with every playlist of every user, including private playlists that
  Jellyfin itself hides from administrators. The owner stays the owner.
- The M3U export is available to everyone who can see the playlist.
- A private playlist stays invisible to every other normal user it is not shared with. Tracks from a
  library a user has no access to stay hidden from that user in the table, smart shuffle, export, import
  and the duplicate check, even inside a playlist shared with them.

## Compatibility

Tested with Jellyfin **12.4.0** (server and web client). The plugin is maintained for the current Jellyfin
release only; older Jellyfin versions are not supported. A plugin build targets one Jellyfin version; see
[docs/update-jellyfin.md](docs/update-jellyfin.md) for building it against another one.

- The thumbs-down button comes from the separate plugin
  [Dislike](https://github.com/BriskWatchdogz1/jellyfin-plugin-dislike); both plugins are tested together.
  Dislike also links back to Playlist Toolkit. The automatic playlist "Dislikes" follows Jellyfin's own
  rating, so it works without that plugin too.
- No other plugin is needed. The plugin adds its script to the web client itself while `index.html` is
  served; nothing on disk is modified.
- The table, dialogs and the duplicate warning exist in the web client (browser, and apps that show the
  web client). Image, description and sharing are stored in Jellyfin itself and therefore show up in
  every client.

## Install

1. Download `playlist-toolkit_<version>.zip` from the
   [releases](https://github.com/BriskWatchdogz1/jellyfin-plugin-playlist-toolkit/releases) page.
2. Unpack it into the `plugins` folder of Jellyfin's data directory, so that the folder
   `PlaylistToolkit_<version>/` with `Jellyfin.Plugin.PlaylistToolkit.dll` and `meta.json` lies directly in
   `plugins`. With the linuxserver.io container image, that is `/config/data/plugins` inside the container.
   Give the folder the same owner as the other files there.
3. Restart Jellyfin. The server log shows `Loaded plugin: Playlist Toolkit <version>`.
4. Reload the web client in the browser.

Settings: Dashboard → Plugins → Playlist Toolkit.

To update, remove the old `PlaylistToolkit_…` folder, unpack the new one and restart; only one
`PlaylistToolkit_…` folder may be in `plugins`. Settings are kept.

To remove: Dashboard → Plugins → Playlist Toolkit → Uninstall, then restart Jellyfin. Images,
descriptions and sharing of the playlists stay; they are stored in Jellyfin itself. If the web client no
longer loads, moving the plugin folder out of `plugins` and restarting has the same effect.

## Build

No .NET SDK is needed on the host; the build runs in the official SDK container (Docker).

```sh
./build.sh                          # unit tests, then dist/PlaylistToolkit_<version>/ and dist/playlist-toolkit_<version>.zip
JELLYFIN_VERSION=12.5.0 ./build.sh  # build against another Jellyfin version
```

## Test

A local test server (Jellyfin in Docker, bound to `127.0.0.1:18096`) with generated music and test users:

```sh
python3 testserver/make_music.py      # 2,556 short tagged test tracks
./build.sh                            # the test server needs a build
./testserver/deploy.sh                # copy the build into the server, start it, set it up
                                      # (wizard, users testadmin/alice/bob/carol, 2 libraries)
python3 testserver/test_api.py        # end-to-end checks
python3 testserver/seed_demo.py       # demo playlists for the browser
./testserver/reset.sh                 # start over with an empty server
```

The test tracks are beeps; mute the browser tab when trying playback. The test runs create and delete
2,500-track playlists; after a few dozen runs the test database answers several times slower and the
timing check fails. `./testserver/reset.sh` gives a fresh one. The passwords of the test users are
generated into `testserver/.state/` (ignored by git). The scripts refuse to run against any server that is
not on `localhost`.

## Documentation

- [docs/architecture.md](docs/architecture.md): how it works, API, limits, what depends on Jellyfin internals
- [docs/update-jellyfin.md](docs/update-jellyfin.md): procedure after a Jellyfin update
- [CONTRIBUTING.md](CONTRIBUTING.md): issues and pull requests
- [SECURITY.md](SECURITY.md): reporting a vulnerability

## Credits

**This is AI-written code, and that is not hidden here.** The plugin, the web client part, the test server,
the tests and this documentation were written by Claude (Anthropic), working from my requirements, my bug
reports and my judgement about what the plugin should do: I specified, tested and decided; Claude wrote.
Every design decision, every measurement quoted in the docs and every fix went through that loop. If that
is a dealbreaker for you, you know it before you clone rather than after.

Built on [Jellyfin](https://github.com/jellyfin/jellyfin) and its web client. The feature set answers
long-standing requests in the Jellyfin trackers, among them per-user playlist sharing
([jellyfin-web#4698](https://github.com/jellyfin/jellyfin-web/issues/4698)) and playlist images for owners
([jellyfin-web#5641](https://github.com/jellyfin/jellyfin-web/issues/5641)). This plugin is not affiliated
with or endorsed by the Jellyfin project.

## License

Copyright (C) 2026 BriskWatchdogz1.

GPL-3.0-or-later, see [LICENSE](LICENSE). The plugin links against Jellyfin, which is licensed under the
GPL. It comes without any warranty.
