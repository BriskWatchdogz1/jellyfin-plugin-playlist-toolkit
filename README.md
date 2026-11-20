# Playlist Toolkit for Jellyfin

A Jellyfin server plugin that lets the **owner of a playlist do everything with it** without being an
administrator, and makes long music playlists usable in the web client.

The code of this plugin was written by Claude (Anthropic), an AI model, and is provided as is.

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | Set, replace and remove the playlist image as the owner (stock Jellyfin: administrators only) | Playlist page → `…` → *Image and description* |
| 2 | Track table with the columns title, artist, album, duration; click a header to sort (third click returns to playlist order) | Playlist page |
| 3 | Share a playlist with selected users, per user "can listen" or "can edit", plus the stock "public" switch | Playlist page → `…` → *Share* |
| 4 | Smart shuffle: never the same artist twice in a row, recently played tracks last. The whole playlist is queued. With *Endless* (default on, remembered per user) the playlist is shuffled again when it is through and keeps playing. Since 1.2.0.0 it also leaves out songs the user disliked (setting *Smart shuffle leaves out songs the user disliked*, default on) | Playlist page → *Smart shuffle*, switch *Endless* |
| 5 | Warning before adding tracks that are already in the playlist, with a choice per track | Stock *Add to playlist* dialog |
| 6 | Description text for a playlist | Playlist page → `…` → *Image and description* |
| 7 | Filter inside a playlist; M3U export and import | Playlist page |
| 8 | Administrators open every playlist of every user, also private ones: image, description, sharing, tracks | Dashboard → Plugins → Playlist Toolkit → *Manage all playlists*, or `…` → *All playlists (admin)* on a playlist page |

The table only keeps the visible rows in the page, so playlists with thousands of tracks scroll, sort and
filter without delay (measured with 2,500 tracks: rows load in 0.2 s, sorting takes 10 ms).

Playlist Toolkit does not touch Jellyfin's *Instant Mix* or its stock *Shuffle* button; the stock *Shuffle* button is
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
  Dislike also links back to Playlist Toolkit.
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
