# Contributing

The code of this plugin was written by Claude (Anthropic). It is maintained for the current Jellyfin
release only.

- **Bugs and ideas:** open an issue through one of the two forms (bug report, feature request) on
  <https://github.com/BriskWatchdogz1/jellyfin-plugin-playlist-toolkit/issues>. Say which Jellyfin and
  plugin version you run and which client (browser, app).
- **Security problems:** not in a public issue; see [SECURITY.md](SECURITY.md).
- **Pull requests:** small, focused changes are welcome. Discuss larger changes in an issue first. There
  is no promise that a pull request is merged.

## Before a pull request

- `./build.sh` must pass: it builds with warnings as errors and runs the unit tests.
- Changes to the API or the web client part: run `python3 testserver/test_api.py` against the local test
  server (see the README, section "Test"), and try the change in the browser on the test server.
- Settings belong in `Configuration/PluginConfiguration.cs`, not as fixed values in the code.
- Every write in the API checks the caller's rights on the playlist; keep it that way, and add a check to
  `testserver/test_api.py` for a new endpoint.
- Places that depend on Jellyfin internals are listed in [docs/architecture.md](docs/architecture.md);
  update that list when you add one.
