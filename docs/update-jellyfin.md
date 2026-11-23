# After a Jellyfin update

A plugin build targets one Jellyfin version (`JellyfinVersion` in `Directory.Build.props`, written into
`targetAbi` in `meta.json`).

## What can happen after an update

- **Server part, at start:** Jellyfin loads a plugin whose target version (`targetAbi`) is not newer than
  the server. If the plugin cannot be loaded or its services fail to register, Jellyfin marks it as
  "Malfunctioned" or "NotSupported" and starts without it.
- **Server part, while running:** if an interface the plugin uses is missing only when it is called,
  Jellyfin does not switch the plugin off. The affected plugin functions then answer with an error (in the
  browser: "That did not work (500)"), the rest of Jellyfin keeps running. The start page of the web
  client is protected: if adding the script fails, the plugin serves Jellyfin's unchanged page. If that
  does not help, move the plugin folder out of `plugins` and restart. Image, description and sharing of
  the playlists stay in every case.
- **Web part:** if the web client has changed, single additions (for example the table) are missing;
  Jellyfin's own interface keeps working. The places the script relies on are listed in
  [architecture.md](architecture.md), section "What depends on Jellyfin internals".

## Procedure

1. Check the plugin's status: Dashboard → Plugins → Playlist Toolkit (Active, Malfunctioned or
   NotSupported).
2. Build the plugin against the new version (example 12.5.0; the version must be published as the NuGet
   package `Jellyfin.Controller`). The build runs in a Docker container and runs the unit tests:

   ```sh
   JELLYFIN_VERSION=12.5.0 ./build.sh
   ```

   If the build fails, a server interface has changed; the error message names the place.
3. Set up the test server with the same version. The image name is listed on
   <https://hub.docker.com/r/linuxserver/jellyfin/tags> (for 12.4 it was `version-12.4ubu2604`):

   ```sh
   JELLYFIN_IMAGE=lscr.io/linuxserver/jellyfin:version-12.5ubu2604 ./testserver/reset.sh
   ```

4. Run the checks against the test server (expected: all passed):

   ```sh
   python3 testserver/test_api.py
   ```

   Also check that a heart still changes the automatic playlist "Favoriten" (checks AP3) and that the playlist is
   still read-only (checks AP7): the plugin relies on Jellyfin's permission checks and on playlist visibility through shares.

5. Check the web part in the browser on the test server (`http://localhost:18096`, demo playlists with
   `python3 testserver/seed_demo.py`), with the tab muted (the test tracks are beeps): table visible,
   sorting, filter, clicking a track plays it, smart shuffle (whole playlist in the queue, *Endless*
   shuffles again at the end), image and description, sharing, *Manage all playlists* as administrator,
   the warning when adding a track that is already in the playlist through *Add to playlist*. After a
   change to the plugin, `./testserver/deploy.sh` puts the new build into the test server.
6. If everything works: set `JellyfinVersion` in `Directory.Build.props` to the new version.
7. Stop the test server:

   ```sh
   docker compose --project-directory testserver down
   ```

## When the web part needs changes

The source of the web client is on GitHub (`jellyfin/jellyfin-web`, tag of the version). The places most
likely to change: the details page (`src/apps/legacy/controllers/itemDetails/`), the playlist view
(`src/scripts/playlistViewer.js`) and the *Add to playlist* dialog
(`src/components/playlisteditor/playlisteditor.ts`).
