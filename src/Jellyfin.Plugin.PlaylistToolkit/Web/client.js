/*
 * Playlist Toolkit - web client part.
 *
 * Loaded into jellyfin-web by the plugin's script injection. It only uses what the web client exposes
 * globally (window.ApiClient, the "viewshow" DOM event, the details page markup) plus the plugin's own
 * API under /PlaylistToolkit. It is written against jellyfin-web 12.4; see docs/architecture.md for the
 * places that depend on stock markup.
 */
(function () {
    'use strict';

    // Pure queue rules, unit tested with Node (tests/js). The browser part below uses them.
    var core = {
        // Splits a leading article (a whole first word from the list, case-insensitive) off an artist name.
        splitArticle: function (name, articles) {
            var text = String(name || '').trim();
            var space = text.indexOf(' ');
            if (space <= 0 || !articles.length) {
                return null;
            }
            var first = text.slice(0, space);
            var rest = text.slice(space + 1).trim();
            var known = articles.some(function (article) { return article.toLowerCase() === first.toLowerCase(); });
            return rest && known ? { article: first, rest: rest } : null;
        },
        // Entries the player's queue holds that this session appended (ids of queue entries).
        ownedEntries: function (queue, entryIds) {
            return queue.filter(function (entry) { return entryIds.indexOf(entry.PlaylistItemId) >= 0; });
        },
        // The entries that a part of ids added to the queue: whatever is new in the queue after the call.
        // Tolerant on purpose: another script removing or inserting entries meanwhile must not end the session.
        addedEntries: function (before, after, part) {
            var known = {};
            before.forEach(function (entry) { known[entry.PlaylistItemId] = true; });
            return after.filter(function (entry) { return !known[entry.PlaylistItemId] && part.indexOf(entry.Id) >= 0; });
        },
        // Entries of the session that are still in the queue (not the running one) although their track is
        // no longer in the playlist: they must not play any more.
        // includeCurrent: the running entry counts too (used when a track starts: it was removed meanwhile).
        // skipTracks: ids of tracks that must not play (disliked, or taken out of the queue by the user); keepEntry: an
        // entry the user started on purpose, which is never stale.
        staleEntries: function (queue, current, entryIds, playlistIds, includeCurrent, skipTracks, keepEntry) {
            var inList = {};
            playlistIds.forEach(function (id) { inList[normalize(id)] = true; });
            var skip = {};
            (skipTracks || []).forEach(function (id) { skip[normalize(id)] = true; });
            return queue.filter(function (entry, index) {
                return (index > current || (includeCurrent === true && index === current))
                    && entryIds.indexOf(entry.PlaylistItemId) >= 0 && entry.PlaylistItemId !== keepEntry
                    && (!inList[normalize(entry.Id)] || skip[normalize(entry.Id)]);
            });
        }
    };

    function normalize(id) {
        return String(id || '').replace(/-/g, '').toLowerCase();
    }

    if (typeof module === 'object' && module && module.exports) {
        module.exports = core;
        return;
    }

    if (window.__playlistToolkit) {
        return;
    }

    var LOG = '[PlaylistToolkit]';
    var SCRIPT_VERSION = '__PT_VERSION__'; // replaced by the server with the plugin version it serves
    var originalFetch = window.fetch.bind(window);

    // ------------------------------------------------------------------ texts

    var STRINGS = {
        en: {
            colTitle: 'Title', colArtist: 'Artist', colAlbum: 'Album', colDuration: 'Duration',
            smartShuffle: 'Smart shuffle', smartShuffleHint: 'Shuffle without the same artist twice in a row; recently played tracks come last',
            filter: 'Filter this playlist', tracks: '{0} tracks', tracksFiltered: '{0} of {1} tracks',
            more: 'Playlist options', editDetails: 'Image and description', share: 'Share', exportM3u: 'Export as M3U',
            importM3u: 'Import M3U', classicView: 'Classic list view', tableView: 'Table view',
            classicHint: 'Classic list (drag and drop, full context menu).',
            playFromHere: 'Play from here', playNext: 'Play next', addToQueue: 'Add to queue', openAlbum: 'Go to album',
            remove: 'Remove from playlist', moveTop: 'Move to top', moveUp: 'Move up', moveDown: 'Move down', moveBottom: 'Move to bottom',
            queued: '{0} tracks queued', queuedTruncated: '{0} tracks queued (queue limit; {1} more left out)',
            noSession: 'Playback could not be started: this browser has no live connection to the server. Reload the page and try again.',
            failed: 'That did not work ({0}).', empty: 'This playlist is empty.', noMatch: 'No track matches the filter.',
            save: 'Save', cancel: 'Cancel', close: 'Close',
            image: 'Image', chooseImage: 'Choose image', removeImage: 'Remove image', imageHint: 'JPEG, PNG, WebP or GIF, at most {0} MB.',
            imageTooBig: 'The image is larger than {0} MB.', imageType: 'This file type is not supported.',
            description: 'Description', saved: 'Saved', owner: 'Owner: {0}',
            shareTitle: 'Share "{0}"', sharePublic: 'Visible to all users (listen only)', shareNone: 'No access', shareListen: 'Can listen', shareEdit: 'Can edit',
            shareHint: 'Users with "Can edit" may add, remove and reorder tracks.', noUsers: 'There are no other users.',
            dupTitle: 'Already in "{0}"', dupIntro: '{0} of {1} tracks are already in this playlist. Tick the ones you want to add anyway.',
            dupExact: 'already in the playlist', dupSimilar: 'same song from another album ({0})',
            dupAdd: 'Add', dupAddAll: 'Add all', dupNothing: 'Nothing was added.', dupAdded: '{0} added, {1} skipped',
            importTitle: 'Import M3U', importFile: 'M3U file', importNew: 'Create a new playlist', importAppend: 'Append to "{0}"', importName: 'Name of the new playlist',
            importRun: 'Import', importResult: '{0} of {1} entries were found in the library.', importUnmatched: 'Not found:', importNone: 'No entry was found in the library; nothing was created.',
            open: 'Open playlist',
            endless: 'Endless', endlessHint: 'When the smart shuffle order is through, shuffle again and keep playing',
            reshuffled: 'Shuffled again, {0} more tracks queued',
            allPlaylists: 'All playlists (admin)', adminFilter: 'Filter by name or owner', adminNone: 'No playlist found.',
            adminNoTable: 'The tracks are not listed here: this is a video playlist, or the track table is switched off in the settings. Image, description and sharing are in the … menu.',
            back: 'Back to the list', noOwner: 'no owner', visPrivate: 'private', visShared: 'shared with {0}', visPublic: 'public',
            autoHintFavorites: 'Filled automatically from your favourites. Remove a song with its heart.',
            autoHintDislikes: 'Filled automatically from your dislikes. Remove a song by taking back its dislike.',
            removeFavorite: 'Remove from favourites', removeDislike: 'Remove dislike', autoOwner: 'automatic ({0})',
            articlesOn: 'Articles behind artist names: on', articlesOff: 'Articles behind artist names: off', queueHistory: 'Recently played', queueLoading: 'Loading …', queueNext: 'Up next', queuePlayNow: 'Play now, right after the running track', queuePlaying: 'Playing "{0}"', colFavorite: 'Favourite', addFavorite: 'Add to favourites', colDislike: 'Dislike', addDislike: 'Dislike (skipped for you, stays in the playlist)',
            smartShuffleOn: 'Smart shuffle on', smartShuffleOnHint: 'The running queue is a smart shuffle of this playlist. A click on a track starts it and shuffles the rest.',
            queueButton: 'Queue', queueHint: 'Show what plays next and what was just played',
            heartPlaylistNote: 'This heart marks the playlist itself. Songs are not added to "Favoriten": use the heart in the song rows.',
            addToPlaylist: 'Add to playlist', plTitle: 'Playlists', plIntro: 'Tick the playlists "{0}" should be in. Nothing changes until you confirm.',
            plSimilar: 'same song from another album ({0})', plCount: '{0} tracks', plOwner: 'by {0}', plNone: 'You have no playlist you can edit.',
            plNew: 'New playlist with this song', plNewName: 'Name of the new playlist', plConfirm: 'Confirm',
            plDone: '{0} added, {1} removed', plNoChange: 'Nothing changed.', plSomeFailed: '{0} playlists could not be changed.'
        },
        de: {
            colTitle: 'Titel', colArtist: 'Interpret', colAlbum: 'Album', colDuration: 'Dauer',
            smartShuffle: 'Smart Shuffle', smartShuffleHint: 'Zufallswiedergabe ohne denselben Interpreten zweimal hintereinander; kürzlich Gehörtes kommt zuletzt',
            filter: 'In dieser Playlist filtern', tracks: '{0} Titel', tracksFiltered: '{0} von {1} Titeln',
            more: 'Playlist-Optionen', editDetails: 'Bild und Beschreibung', share: 'Teilen', exportM3u: 'Als M3U exportieren',
            importM3u: 'M3U importieren', classicView: 'Klassische Listenansicht', tableView: 'Tabellenansicht',
            classicHint: 'Klassische Liste (Ziehen und Ablegen, volles Kontextmenü).',
            playFromHere: 'Ab hier abspielen', playNext: 'Als Nächstes abspielen', addToQueue: 'Zur Warteschlange hinzufügen', openAlbum: 'Zum Album',
            remove: 'Aus Playlist entfernen', moveTop: 'Ganz nach oben', moveUp: 'Nach oben', moveDown: 'Nach unten', moveBottom: 'Ganz nach unten',
            queued: '{0} Titel in der Warteschlange', queuedTruncated: '{0} Titel in der Warteschlange (Obergrenze; {1} weitere ausgelassen)',
            noSession: 'Die Wiedergabe ließ sich nicht starten: Dieser Browser hat keine laufende Verbindung zum Server. Seite neu laden und erneut versuchen.',
            failed: 'Das hat nicht geklappt ({0}).', empty: 'Diese Playlist ist leer.', noMatch: 'Kein Titel passt zum Filter.',
            save: 'Speichern', cancel: 'Abbrechen', close: 'Schließen',
            image: 'Bild', chooseImage: 'Bild auswählen', removeImage: 'Bild entfernen', imageHint: 'JPEG, PNG, WebP oder GIF, höchstens {0} MB.',
            imageTooBig: 'Das Bild ist größer als {0} MB.', imageType: 'Dieser Dateityp wird nicht unterstützt.',
            description: 'Beschreibung', saved: 'Gespeichert', owner: 'Besitzer: {0}',
            shareTitle: '„{0}“ teilen', sharePublic: 'Für alle Nutzer sichtbar (nur hören)', shareNone: 'Kein Zugriff', shareListen: 'Darf hören', shareEdit: 'Darf bearbeiten',
            shareHint: 'Nutzer mit „Darf bearbeiten“ können Titel hinzufügen, entfernen und umsortieren.', noUsers: 'Es gibt keine anderen Nutzer.',
            dupTitle: 'Schon in „{0}“', dupIntro: '{0} von {1} Titeln sind schon in dieser Playlist. Haken setzen, um sie trotzdem hinzuzufügen.',
            dupExact: 'schon in der Playlist', dupSimilar: 'gleiches Lied von einem anderen Album ({0})',
            dupAdd: 'Hinzufügen', dupAddAll: 'Alle hinzufügen', dupNothing: 'Nichts hinzugefügt.', dupAdded: '{0} hinzugefügt, {1} übersprungen',
            importTitle: 'M3U importieren', importFile: 'M3U-Datei', importNew: 'Neue Playlist anlegen', importAppend: 'An „{0}“ anhängen', importName: 'Name der neuen Playlist',
            importRun: 'Importieren', importResult: '{0} von {1} Einträgen wurden in der Bibliothek gefunden.', importUnmatched: 'Nicht gefunden:', importNone: 'Kein Eintrag wurde in der Bibliothek gefunden; es wurde nichts angelegt.',
            open: 'Playlist öffnen',
            endless: 'Endlos', endlessHint: 'Ist die Smart-Shuffle-Reihenfolge durch, neu mischen und weiterspielen',
            reshuffled: 'Neu gemischt, {0} weitere Titel in der Warteschlange',
            allPlaylists: 'Alle Playlists (Admin)', adminFilter: 'Nach Name oder Besitzer filtern', adminNone: 'Keine Playlist gefunden.',
            adminNoTable: 'Die Titel werden hier nicht aufgelistet: Das ist eine Video-Playlist, oder die Titeltabelle ist in den Einstellungen abgeschaltet. Bild, Beschreibung und Teilen stehen im Menü ….',
            back: 'Zurück zur Liste', noOwner: 'kein Besitzer', visPrivate: 'privat', visShared: 'geteilt mit {0}', visPublic: 'öffentlich',
            autoHintFavorites: 'Wird automatisch aus deinen Favoriten gefüllt. Einen Titel entfernst du mit seinem Herz.',
            autoHintDislikes: 'Wird automatisch aus deinen Dislikes gefüllt. Einen Titel entfernst du, indem du sein Dislike zurücknimmst.',
            removeFavorite: 'Aus Favoriten entfernen', removeDislike: 'Dislike entfernen', autoOwner: 'automatisch ({0})',
            articlesOn: 'Artikel hinter dem Interpreten: an', articlesOff: 'Artikel hinter dem Interpreten: aus', queueHistory: 'Zuletzt gehört', queueLoading: 'Lädt …', queueNext: 'Als Nächstes', queuePlayNow: 'Sofort abspielen, direkt nach dem laufenden Lied', queuePlaying: '„{0}“ wird abgespielt', colFavorite: 'Favorit', addFavorite: 'Zu Favoriten hinzufügen', colDislike: 'Dislike', addDislike: 'Dislike (wird für dich übersprungen, bleibt in der Playlist)',
            smartShuffleOn: 'Smart Shuffle an', smartShuffleOnHint: 'Die laufende Warteschlange ist ein Smart Shuffle dieser Playlist. Ein Klick auf ein Lied startet es und mischt den Rest.',
            queueButton: 'Warteschlange', queueHint: 'Zeigt, was als Nächstes kommt und was gerade lief',
            heartPlaylistNote: 'Dieses Herz markiert die Playlist selbst. Lieder kommen dadurch nicht in „Favoriten“: dafür das Herz in den Liedzeilen benutzen.',
            addToPlaylist: 'Zur Playlist hinzufügen', plTitle: 'Playlists', plIntro: 'Haken setzen bei den Playlists, in denen „{0}“ liegen soll. Erst „Bestätigen“ ändert etwas.',
            plSimilar: 'gleiches Lied von einem anderen Album ({0})', plCount: '{0} Titel', plOwner: 'von {0}', plNone: 'Du hast keine Playlist, die du bearbeiten darfst.',
            plNew: 'Neue Playlist mit diesem Lied', plNewName: 'Name der neuen Playlist', plConfirm: 'Bestätigen',
            plDone: '{0} hinzugefügt, {1} entfernt', plNoChange: 'Nichts geändert.', plSomeFailed: '{0} Playlists ließen sich nicht ändern.'
        }
    };

    function t(key) {
        var lang = (document.documentElement.getAttribute('lang') || navigator.language || 'en').toLowerCase().slice(0, 2);
        var text = (STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key] || key;
        var args = arguments;
        return text.replace(/\{(\d)\}/g, function (_, n) { return String(args[Number(n) + 1]); });
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatDuration(ticks) {
        if (!ticks) {
            return '';
        }
        var total = Math.round(ticks / 10000000);
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ------------------------------------------------------------------ table columns
    //
    // To add a column: add the field to TrackRowDto on the server and one entry here.
    //   text(row)       cell text (also used for sorting unless sortValue is given)
    //   sortValue(row)  number to sort by
    //   link(row)       optional href
    //   hideBelow       hide the column when the table is narrower than this many pixels
    // Below NARROW_WIDTH the title cell shows the artist as a second line (phone layout).

    // "The Pretty Reckless" is shown as "Pretty Reckless, The" (only a whole first word from the server's list of
    // articles; a per-user setting, default on). Sorting by the artist column ignores the article either way.
    var articleState = { list: [], on: true };

    function splitArticle(name) {
        return core.splitArticle(name, articleState.list);
    }

    function artistLabel(name) {
        var split = articleState.on ? splitArticle(name) : null;
        return split ? split.rest + ', ' + split.article : String(name || '');
    }

    function artistsLabel(names) {
        var list = names || [];
        var moved = articleState.on && list.some(function (name) { return splitArticle(name); });
        return list.map(artistLabel).join(moved ? '; ' : ', ');
    }

    function artistSortText(names) {
        return (names || []).map(function (name) { var split = splitArticle(name); return split ? split.rest : String(name || ''); }).join(', ');
    }

    var NARROW_WIDTH = 480;

    var COLUMNS = [
        { id: 'index', label: '#', width: '3.4em', align: 'right', hideBelow: 480, sortValue: function (r) { return r.Index; }, text: function (r) { return String(r.Index + 1); } },
        { id: 'title', labelKey: 'colTitle', width: 'minmax(6em, 3fr)', text: function (r) { return r.Name; } },
        { id: 'artist', labelKey: 'colArtist', width: 'minmax(4em, 2fr)', hideBelow: 480, html: function (r) { return artistLinks(r.Artists || []); }, text: function (r) { return artistsLabel(r.Artists); }, sortText: function (r) { return artistSortText(r.Artists); } },
        {
            id: 'album', labelKey: 'colAlbum', width: 'minmax(5em, 2fr)', hideBelow: 640,
            text: function (r) { return r.Album || ''; },
            link: function (r) { return r.AlbumId ? '#/details?id=' + r.AlbumId + '&serverId=' + api().serverId() : null; }
        },
        { id: 'duration', labelKey: 'colDuration', width: '4.6em', align: 'right', sortValue: function (r) { return r.RunTimeTicks || 0; }, text: function (r) { return formatDuration(r.RunTimeTicks); } },
        // The heart of the calling user (favourite). Rendered as a button, sorted favourites first.
        { id: 'fav', labelKey: 'colFavorite', icon: 'favorite', width: '2.4em', align: 'center', sortValue: function (r) { return r.IsFavorite ? 0 : 1; }, text: function (r) { return r.IsFavorite ? '1' : ''; } },
        // The thumb down of the calling user: the song stays in the playlist and is skipped in this user's queue.
        { id: 'dislike', labelKey: 'colDislike', icon: 'thumb_down', width: '2.4em', align: 'center', sortValue: function (r) { return r.IsDisliked ? 0 : 1; }, text: function (r) { return r.IsDisliked ? '1' : ''; } }
    ];

    // ------------------------------------------------------------------ server access

    function api() {
        return window.ApiClient;
    }

    function request(method, path, options) {
        options = options || {};
        var headers = {};
        api().setRequestHeaders(headers);
        var body;
        if (options.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.json);
        } else if (options.raw) {
            headers['Content-Type'] = options.contentType;
            body = options.raw;
        }

        return originalFetch(api().getUrl((options.stock ? '' : 'PlaylistToolkit/') + path, options.query), { method: method, headers: headers, body: body, credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok) {
                    return response.text().catch(function () { return ''; }).then(function (text) {
                        var error = new Error(method + ' ' + path + ' -> ' + response.status);
                        error.status = response.status;
                        error.body = text;
                        throw error;
                    });
                }
                if (response.status === 204) {
                    return null;
                }
                if (options.blob) {
                    return response.blob();
                }
                return (response.headers.get('content-type') || '').indexOf('json') >= 0 ? response.json() : response.text();
            });
    }

    // Cached per user: after a user switch without a page reload the rights differ.
    var configCache = { userId: null, promise: null };
    function getConfig() {
        var userId = api().getCurrentUserId();
        if (!configCache.promise || configCache.userId !== userId) {
            var entry = { userId: userId, promise: null };
            entry.promise = request('GET', 'Config').then(function (config) {
                checkVersion(config);
                return config;
            }).catch(function (error) {
                if (configCache === entry) {
                    configCache = { userId: null, promise: null };
                }
                throw error;
            });
            configCache = entry;
        }
        return configCache.promise;
    }

    // The server is newer than this script (an old page or script stayed in the browser's cache after a plugin update):
    // fetch the page afresh and reload, once per version.
    function checkVersion(config) {
        if (!config || !config.Version || SCRIPT_VERSION.indexOf('__') === 0 || config.Version === SCRIPT_VERSION) {
            return;
        }
        var key = 'pt-reloaded-' + config.Version;
        try {
            if (window.sessionStorage.getItem(key)) {
                return;
            }
            window.sessionStorage.setItem(key, '1');
        } catch (error) {
            return;
        }
        console.warn(LOG, 'the page runs script ' + SCRIPT_VERSION + ', the server has ' + config.Version + '; reloading');
        originalFetch(window.location.pathname, { cache: 'reload' }).catch(function () { }).then(function () { window.location.reload(); });
    }

    function reportError(error) {
        console.error(LOG, error);
        toast(error && error.status === 409 ? t('noSession') : t('failed', error && error.status ? error.status : (error && error.message) || '?'));
    }

    // ------------------------------------------------------------------ small UI helpers

    function ensureStyle() {
        if (document.getElementById('pt-style')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'pt-style';
        style.textContent = [
            '.pt-root{margin:.5em 0 2em;font-size:inherit}',
            '.pt-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.6em;margin-bottom:.8em}',
            '.pt-toolbar .pt-summary{opacity:.7;margin-left:auto;white-space:nowrap}',
            '.pt-filter{flex:1 1 12em;max-width:22em;min-width:8em}',
            '.pt-btn{display:inline-flex;align-items:center;gap:.35em;cursor:pointer;border:0;border-radius:.3em;padding:.55em .9em;font:inherit;color:inherit;background:rgba(128,128,128,.25)}',
            '.pt-btn:hover,.pt-btn:focus-visible{background:rgba(128,128,128,.45)}',
            '.pt-btn.pt-primary{background:#00a4dc;color:#fff}.pt-btn.pt-primary:hover{background:#0cb0e8}',
            '.pt-btn[disabled]{opacity:.5;cursor:default}',
            '.pt-iconbtn{cursor:pointer;border:0;background:none;color:inherit;padding:.25em;border-radius:50%;line-height:1;font-size:1.25em}',
            '.pt-iconbtn:hover,.pt-iconbtn:focus-visible{background:rgba(128,128,128,.35)}',
            '.pt-head,.pt-row{display:grid;grid-template-columns:var(--pt-cols);align-items:center;column-gap:.8em;padding:0 .4em;box-sizing:border-box}',
            '.pt-head{position:sticky;top:var(--pt-sticky,0px);z-index:3;height:2.6em;border-bottom:1px solid rgba(128,128,128,.35);background:var(--pt-bg,#101010);font-weight:600}',
            '.pt-th{cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:none;border:0;color:inherit;font:inherit;font-weight:600;padding:.3em 0;text-align:left}',
            '.pt-th:hover,.pt-th:focus-visible{text-decoration:underline}',
            '.pt-th .pt-arrow{opacity:.8;font-size:.85em;margin-left:.25em}',
            '.pt-right{text-align:right;justify-self:stretch}',
            '.pt-body{position:relative}',
            '.pt-row{position:absolute;left:0;right:0;height:var(--pt-rowh);cursor:pointer;border-bottom:1px solid rgba(128,128,128,.12)}',
            '.pt-row:hover{background:rgba(128,128,128,.18)}',
            '.pt-cell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
            '.pt-cell a{color:inherit;text-decoration:none}.pt-cell a:hover{text-decoration:underline}',
            '.pt-dim{opacity:.75}',
            '.pt-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pt-line.pt-dim{font-size:.9em}',
            '.pt-narrow .pt-head,.pt-narrow .pt-row{column-gap:.5em;padding:0 .1em}',
            '.pt-row .pt-play{display:none}.pt-row:hover .pt-play{display:inline}.pt-row:hover .pt-num{display:none}',
            '.pt-message{padding:1.5em .4em;opacity:.75}',
            '.pt-menu{position:fixed;z-index:10000001;min-width:13em;max-width:90vw;padding:.3em 0;border-radius:.3em;background:var(--pt-bg,#202020);color:var(--pt-fg,#fff);box-shadow:0 .2em 1em rgba(0,0,0,.6);border:1px solid rgba(128,128,128,.35)}',
            '.pt-menu button{display:flex;align-items:center;gap:.7em;width:100%;padding:.6em 1em;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
            '.pt-menu button:hover,.pt-menu button:focus-visible{background:rgba(128,128,128,.3)}',
            '.pt-menu hr{border:0;border-top:1px solid rgba(128,128,128,.3);margin:.3em 0}',
            '.pt-overlay{position:fixed;inset:0;z-index:10000000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:1em}',
            '.pt-dialog{width:34em;max-width:100%;max-height:92vh;overflow:auto;border-radius:.4em;padding:1.2em 1.4em;background:var(--pt-bg,#202020);color:var(--pt-fg,#fff);box-shadow:0 .4em 2em rgba(0,0,0,.7)}',
            '.pt-dialog h2{margin:0 0 .8em;font-size:1.3em}',
            '.pt-dialog label{display:block;margin:.9em 0 .3em}',
            '.pt-dialog .pt-hint{opacity:.7;font-size:.9em;margin:.3em 0}',
            '.pt-auto-hint{opacity:.7;margin:.2em 0 .8em}',
            '.pt-input{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:rgba(128,128,128,.2);border:1px solid rgba(128,128,128,.45);border-radius:.25em;padding:.5em .6em}',
            '.pt-input:focus{outline:2px solid #00a4dc;outline-offset:0}',
            'select.pt-input option{color:#000;background:#fff}',
            'textarea.pt-input{min-height:7em;resize:vertical}',
            '.pt-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.6em;margin-top:1.3em}',
            '.pt-imgrow{display:flex;gap:1em;align-items:flex-start;flex-wrap:wrap}',
            '.pt-preview{width:9em;height:9em;border-radius:.3em;background:rgba(128,128,128,.25) center/cover no-repeat;flex:none}',
            '.pt-sharerow{display:flex;align-items:center;gap:1em;padding:.35em 0}.pt-sharerow span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.pt-sharerow select{width:12em;flex:none}',
            '.pt-check{display:flex!important;align-items:flex-start;gap:.6em;cursor:pointer}.pt-check input{margin-top:.25em;flex:none;width:1.1em;height:1.1em}',
            '.pt-list{max-height:40vh;overflow:auto;margin:.6em 0;border:1px solid rgba(128,128,128,.3);border-radius:.25em;padding:.2em .7em}',
            '.pt-root label.pt-endless{display:inline-flex;align-items:center;gap:.4em;margin:0;cursor:pointer;white-space:nowrap;user-select:none}.pt-endless input{width:1.1em;height:1.1em;margin:0}',
            '.pt-dialog.pt-wide{width:72em;height:92vh;display:flex;flex-direction:column;overflow:hidden;padding-bottom:0}',
            '.pt-wide .pt-admin-head{display:flex;align-items:center;gap:.8em;flex:none}.pt-wide .pt-admin-head h2{margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.pt-wide .pt-admin-body{flex:1;min-height:0;overflow:auto;margin-top:.8em;padding-bottom:1.2em}',
            '.pt-admin-item{display:grid;grid-template-columns:minmax(8em,3fr) minmax(5em,1fr) 6em minmax(6em,1.5fr);gap:.8em;align-items:center;width:100%;padding:.65em .5em;border:0;border-bottom:1px solid rgba(128,128,128,.2);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
            '.pt-admin-item:hover,.pt-admin-item:focus-visible{background:rgba(128,128,128,.2)}.pt-admin-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.pt-heart{font-size:1.15em}.pt-heart.pt-on{color:#e91e63}.pt-dislike.pt-on{color:#ff9800}.pt-center{text-align:center;justify-self:center}',
            '.pt-btn.pt-active{background:#00a4dc;color:#fff;box-shadow:0 0 0 2px #fff inset}',
            '.pt-link{color:inherit;text-decoration:none}.pt-link:hover,.pt-link:focus-visible{text-decoration:underline}',
            // Queue page: player on top, two framed areas below, each with its own scroll bar; the page itself does not scroll.
            '.pt-q-on .remoteControlContent{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);gap:.6em 1.2em;overflow:hidden;box-sizing:border-box;padding-bottom:.5em}',
            '.pt-q-on .nowPlayingInfoContainer{grid-column:1 / -1;grid-row:1;max-height:230px;overflow:hidden}',
            '.pt-q-on .pt-q-hist{grid-column:1;grid-row:2}.pt-q-on .playlistSection{grid-column:2;grid-row:2;margin:0}',
            '@media (max-width:900px){.pt-q-on .remoteControlContent{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) minmax(0,1fr)}.pt-q-on .pt-q-hist{grid-column:1;grid-row:2}.pt-q-on .playlistSection{grid-column:1;grid-row:3}}',
            '.pt-q-pane,.pt-q-on .playlistSection{display:flex;flex-direction:column;min-height:0;min-width:0;position:relative;box-sizing:border-box;border:1px solid rgba(128,128,128,.4);border-radius:.4em;padding:.2em .6em .4em}',
            '.pt-q-title{margin:.3em 0 .2em;font-size:1.2em;font-weight:600;flex:none}',
            '.pt-q-scroll,.pt-q-on .playlistSection .playlist{flex:1 1 0;min-height:0;overflow-y:auto;overflow-anchor:none}',
            '.pt-q-on .playlistSection .playlist{margin:0!important;width:100%;max-width:none;align-self:stretch}',
            '.pt-q-on .playlistSection .playlist>.listItem,.pt-q-scroll .listItem{flex:none}',
            '.pt-q-loading{position:absolute;top:.5em;right:.8em;opacity:.7;font-size:.9em}',
            '.pt-q-row{cursor:pointer}.pt-q-row:hover{background:rgba(128,128,128,.2)}.pt-q-row .listItemBody{flex:1;min-width:0}.pt-q-when{opacity:.55;font-size:.85em;margin-left:.4em;white-space:nowrap}',
            '@keyframes pt-flash{0%{background:rgba(0,164,220,.55)}100%{background:transparent}}.pt-q-flash{animation:pt-flash 2.5s ease-out}',
            '.pt-toast{position:fixed;left:50%;bottom:6em;transform:translateX(-50%);z-index:10000002;max-width:90vw;padding:.8em 1.2em;border-radius:.3em;background:#303030;color:#fff;box-shadow:0 .2em 1em rgba(0,0,0,.6)}',
            // Stock dialogs sit at z-index 999999 and the loading spinner at 9999999; the duplicate dialog must cover both.
            '.pt-hidden{display:none!important}'
        ].join('\n');
        document.head.appendChild(style);
    }

    var toastTimer = null;
    function toast(message) {
        ensureStyle();
        var element = document.querySelector('.pt-toast');
        if (!element) {
            element = document.createElement('div');
            element.className = 'pt-toast';
            element.setAttribute('role', 'status');
            document.body.appendChild(element);
        }
        element.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { element.remove(); }, 5000);
    }

    // Takes text and background colour from the page so dialogs follow the active theme.
    function themeColors(target) {
        var fg = getComputedStyle(document.body).color || '#fff';
        var bg = null;
        var probes = [document.querySelector('.backgroundContainer'), document.body, document.documentElement];
        for (var i = 0; i < probes.length && !bg; i++) {
            var color = probes[i] && getComputedStyle(probes[i]).backgroundColor;
            if (color && color !== 'transparent' && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(color)) {
                bg = color;
            }
        }
        target.style.setProperty('--pt-bg', bg || '#202020');
        target.style.setProperty('--pt-fg', fg);
    }

    function closeMenu() {
        var menu = document.querySelector('.pt-menu');
        if (menu) {
            menu.remove();
        }
    }

    // items: [{label, icon, run}] or null for a separator.
    function showMenu(anchor, items) {
        closeMenu();
        ensureStyle();
        var menu = document.createElement('div');
        menu.className = 'pt-menu';
        menu.setAttribute('role', 'menu');
        themeColors(menu);
        items.forEach(function (item) {
            if (!item) {
                menu.appendChild(document.createElement('hr'));
                return;
            }
            var button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.innerHTML = '<span class="material-icons ' + esc(item.icon) + '" aria-hidden="true"></span><span>' + esc(item.label) + '</span>';
            button.addEventListener('click', function () {
                closeMenu();
                item.run();
            });
            menu.appendChild(button);
        });
        document.body.appendChild(menu);
        var rect = anchor.getBoundingClientRect();
        var left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
        var top = rect.bottom + 4;
        if (top + menu.offsetHeight > window.innerHeight - 8) {
            top = Math.max(8, rect.top - menu.offsetHeight - 4);
        }
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top = top + 'px';
        var first = menu.querySelector('button');
        if (first) {
            first.focus();
        }
    }

    document.addEventListener('click', function (event) {
        if (!event.target.closest || (!event.target.closest('.pt-menu') && !event.target.closest('[data-pt-menu]'))) {
            closeMenu();
        }
    }, true);
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });

    var dialogStack = [];

    // Opens a modal dialog. build(dialog, close) fills it. Returns a promise resolved with the value passed to close().
    function openDialog(title, build) {
        ensureStyle();
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'pt-overlay';
            var dialog = document.createElement('div');
            dialog.className = 'pt-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-label', title);
            themeColors(dialog);
            dialog.innerHTML = '<h2>' + esc(title) + '</h2>';
            overlay.appendChild(dialog);

            var previousFocus = document.activeElement;
            function close(value) {
                document.removeEventListener('keydown', onKey, true);
                dialogStack = dialogStack.filter(function (entry) { return entry !== overlay; });
                overlay.remove();
                if (previousFocus && previousFocus.focus) {
                    previousFocus.focus();
                }
                resolve(value);
            }
            function onKey(event) {
                // Dialogs can be stacked (admin view, then a share dialog): Escape closes the top one only.
                if (event.key === 'Escape' && dialogStack[dialogStack.length - 1] === overlay && !document.querySelector('.pt-menu')) {
                    event.stopPropagation();
                    close(undefined);
                }
            }
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('mousedown', function (event) {
                if (event.target === overlay) {
                    close(undefined);
                }
            });

            build(dialog, close);
            dialogStack.push(overlay);
            document.body.appendChild(overlay);
            var focusable = dialog.querySelector('input,select,textarea,button');
            if (focusable) {
                focusable.focus();
            }
        });
    }

    function button(label, className, icon) {
        var element = document.createElement('button');
        element.type = 'button';
        element.className = 'pt-btn' + (className ? ' ' + className : '');
        element.innerHTML = (icon ? '<span class="material-icons ' + icon + '" aria-hidden="true"></span>' : '') + '<span>' + esc(label) + '</span>';
        return element;
    }

    function actions(dialog) {
        var row = document.createElement('div');
        row.className = 'pt-actions';
        dialog.appendChild(row);
        return row;
    }

    // Makes the stock page load the item again (new image, description, name) without a history entry.
    function reloadView() {
        var hash = window.location.hash.replace(/[?&]pp=\d+/, '');
        window.location.replace(hash + (hash.indexOf('?') >= 0 ? '&' : '?') + 'pp=' + Date.now());
    }

    // ------------------------------------------------------------------ playback
    //
    // The whole list is played: the first part starts at once, the rest is appended to the player's queue
    // in parts while the music already runs. One request of the web player can only carry about 227 track
    // ids (URL length), hence the parts. This needs the web client's own player object ("playbackManager"),
    // which is not exposed globally; it is looked up in the client's module registry. If that ever fails,
    // playback falls back to a server-sent play command, which is limited to one part.

    var PLAYER_MARKER = 'Remote players are disabled'; // a text that only the player module contains
    var EXTEND_WHEN_REMAINING = 5;                      // endless mode: shuffle again when this few tracks are left
    var PREFERENCES_ID = 'playlisttoolkit';
    var LEGACY_PREFERENCES_ID = 'playlistplus';         // former plugin name; its stored value is taken over once
    var PENDING_LIMIT = 100;                            // endless mode: at most this many waiting tracks are reported

    var player = null;
    var playerSearched = false;
    var session = null;        // the queue this script filled last: { firstIds, entries, total, busy, source }
    var sessionCounter = 0;

    function looksLikePlayer(value) {
        return !!value && typeof value === 'object'
            && ['play', 'queue', 'queueNext', 'getPlaylist', 'getCurrentPlaylistIndex'].every(function (name) { return typeof value[name] === 'function'; });
    }

    function getPlayer() {
        if (playerSearched) {
            return player;
        }
        playerSearched = true;
        try {
            var chunks = window.webpackChunk;
            var require = null;
            if (chunks && typeof chunks.push === 'function') {
                chunks.push([[Symbol('playlisttoolkit')], {}, function (r) { require = r; }]);
            }
            var ids = require && require.m ? Object.keys(require.m) : [];
            for (var i = 0; i < ids.length && !player; i++) {
                if (Function.prototype.toString.call(require.m[ids[i]]).indexOf(PLAYER_MARKER) < 0) {
                    continue;
                }
                // The module belongs to the start bundle, so the web client has loaded it long ago and
                // require() only hands out its exports. Should it ever not be loaded yet, require() would
                // run it here, ahead of the web client. The wrapper notices that; the player is then not
                // used and playback falls back to the server-sent command.
                var id = ids[i];
                var factory = require.m[id];
                var ranNow = false;
                var exported = null;
                require.m[id] = function () {
                    ranNow = true;
                    return factory.apply(this, arguments);
                };
                try {
                    exported = require(id);
                } finally {
                    require.m[id] = factory;
                }
                if (ranNow) {
                    console.warn(LOG, 'the player module was not loaded by the web client yet; not using it');
                    break;
                }
                Object.keys(exported || {}).forEach(function (key) {
                    if (!player && looksLikePlayer(exported[key])) {
                        player = exported[key];
                    }
                });
            }
        } catch (error) {
            console.warn(LOG, 'looking up the web player failed', error);
        }
        if (player && typeof player.clearQueue === 'function' && !player.__ptClear) {
            // "Clear queue" ends the session: what the user clears must not be refilled by endless mode.
            var stockClear = player.clearQueue;
            player.__ptClear = true;
            player.clearQueue = function () {
                session = null;
                return stockClear.apply(this, arguments);
            };
        }
        if (player && typeof player.removeFromPlaylist === 'function' && !player.__ptRemove) {
            // Entries taken out of the queue by anyone (stock queue page, playback bar menu, other scripts) are noted.
            // The player's "playlistitemremove" event fires on the active player object, not on this one, so the call
            // itself is wrapped.
            var stockRemove = player.removeFromPlaylist;
            player.__ptRemove = true;
            player.removeFromPlaylist = function (entryIds) {
                try {
                    onEntriesRemoved(null, { playlistItemIds: entryIds });
                } catch (error) {
                    console.warn(LOG, error);
                }
                setTimeout(refreshQueueView, 300);
                return stockRemove.apply(this, arguments);
            };
        }
        if (player && window.Events && window.Events.on) {
            window.Events.on(player, 'playbackstart', onTrackStart);
        } else if (!player) {
            console.warn(LOG, 'web player not found; playback is limited to one part of the queue');
        }
        return player;
    }

    function queueItems() {
        return Promise.resolve(player.getPlaylist()).then(function (items) { return items || []; });
    }

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // The web player gives every queue entry its own id (PlaylistItemId) that is never reused. The
    // session remembers the entry ids of what it appended last; the queue is "ours" as long as one of
    // them is still in it. A new playback started by the user replaces all entries, so none is left.
    // All entry ids the session appended are kept (a few thousand strings at most), so the session does not
    // let go of a queue that is still its own just because the user removed or reordered entries.
    function ownsQueue(items, current) {
        return core.ownedEntries(items, current.entries).length > 0;
    }

    function rememberEntries(current, entries) {
        current.entries = current.entries.concat(entries.map(function (entry) { return entry.PlaylistItemId; }));
        entries.forEach(function (entry) { current.entryTrack[entry.PlaylistItemId] = entry.Id; });
    }

    // Removes queue entries on behalf of this script; the removal event it causes is not a decision of the user.
    function removeOwn(current, entryIds) {
        current.ownRemoval = true;
        try {
            return player.removeFromPlaylist(entryIds);
        } finally {
            current.ownRemoval = false;
        }
    }

    // The user took entries out of the queue (the stock queue page, the playback bar menu, another script): those
    // tracks stay out of this session, also from the next rounds of endless mode and from parts not yet appended.
    // A second entry of the same track further down goes too.
    function onEntriesRemoved(event, detail) {
        var current = session;
        if (!current || current.ownRemoval || !detail || !detail.playlistItemIds) {
            return;
        }
        var changed = false;
        detail.playlistItemIds.forEach(function (entryId) {
            var track = current.entryTrack[entryId];
            if (track) {
                current.skip[normalize(track)] = true;
                changed = true;
            }
        });
        if (changed) {
            dropSkipped(current);
        }
    }

    function dropSkipped(current) {
        return queueItems().then(function (items) {
            var position = player.getCurrentPlaylistIndex();
            var doomed = items.filter(function (entry, index) {
                return index > position && current.entries.indexOf(entry.PlaylistItemId) >= 0 && current.skip[normalize(entry.Id)];
            });
            if (doomed.length) {
                return removeOwn(current, doomed.map(function (entry) { return entry.PlaylistItemId; }));
            }
            return null;
        }).catch(function (error) { console.warn(LOG, 'could not drop skipped tracks', error); });
    }

    // Identifies the queue that is in the player right now (null: empty or no player object).
    function queueStamp() {
        if (!getPlayer()) {
            return Promise.resolve(null);
        }
        return queueItems().then(function (items) { return items.length ? items[0].PlaylistItemId : null; });
    }

    // True if the user started another playback since the stamp was taken.
    function startedSomethingElse(stamp) {
        return queueStamp().then(function (now) { return now !== null && now !== stamp; });
    }

    function abandon(current) {
        if (session === current) {
            session = null;
        }
    }

    // Right after starting: waits until the player has taken the first part over and remembers its
    // entries. Resolves false if the queue never becomes the expected one.
    function adoptFirstPart(current) {
        var attempts = 0;
        function check() {
            if (session !== current) {
                return false;
            }
            return queueItems().then(function (items) {
                var taken = items.length > 0 && items.every(function (entry) {
                    return entry.PlaylistItemId && current.firstIds.indexOf(entry.Id) >= 0;
                });
                if (taken) {
                    rememberEntries(current, items);
                    if (current.source && current.source.explicitFirst && items[0]) {
                        current.keepEntry = items[0].PlaylistItemId;
                    }
                    return true;
                }
                if (attempts++ < 50) {
                    return wait(200).then(check);
                }
                abandon(current);
                return false;
            });
        }
        return check();
    }

    // Appends ids part by part, strictly one after the other, so the order is exact. Before and after
    // every part it checks that the queue is still the one this script filled. If the user started
    // something else while a part was on its way, the part is taken out of the foreign queue again and
    // the session ends (resolving false), so neither appending nor endless mode touch that queue.
    function appendParts(current, ids) {
        return getConfig().then(function (config) {
            var size = Math.max(1, config.MaxQueueSize);
            var index = 0;
            function next() {
                if (index >= ids.length) {
                    return true;
                }
                if (session !== current) {
                    return false;
                }
                return queueItems().then(function (items) {
                    if (!ownsQueue(items, current)) {
                        abandon(current);
                        return false;
                    }

                    var whole = ids.slice(index, index + size);
                    // Tracks the user took out of the queue stay out.
                    var part = whole.filter(function (id) { return !current.skip[normalize(id)]; });
                    if (!part.length) {
                        index += whole.length;
                        return next();
                    }
                    return Promise.resolve(player.queue({ ids: part, serverId: api().serverId() })).then(queueItems).then(function (after) {
                        // What the part added: the entries that are new in the queue (normally at its end).
                        var block = core.addedEntries(items, after, part);
                        if (session !== current || !ownsQueue(after, current)) {
                            if (block.length && typeof player.removeFromPlaylist === 'function') {
                                removeOwn(current, block.map(function (entry) { return entry.PlaylistItemId; }));
                            }
                            abandon(current);
                            return false;
                        }
                        if (!block.length) {
                            abandon(current);
                            return false;
                        }
                        rememberEntries(current, block);
                        index += whole.length;
                        current.total += part.length;
                        return next();
                    });
                });
            }
            return next();
        });
    }

    // Plays the given ids from startIndex to the end. source: { playlistId, smart } or null.
    function playAll(itemIds, startIndex, source) {
        var list = itemIds.slice(startIndex || 0);
        if (!list.length) {
            return Promise.resolve();
        }
        if (!getPlayer()) {
            return playViaServer(list, 'play');
        }
        return getConfig().then(function (config) {
            var first = list.slice(0, Math.max(1, config.MaxQueueSize));
            var current = { id: ++sessionCounter, firstIds: first, entries: [], entryTrack: {}, skip: {}, keepEntry: null, total: first.length, busy: true, source: source || null };
            session = current;
            return Promise.resolve(player.play({ ids: first, serverId: api().serverId() }))
                .then(function () { return adoptFirstPart(current); })
                .then(function (adopted) { return adopted ? appendParts(current, list.slice(first.length)) : false; })
                .then(function (complete) {
                    current.busy = false;
                    if (complete) {
                        toast(t('queued', current.total));
                        // A very short list may already be near its end.
                        onTrackStart();
                    }
                }, function (error) {
                    current.busy = false;
                    throw error;
                });
        }).catch(reportError);
    }

    // mode: 'next' or 'last'
    function playExtra(itemIds, mode) {
        if (!getPlayer()) {
            return playViaServer(itemIds, mode);
        }
        var options = { ids: itemIds, serverId: api().serverId() };
        return Promise.resolve(mode === 'next' ? player.queueNext(options) : player.queue(options))
            .then(function () { toast(t('queued', itemIds.length)); })
            .catch(reportError);
    }

    // Fallback without the web player object: the server sends a play command to this client.
    function playViaServer(itemIds, mode) {
        return getConfig().then(function (config) {
            var ids = mode === 'play' ? itemIds.slice(0, config.MaxQueueSize) : itemIds;
            return request('POST', 'Play', { json: { ItemIds: ids, StartIndex: 0, Mode: mode } }).then(function (result) {
                var left = itemIds.length - ids.length + result.Truncated;
                toast(left > 0 ? t('queuedTruncated', result.Queued, left) : t('queued', result.Queued));
            });
        }).catch(reportError);
    }

    // Entries of the session whose track is no longer in the playlist leave the queue (the player's queue
    // is a copy; it does not follow changes of the playlist). Resolves when done; errors only log.
    function pruneQueue(current, skipCurrent) {
        if (!player || !current || session !== current || current.busy || !current.source
            || typeof player.removeFromPlaylist !== 'function') {
            return Promise.resolve();
        }
        if (current.pruning) {
            // One is running (it may itself have started the next track): run once more when it is through.
            current.pruneAgain = { skip: skipCurrent === true || (current.pruneAgain && current.pruneAgain.skip) };
            return Promise.resolve();
        }
        current.pruning = true;
        return request('GET', 'Playlists/' + current.source.playlistId + '/Items').then(function (result) {
            if (session !== current) {
                return null;
            }
            var ids = result.Items.map(function (row) { return row.Id; });
            // Songs this user disliked stay in the playlist but do not play for them (unless every song is disliked).
            var skipTracks = Object.keys(current.skip);
            if (current.source.skipDisliked && result.Items.some(function (row) { return !row.IsDisliked; })) {
                skipTracks = skipTracks.concat(result.Items.filter(function (row) { return row.IsDisliked; }).map(function (row) { return row.Id; }));
            }
            return queueItems().then(function (items) {
                var position = player.getCurrentPlaylistIndex();
                var stale = core.staleEntries(items, position, current.entries, ids, skipCurrent === true, skipTracks, current.keepEntry);
                if (!stale.length) {
                    return null;
                }
                var runningGone = skipCurrent === true && stale.some(function (entry) { return entry === items[position]; });
                var removeAll = function () { return removeOwn(current, stale.map(function (entry) { return entry.PlaylistItemId; })); };
                // The track that just started was taken out of the playlist meanwhile: move on, then clean up.
                if (runningGone && position < items.length - 1 && typeof player.nextTrack === 'function') {
                    return Promise.resolve(player.nextTrack()).then(removeAll);
                }
                return removeAll();
            });
        }).catch(function (error) {
            console.warn(LOG, 'could not compare the queue with the playlist', error);
        }).then(function () {
            current.pruning = false;
            var again = current.pruneAgain;
            current.pruneAgain = null;
            return again ? pruneQueue(current, again.skip) : null;
        });
    }

    // Called after tracks were taken out of a playlist (by this script or by the stock menu).
    function playlistShrank(playlistId) {
        var current = session;
        if (player && current && current.source && normalize(current.source.playlistId) === normalize(playlistId)) {
            pruneQueue(current);
        }
    }

    // Called whenever a track starts: first the queue is cleaned of removed tracks, then (endless mode) a
    // smart shuffle queue that is almost through gets a new order, which the server computes (it keeps the
    // artist of the last track from opening it and puts what was just heard at the back); it is appended,
    // so playback never stops.
    // The queue page (when it is open) follows the player: the track that just ran goes to the top of "Recently played".
    function refreshQueueView() {
        var page = document.querySelector('.nowPlayingPage');
        var view = page && page.__ptQueue;
        if (view && view.hist && view.hist.isConnected && /#\/queue/.test(window.location.hash)) {
            view.queueDecorate();
        }
    }

    function onTrackStart() {
        setTimeout(refreshQueueView, 200);
        var current = session;
        if (!player || !current || current.busy || !current.source) {
            return;
        }
        pruneQueue(current, true).then(function () { extendIfNeeded(current); refreshSmart(); });
    }

    function extendIfNeeded(current) {
        if (session !== current || current.busy || !current.source.smart) {
            return;
        }
        getEndless().then(function (enabled) {
            if (!enabled || session !== current || current.busy) {
                return null;
            }
            if (stockShuffleOn()) {
                // The player's own queue shuffle reordered the queue: it is no longer this smart shuffle.
                abandon(current);
                return null;
            }
            return queueItems().then(function (items) {
                if (!ownsQueue(items, current)) {
                    abandon(current);
                    return null;
                }
                var position = Math.max(0, player.getCurrentPlaylistIndex());
                if (current.busy || items.length - 1 - position > EXTEND_WHEN_REMAINING) {
                    return null;
                }
                current.busy = true;
                var before = current.total;
                // The running track and the ones still waiting count as "just played" for the new order;
                // otherwise they would open it and play twice within a few minutes.
                var pending = items.slice(position).map(function (entry) { return entry.Id; }).slice(-PENDING_LIMIT);
                var body = { After: items[items.length - 1].Id, Pending: pending };
                return request('POST', 'Playlists/' + current.source.playlistId + '/SmartShuffle', { json: body })
                    .then(function (result) { return appendParts(current, result.ItemIds); })
                    .then(function (complete) {
                        current.busy = false;
                        if (complete && current.total > before) {
                            toast(t('reshuffled', current.total - before));
                        }
                    });
            });
        }).catch(function (error) {
            current.busy = false;
            console.warn(LOG, 'endless mode could not extend the queue', error);
        });
    }

    // The endless switch is stored per user on the server (display preferences), so it follows the user
    // to every browser. Default: on.
    var endlessState = null; // { userId, preferences, promise }

    function getEndless() {
        var userId = api().getCurrentUserId();
        if (!endlessState || endlessState.userId !== userId) {
            var state = { userId: userId, preferences: null, promise: null };
            state.promise = api().getDisplayPreferences(PREFERENCES_ID, userId, PREFERENCES_ID).then(function (preferences) {
                state.preferences = preferences;
                var value = (preferences.CustomPrefs || {}).endless;
                if (value !== undefined && value !== null) {
                    return value !== 'false';
                }
                // Not set under the current name: use the value saved under the former name, if any.
                return api().getDisplayPreferences(LEGACY_PREFERENCES_ID, userId, LEGACY_PREFERENCES_ID).then(function (legacy) {
                    return (legacy.CustomPrefs || {}).endless !== 'false';
                }, function () {
                    return true;
                });
            }).catch(function (error) {
                console.warn(LOG, 'could not read the endless setting', error);
                return true;
            });
            endlessState = state;
        }
        return endlessState.promise;
    }

    // The per-user switch for articles behind artist names lives in the same display preferences as "Endless"
    // (key articlesAfter, default on) and shares their preferences object, so one save never wipes the other.
    function loadArticles() {
        return Promise.all([getConfig(), getEndless()]).then(function (results) {
            articleState.list = results[0].SortArticles || [];
            var value = endlessState && endlessState.preferences ? (endlessState.preferences.CustomPrefs || {}).articlesAfter : null;
            articleState.on = value === undefined || value === null ? true : value !== 'false';
            applyArtistLabels();
        }).catch(function (error) { console.warn(LOG, 'could not read the article setting', error); });
    }

    function setArticles(on) {
        articleState.on = on;
        applyArtistLabels();
        if (currentPanel) {
            currentPanel.updateView();
        }
        return getEndless().then(function () {
            var preferences = endlessState && endlessState.preferences;
            if (!preferences) {
                return null;
            }
            preferences.CustomPrefs = preferences.CustomPrefs || {};
            preferences.CustomPrefs.articlesAfter = String(on);
            return api().updateDisplayPreferences(PREFERENCES_ID, preferences, endlessState.userId, PREFERENCES_ID);
        }).catch(reportError);
    }

    // Artist tiles and list rows of the web client (library, search, home): the name text is rewritten in place.
    var labelsQueued = false;
    function applyArtistLabels() {
        document.querySelectorAll('[data-type="MusicArtist"]').forEach(function (card) {
            var target = card.querySelector('.cardText-first a') || card.querySelector('.cardText-first') || card.querySelector('.listItemBodyText');
            if (!target || target.children.length > 0) {
                return;
            }
            var text = target.textContent.trim();
            var original = target.__ptShown === text ? target.__ptOriginal : text;
            var shown = artistLabel(original);
            target.__ptOriginal = original;
            target.__ptShown = shown;
            if (shown !== text) {
                target.textContent = shown;
            }
        });
    }

    function queueArtistLabels() {
        if (labelsQueued) {
            return;
        }
        labelsQueued = true;
        requestAnimationFrame(function () {
            labelsQueued = false;
            applyArtistLabels();
        });
    }

    function setEndless(enabled) {
        return getEndless().then(function () {
            var state = endlessState;
            state.promise = Promise.resolve(enabled);
            if (!state.preferences) {
                return null;
            }
            state.preferences.CustomPrefs = state.preferences.CustomPrefs || {};
            state.preferences.CustomPrefs.endless = String(enabled);
            return api().updateDisplayPreferences(PREFERENCES_ID, state.preferences, state.userId, PREFERENCES_ID);
        }).then(function () {
            if (enabled) {
                onTrackStart();
            }
        }).catch(reportError);
    }

    // ------------------------------------------------------------------ playlist panel

    var currentPanel = null;

    // page: the stock details page the panel lives in, or null for the administrator's view, where
    // mount is the element that takes the panel.
    function Panel(page, playlistId, mount) {
        this.page = page;
        this.mount = mount || null;
        this.onChanged = null;   // called after image or description changed (default: reload the stock page)
        this.onNavigate = null;  // called before the panel navigates away
        this.id = playlistId;
        this.info = null;
        this.rows = [];
        this.view = [];
        this.sort = { column: 'index', descending: false };
        this.filter = '';
        this.classic = false;
        this.range = null;
        this.root = null;
        // False for video playlists and when the table is switched off: the stock list stays, the
        // toolbar still offers image, description and sharing.
        this.tableEnabled = true;
        this.isAudio = true;
    }

    Panel.prototype.stockContainer = function () {
        return this.page ? this.page.querySelector('#childrenContent') : null;
    };

    Panel.prototype.build = function () {
        ensureStyle();
        var self = this;
        var root = document.createElement('div');
        root.className = 'pt-root';
        root.innerHTML =
            '<div class="pt-toolbar">' +
            '<button type="button" class="pt-btn pt-primary pt-shuffle" aria-pressed="false" title="' + esc(t('smartShuffleHint')) + '"><span class="material-icons shuffle" aria-hidden="true"></span><span class="pt-shuffle-label">' + esc(t('smartShuffle')) + '</span></button>' +
            '<button type="button" class="pt-btn pt-queue" title="' + esc(t('queueHint')) + '"><span class="material-icons queue_music" aria-hidden="true"></span><span>' + esc(t('queueButton')) + '</span></button>' +
            '<label class="pt-endless" title="' + esc(t('endlessHint')) + '"><input type="checkbox" class="pt-endless-box" checked><span>' + esc(t('endless')) + '</span></label>' +
            '<input type="search" class="pt-input pt-filter" placeholder="' + esc(t('filter')) + '" aria-label="' + esc(t('filter')) + '">' +
            '<button type="button" class="pt-btn pt-more" data-pt-menu title="' + esc(t('more')) + '" aria-label="' + esc(t('more')) + '"><span class="material-icons more_horiz" aria-hidden="true"></span></button>' +
            '<span class="pt-summary"></span>' +
            '</div>' +
            '<div class="pt-table" role="table"><div class="pt-head" role="row"></div><div class="pt-body" role="rowgroup"></div></div>' +
            '<div class="pt-message pt-hidden"></div>';
        if (this.info && this.info.AutoKind) {
            // Automatic playlist: say so above the toolbar.
            var autoHint = document.createElement('p');
            autoHint.className = 'pt-auto-hint';
            autoHint.textContent = t(this.info.AutoKind === 'Dislikes' ? 'autoHintDislikes' : 'autoHintFavorites');
            root.insertBefore(autoHint, root.firstChild);
        }
        this.root = root;
        this.head = root.querySelector('.pt-head');
        this.body = root.querySelector('.pt-body');
        this.message = root.querySelector('.pt-message');
        this.summary = root.querySelector('.pt-summary');
        this.table = root.querySelector('.pt-table');

        var stock = this.stockContainer();
        if (stock) {
            stock.parentNode.insertBefore(root, stock);
        } else {
            this.mount.appendChild(root);
        }

        if (!this.tableEnabled) {
            this.classic = true;
            this.table.classList.add('pt-hidden');
            this.summary.classList.add('pt-hidden');
            root.querySelector('.pt-filter').classList.add('pt-hidden');
            root.style.marginBottom = '0';
        }
        root.querySelector('.pt-shuffle').classList.toggle('pt-hidden', !this.isAudio);
        root.querySelector('.pt-queue').classList.toggle('pt-hidden', !this.isAudio);
        root.querySelector('.pt-queue').addEventListener('click', function () { self.navigate('#/queue'); });
        if (this.page && this.isAudio) {
            // The stock buttons of the page head: shuffle starts the smart shuffle (see the click handler below).
            var headShuffle = this.page.querySelector('.btnShuffle');
            if (headShuffle) {
                headShuffle.title = t('smartShuffle');
            }
            var headHeart = this.page.querySelector('.mainDetailButtons button[is="emby-ratingbutton"]');
            if (headHeart) {
                headHeart.title = t('heartPlaylistNote');
            }
        }
        // Endless mode needs the web player object; without it the switch would do nothing.
        root.querySelector('.pt-endless').classList.toggle('pt-hidden', !this.isAudio || !getPlayer());

        var endlessBox = root.querySelector('.pt-endless-box');
        getEndless().then(function (enabled) { endlessBox.checked = enabled; });
        endlessBox.addEventListener('change', function () { setEndless(endlessBox.checked); });

        root.querySelector('.pt-shuffle').addEventListener('click', function () { self.smartShuffle(); });
        root.querySelector('.pt-more').addEventListener('click', function (event) { self.showPlaylistMenu(event.currentTarget); });

        var filterTimer = null;
        root.querySelector('.pt-filter').addEventListener('input', function (event) {
            var value = event.target.value;
            clearTimeout(filterTimer);
            filterTimer = setTimeout(function () {
                self.filter = value.trim().toLowerCase();
                self.updateView();
            }, 120);
        });

        this.head.addEventListener('click', function (event) {
            var th = event.target.closest('.pt-th');
            if (th) {
                self.toggleSort(th.getAttribute('data-col'));
            }
        });

        this.body.addEventListener('click', function (event) {
            var rowElement = event.target.closest('.pt-row');
            if (!rowElement) {
                return;
            }
            var link = event.target.closest('a');
            if (link) {
                if (self.onNavigate) {
                    self.onNavigate();
                }
                handleArtistLink(event, link);
                return;
            }
            var index = Number(rowElement.getAttribute('data-i'));
            if (event.target.closest('[data-pt-dislike]')) {
                self.toggleDislike(self.view[index]);
                return;
            }
            if (event.target.closest('[data-pt-heart]')) {
                self.toggleFavorite(self.view[index]);
                return;
            }
            var menuButton = event.target.closest('[data-pt-menu]');
            if (menuButton) {
                self.showRowMenu(menuButton, index);
            } else {
                self.clickTrack(index);
            }
        });
    };

    Panel.prototype.visibleColumns = function () {
        var width = this.root.clientWidth || window.innerWidth;
        this.narrow = width < NARROW_WIDTH;
        this.root.classList.toggle('pt-narrow', this.narrow);
        return COLUMNS.filter(function (column) { return !column.hideBelow || width >= column.hideBelow; });
    };

    Panel.prototype.renderHead = function () {
        var self = this;
        var columns = this.visibleColumns();
        this.columns = columns;
        this.root.style.setProperty('--pt-cols', columns.map(function (c) { return c.width; }).join(' ') + ' 2.4em');
        this.head.innerHTML = columns.map(function (column) {
            var active = self.sort.column === column.id;
            var arrow = active ? '<span class="pt-arrow" aria-hidden="true">' + (self.sort.descending ? '▼' : '▲') + '</span>' : '';
            var label = column.labelKey ? t(column.labelKey) : column.label;
            var shown = column.icon ? '<span class="material-icons ' + column.icon + '" aria-hidden="true" style="font-size:1.1em;vertical-align:middle"></span>' : esc(label);
            return '<button type="button" role="columnheader" class="pt-th' + (column.align === 'right' ? ' pt-right' : '') + (column.align === 'center' ? ' pt-center' : '') + '" data-col="' + column.id + '"' +
                (column.icon ? ' title="' + esc(label) + '" aria-label="' + esc(label) + '"' : '') +
                ' aria-sort="' + (active ? (self.sort.descending ? 'descending' : 'ascending') : 'none') + '">' + shown + arrow + '</button>';
        }).join('') + '<span></span>';
    };

    Panel.prototype.toggleSort = function (columnId) {
        if (this.sort.column !== columnId) {
            this.sort = { column: columnId, descending: false };
        } else if (!this.sort.descending) {
            this.sort.descending = true;
        } else {
            // Third click returns to playlist order.
            this.sort = { column: 'index', descending: false };
        }
        this.updateView();
    };

    Panel.prototype.updateView = function () {
        var self = this;
        var rows = this.rows;
        if (this.filter) {
            var words = this.filter.split(/\s+/);
            rows = rows.filter(function (row) {
                return words.every(function (word) { return row._search.indexOf(word) >= 0; });
            });
        } else {
            rows = rows.slice();
        }

        var column = COLUMNS.filter(function (c) { return c.id === self.sort.column; })[0] || COLUMNS[0];
        var direction = this.sort.descending ? -1 : 1;
        if (column.sortValue) {
            rows.sort(function (a, b) { return direction * (column.sortValue(a) - column.sortValue(b)) || a.Index - b.Index; });
        } else {
            var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            var key = column.sortText || column.text;
            rows.sort(function (a, b) { return direction * collator.compare(key(a), key(b)) || a.Index - b.Index; });
        }

        this.view = rows;
        this.range = null;
        this.renderHead();

        var fontSize = parseFloat(getComputedStyle(this.root).fontSize) || 16;
        this.rowHeight = Math.round(fontSize * (this.narrow ? 3.7 : 2.9));
        this.root.style.setProperty('--pt-rowh', this.rowHeight + 'px');
        this.body.style.height = (rows.length * this.rowHeight) + 'px';
        themeColors(this.root);
        this.updateSticky();

        var total = this.rows.length;
        var ticks = rows.reduce(function (sum, row) { return sum + (row.RunTimeTicks || 0); }, 0);
        this.summary.textContent = (rows.length === total ? t('tracks', total) : t('tracksFiltered', rows.length, total)) + (ticks ? ' · ' + formatDuration(ticks) : '');
        this.message.textContent = total === 0 ? t('empty') : (rows.length === 0 ? t('noMatch') : '');
        this.message.classList.toggle('pt-hidden', rows.length > 0);
        this.table.classList.toggle('pt-hidden', total === 0);
        this.renderRows();
    };

    // Keeps the column headers below the app's fixed top bar (legacy or modern layout), if one is showing.
    Panel.prototype.updateSticky = function () {
        var top = 0;
        if (!this.page) {
            // Inside the administrator's view the dialog scrolls, not the page.
            this.root.style.setProperty('--pt-sticky', '0px');
            return;
        }
        document.querySelectorAll('.MuiAppBar-root, .skinHeader').forEach(function (bar) {
            var rect = bar.getBoundingClientRect();
            var position = getComputedStyle(bar).position;
            if ((position === 'fixed' || position === 'sticky') && rect.height > 0 && rect.top <= 0 && rect.bottom > top) {
                top = rect.bottom;
            }
        });
        top = Math.round(top);
        if (top !== this.stickyTop) {
            this.stickyTop = top;
            this.root.style.setProperty('--pt-sticky', top + 'px');
        }
    };

    // Only the rows near the viewport exist in the DOM, so 2,000+ tracks stay fluid.
    Panel.prototype.renderRows = function () {
        if (!this.root || !this.root.isConnected || this.classic || this.root.offsetParent === null) {
            return;
        }
        var rect = this.body.getBoundingClientRect();
        var overscan = 12;
        var first = Math.max(0, Math.floor(-rect.top / this.rowHeight) - overscan);
        var last = Math.min(this.view.length, Math.ceil((window.innerHeight - rect.top) / this.rowHeight) + overscan);
        if (this.range && this.range[0] === first && this.range[1] === last) {
            return;
        }
        this.range = [first, last];

        var columns = this.columns;
        var html = '';
        for (var i = first; i < last; i++) {
            var row = this.view[i];
            html += '<div class="pt-row" role="row" data-i="' + i + '" style="top:' + (i * this.rowHeight) + 'px">';
            for (var c = 0; c < columns.length; c++) {
                var column = columns[c];
                var text = column.text(row);
                var cls = 'pt-cell' + (column.align === 'right' ? ' pt-right' : '') + (column.id === 'title' ? '' : ' pt-dim');
                var inner;
                if (column.id === 'dislike') {
                    inner = '<button type="button" class="pt-iconbtn pt-heart pt-dislike' + (row.IsDisliked ? ' pt-on' : '') + '" data-pt-dislike aria-pressed="' + (row.IsDisliked ? 'true' : 'false') + '" aria-label="' +
                        esc(t(row.IsDisliked ? 'removeDislike' : 'addDislike')) + '" title="' + esc(t(row.IsDisliked ? 'removeDislike' : 'addDislike')) + '"><span class="material-icons ' + (row.IsDisliked ? 'thumb_down' : 'thumb_down_off_alt') + '" aria-hidden="true"></span></button>';
                    html += '<div class="pt-cell pt-center" role="cell">' + inner + '</div>';
                    continue;
                }
                if (column.id === 'fav') {
                    inner = '<button type="button" class="pt-iconbtn pt-heart' + (row.IsFavorite ? ' pt-on' : '') + '" data-pt-heart aria-pressed="' + (row.IsFavorite ? 'true' : 'false') + '" aria-label="' +
                        esc(t(row.IsFavorite ? 'removeFavorite' : 'addFavorite')) + '"><span class="material-icons ' + (row.IsFavorite ? 'favorite' : 'favorite_border') + '" aria-hidden="true"></span></button>';
                    html += '<div class="pt-cell pt-center" role="cell">' + inner + '</div>';
                    continue;
                }
                if (column.id === 'index') {
                    inner = '<span class="pt-num">' + esc(text) + '</span><span class="material-icons play_arrow pt-play" aria-hidden="true"></span>';
                } else if (column.id === 'title' && this.narrow) {
                    inner = '<div class="pt-line">' + esc(text) + '</div><div class="pt-line pt-dim">' + esc(artistsLabel(row.Artists)) + '</div>';
                } else if (column.html) {
                    inner = column.html(row);
                } else {
                    var href = column.link && column.link(row);
                    inner = href ? '<a href="' + esc(href) + '">' + esc(text) + '</a>' : esc(text);
                }
                html += '<div class="' + cls + '" role="cell"' + (column.id === 'index' ? '' : ' title="' + esc(text) + '"') + '>' + inner + '</div>';
            }
            html += '<div class="pt-cell" role="cell"><button type="button" class="pt-iconbtn" data-pt-menu aria-label="' + esc(t('more')) + '"><span class="material-icons more_vert" aria-hidden="true"></span></button></div></div>';
        }
        this.body.innerHTML = html;
    };

    Panel.prototype.load = function () {
        var self = this;
        return request('GET', 'Playlists/' + this.id + '/Items').then(function (result) {
            result.Items.forEach(function (row) {
                row._search = (row.Name + '\n' + (row.Artists || []).join('\n') + '\n' + (row.Album || '')).toLowerCase();
            });
            self.rows = result.Items;
            self.updateView();
        });
    };

    Panel.prototype.setClassic = function (classic) {
        this.classic = classic;
        this.table.classList.toggle('pt-hidden', classic || this.rows.length === 0);
        this.message.classList.toggle('pt-hidden', classic || this.view.length > 0);
        this.root.querySelector('.pt-filter').classList.toggle('pt-hidden', classic);
        this.summary.classList.toggle('pt-hidden', classic);
        var stock = this.stockContainer();
        stock.classList.toggle('pt-hidden', !classic);
        var container = stock.querySelector('.itemsContainer');
        if (container && container.refreshItems) {
            container.refreshItems();
        }
        if (!classic) {
            this.load().catch(reportError);
        }
    };

    Panel.prototype.viewIds = function () {
        return this.view.map(function (row) { return row.Id; });
    };

    // "Smart shuffle is on" for a playlist means: the queue the player holds right now is a smart shuffle of that
    // playlist that this script filled (and the player's own queue shuffle is off, which would reorder it). It is
    // read from the live session, not remembered: it ends when something else is played or the queue is cleared.
    function smartActive(playlistId) {
        var current = session;
        if (!player || !current || !current.source || !current.source.smart
            || normalize(current.source.playlistId) !== normalize(playlistId)) {
            return Promise.resolve(false);
        }
        if (stockShuffleOn()) {
            return Promise.resolve(false);
        }
        if (current.busy && current.entries.length === 0) {
            return Promise.resolve(true); // the first part is on its way
        }
        return queueItems().then(function (items) { return session === current && ownsQueue(items, current); }, function () { return false; });
    }

    // The player's own "shuffle queue" toggle (button in the playback bar): it reorders the queue randomly.
    function stockShuffleOn() {
        try {
            return !!player && typeof player.getQueueShuffleMode === 'function' && player.getQueueShuffleMode() === 'Shuffle';
        } catch (error) {
            return false;
        }
    }

    Panel.prototype.refreshSmart = function () {
        var self = this;
        if (!this.root || !this.root.isConnected || !this.isAudio) {
            return Promise.resolve();
        }
        return smartActive(this.id).then(function (active) {
            var element = self.root.querySelector('.pt-shuffle');
            if (!element) {
                return;
            }
            element.classList.toggle('pt-active', active);
            element.setAttribute('aria-pressed', active ? 'true' : 'false');
            element.title = active ? t('smartShuffleOnHint') : t('smartShuffleHint');
            var label = element.querySelector('.pt-shuffle-label');
            if (label) {
                label.textContent = active ? t('smartShuffleOn') : t('smartShuffle');
            }
        });
    };

    function refreshSmart() {
        if (currentPanel) {
            currentPanel.refreshSmart();
        }
    }

    // Where a queue of this panel comes from. Disliked songs are skipped for this user, except on the playlist of
    // dislikes itself (all its songs are disliked).
    Panel.prototype.source = function (smart, explicitFirst) {
        return { playlistId: this.id, smart: smart, skipDisliked: !(this.info && this.info.AutoKind === 'Dislikes'), explicitFirst: explicitFirst === true };
    };

    // The ids shown in the table from a row on; later disliked songs are left out, the row itself stays.
    Panel.prototype.idsFrom = function (index) {
        var skip = this.source(false).skipDisliked;
        return this.view.filter(function (row, i) { return i === index || (i > index && !(skip && row.IsDisliked)); }).map(function (row) { return row.Id; });
    };

    Panel.prototype.playFrom = function (index) {
        playAll(this.idsFrom(index), 0, this.source(false, true)).then(refreshSmart);
    };

    // A click on a track row: while smart shuffle is on for this playlist the track plays first and the rest
    // stays shuffled; otherwise the list plays from the track in the order shown.
    Panel.prototype.clickTrack = function (index) {
        var self = this;
        var row = this.view[index];
        var plain = function () { return playAll(self.idsFrom(index), 0, self.source(false, true)).then(refreshSmart); };
        if (!this.isAudio || !getPlayer()) {
            plain();
            return;
        }
        smartActive(this.id).then(function (active) {
            return active ? self.smartFrom(row.Id) : plain();
        }).catch(reportError);
    };

    // The clicked track first, then the smart shuffle order of the rest.
    Panel.prototype.smartFrom = function (firstId) {
        var source = this.source(true, true);
        return request('GET', 'Playlists/' + this.id + '/SmartShuffle', { query: { after: firstId } })
            .then(function (result) {
                var rest = result.ItemIds.filter(function (id) { return normalize(id) !== normalize(firstId); });
                return playAll([firstId].concat(rest), 0, source);
            })
            .then(refreshSmart)
            .catch(reportError);
    };

    Panel.prototype.smartShuffle = function () {
        var buttonElement = this.root.querySelector('.pt-shuffle');
        buttonElement.disabled = true;
        var source = this.source(true, false);
        var id = this.id;
        // The order comes from the server, which can take a moment. If the user starts something else
        // meanwhile, that wins and the shuffle is dropped.
        queueStamp()
            .then(function (stamp) {
                return request('GET', 'Playlists/' + id + '/SmartShuffle').then(function (result) {
                    return startedSomethingElse(stamp).then(function (other) {
                        return other ? null : playAll(result.ItemIds, 0, source);
                    });
                });
            })
            .catch(reportError)
            .then(function () { buttonElement.disabled = false; refreshSmart(); });
    };

    // The page head's stock Shuffle button on a music playlist starts the smart shuffle too, so there is one
    // shuffle on the page (the stock one would play a plain random order).
    document.addEventListener('click', function (event) {
        var target = event.target && event.target.closest && event.target.closest('.itemDetailPage .btnShuffle');
        var page = target && target.closest('.itemDetailPage');
        var panel = page && page.__ptPanel;
        if (panel && panel.isAudio && panel.root && panel.root.isConnected && getPlayer()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            panel.smartShuffle();
        }
    }, true);

    // A heart on the playlist itself marks the playlist, not its songs: say so once the click is through.
    document.addEventListener('click', function (event) {
        var target = event.target && event.target.closest && event.target.closest('.itemDetailPage .mainDetailButtons button[is="emby-ratingbutton"]');
        var page = target && target.closest('.itemDetailPage');
        var panel = page && page.__ptPanel;
        if (panel && panel.isAudio && panel.root && panel.root.isConnected) {
            setTimeout(function () { toast(t('heartPlaylistNote')); }, 500);
        }
    }, true);

    // Sets heart and thumb of a song on every loaded row of it.
    Panel.prototype.setMarks = function (row, favorite, disliked) {
        this.rows.forEach(function (other) {
            if (normalize(other.Id) === normalize(row.Id)) {
                other.IsFavorite = favorite;
                other.IsDisliked = disliked;
            }
        });
        this.range = null;
        this.renderRows();
    };

    // Hearts a song of the table (same call as the stock heart button). A heart takes a dislike back: the two exclude
    // each other (the Dislike plugin does the same on the server).
    Panel.prototype.toggleFavorite = function (row) {
        var self = this;
        var want = !row.IsFavorite;
        var before = { fav: row.IsFavorite, dis: row.IsDisliked };
        var client = api();
        var userId = client.getCurrentUserId();
        this.setMarks(row, want, want ? false : row.IsDisliked);
        var steps = want && before.dis ? Promise.resolve(client.clearUserItemRating(userId, row.Id)) : Promise.resolve();
        steps.then(function () { return client.updateFavoriteStatus(userId, row.Id, want); }).then(function () {
            return self.afterMarkChange();
        }).catch(function (error) {
            self.setMarks(row, before.fav, before.dis);
            reportError(error);
        });
    };

    // The thumb down of a song of the table: the song stays in the playlist and is skipped in this user's queue.
    Panel.prototype.toggleDislike = function (row) {
        var self = this;
        var want = !row.IsDisliked;
        var before = { fav: row.IsFavorite, dis: row.IsDisliked };
        var client = api();
        var userId = client.getCurrentUserId();
        this.setMarks(row, want ? false : row.IsFavorite, want);
        var steps = want && before.fav ? Promise.resolve(client.updateFavoriteStatus(userId, row.Id, false)) : Promise.resolve();
        steps.then(function () {
            return want ? client.updateUserItemRating(userId, row.Id, false) : client.clearUserItemRating(userId, row.Id);
        }).then(function () {
            return self.afterMarkChange();
        }).catch(function (error) {
            self.setMarks(row, before.fav, before.dis);
            reportError(error);
        });
    };

    Panel.prototype.afterMarkChange = function () {
        if (this.info && this.info.AutoKind) {
            // An automatic list mirrors the marks: it follows through a sync.
            var self = this;
            return request('POST', 'AutoPlaylists/Sync').then(function () { return self.load(); });
        }
        return null;
    };

    // Dislikes set anywhere in the web client (playback bar, queue page, the Dislike plugin's menu, this table) go
    // through these two calls of the API client. After one, the running queue is cleaned: the song leaves it (and is
    // skipped when it is the running one).
    function hookRatings() {
        var client = api();
        if (!client || client.__ptRatings) {
            return;
        }
        client.__ptRatings = true;
        ['updateUserItemRating', 'clearUserItemRating'].forEach(function (name) {
            var original = client[name];
            if (typeof original !== 'function') {
                return;
            }
            client[name] = function (userId, itemId) {
                var result = original.apply(this, arguments);
                Promise.resolve(result).then(function () {
                    var current = session;
                    if (current && current.source && current.source.skipDisliked) {
                        if (current.keepEntry && normalize(current.entryTrack[current.keepEntry]) === normalize(itemId)) {
                            current.keepEntry = null; // rating the song that was started on purpose ends its exemption
                        }
                        pruneQueue(current, true);
                    }
                }, function () { });
                return result;
            };
        });
    }

    // Moves and removals go through the plugin: its rights also cover administrators, whom the stock
    // endpoints refuse on playlists of other users.
    Panel.prototype.edit = function (method, path, query) {
        var self = this;
        return request(method, 'Playlists/' + this.id + '/' + path, { query: query })
            .then(function () {
                if (method === 'DELETE' && path === 'Items') {
                    playlistShrank(self.id);
                }
                return self.load();
            })
            .catch(reportError);
    };

    Panel.prototype.navigate = function (hash) {
        if (this.onNavigate) {
            this.onNavigate();
        }
        window.location.hash = hash;
    };

    Panel.prototype.showRowMenu = function (anchor, index) {
        var self = this;
        var row = this.view[index];
        var items = [
            { label: t('playFromHere'), icon: 'play_arrow', run: function () { self.playFrom(index); } },
            { label: t('playNext'), icon: 'playlist_play', run: function () { playExtra([row.Id], 'next'); } },
            { label: t('addToQueue'), icon: 'queue_music', run: function () { playExtra([row.Id], 'last'); } },
            { label: t('addToPlaylist'), icon: 'playlist_add', run: function () { playlistsDialog(row.Id, row.Name); } }
        ];
        if (row.AlbumId) {
            items.push({ label: t('openAlbum'), icon: 'album', run: function () { self.navigate('#/details?id=' + row.AlbumId + '&serverId=' + api().serverId()); } });
        }
        if (this.info.CanEditItems && row.PlaylistItemId) {
            var count = this.rows.length;
            items.push(null);
            if (row.Index > 0) {
                items.push({ label: t('moveTop'), icon: 'vertical_align_top', run: function () { self.edit('POST', 'Items/' + row.PlaylistItemId + '/Move/0'); } });
                items.push({ label: t('moveUp'), icon: 'arrow_upward', run: function () { self.edit('POST', 'Items/' + row.PlaylistItemId + '/Move/' + (row.Index - 1)); } });
            }
            if (row.Index < count - 1) {
                items.push({ label: t('moveDown'), icon: 'arrow_downward', run: function () { self.edit('POST', 'Items/' + row.PlaylistItemId + '/Move/' + (row.Index + 1)); } });
                items.push({ label: t('moveBottom'), icon: 'vertical_align_bottom', run: function () { self.edit('POST', 'Items/' + row.PlaylistItemId + '/Move/' + (count - 1)); } });
            }
            items.push({ label: t('remove'), icon: 'playlist_remove', run: function () { self.edit('DELETE', 'Items', { entryIds: row.PlaylistItemId }); } });
        }
        if (this.info.AutoKind && this.info.IsAutoSubject && row.Id) {
            // The list mirrors hearts and ratings: the song leaves it when the mark is taken back.
            var favorites = this.info.AutoKind !== 'Dislikes';
            items.push(null);
            items.push({
                label: t(favorites ? 'removeFavorite' : 'removeDislike'),
                icon: favorites ? 'favorite_border' : 'thumb_down_off_alt',
                run: function () {
                    removeMark(favorites, row.Id)
                        .then(function () { return request('POST', 'AutoPlaylists/Sync'); })
                        .then(function () { return self.load(); })
                        .catch(reportError);
                }
            });
        }
        showMenu(anchor, items);
    };

    // Takes back a heart or a dislike through the stock API, so every other consumer of the change
    // (the server's own events, other plugins) sees it like a change made by any client.
    function removeMark(favorite, itemId) {
        var client = api();
        var userId = client.getCurrentUserId();
        if (favorite && typeof client.updateFavoriteStatus === 'function') {
            return Promise.resolve(client.updateFavoriteStatus(userId, itemId, false));
        }
        if (!favorite && typeof client.clearUserItemRating === 'function') {
            return Promise.resolve(client.clearUserItemRating(userId, itemId));
        }
        var path = favorite ? 'UserFavoriteItems/' + itemId : 'UserItems/' + itemId + '/Rating';
        return Promise.resolve(client.ajax({ type: 'DELETE', url: client.getUrl(path) }));
    }

    Panel.prototype.showPlaylistMenu = function (anchor) {
        var self = this;
        var items = [];
        if (this.info.CanManage) {
            items.push({ label: t('editDetails'), icon: 'image', run: function () { detailsDialog(self); } });
        }
        if (this.info.CanShare) {
            items.push({ label: t('share'), icon: 'group', run: function () { shareDialog(self); } });
        }
        if (articleState.list.length) {
            items.push({ label: t(articleState.on ? 'articlesOn' : 'articlesOff'), icon: 'sort_by_alpha', run: function () { setArticles(!articleState.on); } });
        }
        if (this.isAudio) {
            items.push({ label: t('exportM3u'), icon: 'file_download', run: function () { exportM3u(self); } });
            items.push({ label: t('importM3u'), icon: 'file_upload', run: function () { importDialog(self); } });
        }
        if (this.tableEnabled && this.page) {
            items.push(null);
            items.push(this.classic
                ? { label: t('tableView'), icon: 'table_rows', run: function () { self.setClassic(false); } }
                : { label: t('classicView'), icon: 'view_list', run: function () { self.setClassic(true); } });
        }
        if (this.page && this.config && this.config.IsAdministrator) {
            items.push(null);
            items.push({ label: t('allPlaylists'), icon: 'admin_panel_settings', run: function () { openAdmin(); } });
        }
        if (items.length) {
            showMenu(anchor, items);
        }
    };

    // ------------------------------------------------------------------ dialogs

    function detailsDialog(panel) {
        Promise.all([getConfig(), request('GET', 'Playlists/' + panel.id)]).then(function (results) {
            var config = results[0];
            var info = results[1];
            var maxMb = Math.floor(config.MaxImageBytes / 1048576);
            var selectedFile = null;
            var removeImage = false;

            openDialog(info.Name, function (dialog, close) {
                var wrapper = document.createElement('div');
                wrapper.innerHTML =
                    '<label>' + esc(t('image')) + '</label>' +
                    '<div class="pt-imgrow"><div class="pt-preview"></div><div>' +
                    '<input type="file" class="pt-file pt-hidden" accept="image/jpeg,image/png,image/webp,image/gif">' +
                    '<div style="display:flex;gap:.6em;flex-wrap:wrap"></div>' +
                    '<p class="pt-hint">' + esc(t('imageHint', maxMb)) + '</p><p class="pt-hint pt-imgerror" role="alert"></p></div></div>' +
                    '<label for="pt-overview">' + esc(t('description')) + '</label>' +
                    '<textarea id="pt-overview" class="pt-input" maxlength="' + config.MaxDescriptionLength + '"></textarea>';
                dialog.appendChild(wrapper);

                var preview = wrapper.querySelector('.pt-preview');
                var fileInput = wrapper.querySelector('.pt-file');
                var errorLine = wrapper.querySelector('.pt-imgerror');
                var buttons = wrapper.querySelector('.pt-imgrow div div');
                var textarea = wrapper.querySelector('textarea');
                textarea.value = info.Overview || '';
                if (info.HasImage) {
                    preview.style.backgroundImage = 'url("' + api().getUrl('Items/' + info.Id + '/Images/Primary', { maxWidth: 400, t: Date.now() }) + '")';
                }

                var choose = button(t('chooseImage'), '', 'image');
                var removeButton = button(t('removeImage'), '', 'delete');
                buttons.appendChild(choose);
                buttons.appendChild(removeButton);
                removeButton.classList.toggle('pt-hidden', !info.HasImage);
                choose.addEventListener('click', function () { fileInput.click(); });
                fileInput.addEventListener('change', function () {
                    var file = fileInput.files[0];
                    errorLine.textContent = '';
                    if (!file) {
                        return;
                    }
                    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(file.type) < 0) {
                        errorLine.textContent = t('imageType');
                        return;
                    }
                    if (file.size > config.MaxImageBytes) {
                        errorLine.textContent = t('imageTooBig', maxMb);
                        return;
                    }
                    selectedFile = file;
                    removeImage = false;
                    preview.style.backgroundImage = 'url("' + URL.createObjectURL(file) + '")';
                    removeButton.classList.remove('pt-hidden');
                });
                removeButton.addEventListener('click', function () {
                    selectedFile = null;
                    removeImage = info.HasImage;
                    fileInput.value = '';
                    preview.style.backgroundImage = '';
                    removeButton.classList.add('pt-hidden');
                });

                var row = actions(dialog);
                var cancel = button(t('cancel'));
                var save = button(t('save'), 'pt-primary');
                row.appendChild(cancel);
                row.appendChild(save);
                cancel.addEventListener('click', function () { close(false); });
                save.addEventListener('click', function () {
                    save.disabled = true;
                    var steps = Promise.resolve();
                    if (selectedFile) {
                        steps = steps.then(function () {
                            return request('POST', 'Playlists/' + info.Id + '/Image', { raw: selectedFile, contentType: selectedFile.type });
                        });
                    } else if (removeImage) {
                        steps = steps.then(function () { return request('DELETE', 'Playlists/' + info.Id + '/Image'); });
                    }
                    if (textarea.value.trim() !== (info.Overview || '')) {
                        steps = steps.then(function () {
                            return request('POST', 'Playlists/' + info.Id + '/Description', { json: { Overview: textarea.value } });
                        });
                    }
                    steps.then(function () {
                        close(true);
                        toast(t('saved'));
                        if (panel.onChanged) {
                            panel.onChanged();
                        } else {
                            reloadView();
                        }
                    }).catch(function (error) {
                        save.disabled = false;
                        reportError(error);
                    });
                });
            });
        }).catch(reportError);
    }

    function shareDialog(panel) {
        Promise.all([request('GET', 'Playlists/' + panel.id), request('GET', 'Users')]).then(function (results) {
            var info = results[0];
            var users = results[1].filter(function (user) { return user.Id !== info.OwnerUserId; });
            var current = {};
            info.Shares.forEach(function (share) { current[share.UserId] = share.CanEdit ? 'edit' : 'listen'; });

            openDialog(t('shareTitle', info.Name), function (dialog, close) {
                var wrapper = document.createElement('div');
                var html = '';
                if (info.OwnerName) {
                    html += '<p class="pt-hint">' + esc(t('owner', info.OwnerName)) + '</p>';
                }
                if (users.length === 0) {
                    html += '<p>' + esc(t('noUsers')) + '</p>';
                }
                users.forEach(function (user) {
                    var value = current[user.Id] || 'none';
                    html += '<div class="pt-sharerow"><span>' + esc(user.Name) + '</span>' +
                        '<select class="pt-input" data-user="' + esc(user.Id) + '" aria-label="' + esc(user.Name) + '">' +
                        ['none', 'listen', 'edit'].map(function (option) {
                            var label = option === 'none' ? t('shareNone') : option === 'listen' ? t('shareListen') : t('shareEdit');
                            return '<option value="' + option + '"' + (option === value ? ' selected' : '') + '>' + esc(label) + '</option>';
                        }).join('') + '</select></div>';
                });
                html += '<p class="pt-hint">' + esc(t('shareHint')) + '</p>' +
                    '<label class="pt-check"><input type="checkbox" class="pt-public"' + (info.OpenAccess ? ' checked' : '') + '><span>' + esc(t('sharePublic')) + '</span></label>';
                wrapper.innerHTML = html;
                dialog.appendChild(wrapper);

                var row = actions(dialog);
                var cancel = button(t('cancel'));
                var save = button(t('save'), 'pt-primary');
                row.appendChild(cancel);
                row.appendChild(save);
                cancel.addEventListener('click', function () { close(false); });
                save.addEventListener('click', function () {
                    save.disabled = true;
                    var shares = [];
                    wrapper.querySelectorAll('select[data-user]').forEach(function (select) {
                        if (select.value !== 'none') {
                            shares.push({ UserId: select.getAttribute('data-user'), CanEdit: select.value === 'edit' });
                        }
                    });
                    request('POST', 'Playlists/' + info.Id + '/Sharing', { json: { OpenAccess: wrapper.querySelector('.pt-public').checked, Shares: shares } })
                        .then(function (updated) {
                            panel.info = updated;
                            close(true);
                            toast(t('saved'));
                        })
                        .catch(function (error) {
                            save.disabled = false;
                            reportError(error);
                        });
                });
            });
        }).catch(reportError);
    }

    function exportM3u(panel) {
        request('GET', 'Playlists/' + panel.id + '/Export', { blob: true }).then(function (blob) {
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = (panel.info.Name || 'playlist').replace(/[\\/:*?"<>|]/g, '_') + '.m3u8';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(link.href); }, 10000);
        }).catch(reportError);
    }

    function importDialog(panel) {
        openDialog(t('importTitle'), function (dialog, close) {
            var canAppend = panel.info.CanEditItems;
            var wrapper = document.createElement('div');
            wrapper.innerHTML =
                '<label for="pt-m3u">' + esc(t('importFile')) + '</label>' +
                '<input id="pt-m3u" type="file" class="pt-input" accept=".m3u,.m3u8,audio/x-mpegurl,text/plain">' +
                '<label class="pt-check"><input type="radio" name="pt-target" value="new" checked><span>' + esc(t('importNew')) + '</span></label>' +
                (canAppend ? '<label class="pt-check"><input type="radio" name="pt-target" value="append"><span>' + esc(t('importAppend', panel.info.Name)) + '</span></label>' : '') +
                '<label for="pt-m3u-name">' + esc(t('importName')) + '</label>' +
                '<input id="pt-m3u-name" type="text" class="pt-input" maxlength="200">' +
                '<div class="pt-result" role="status"></div>';
            dialog.appendChild(wrapper);

            var fileInput = wrapper.querySelector('#pt-m3u');
            var nameInput = wrapper.querySelector('#pt-m3u-name');
            var resultBox = wrapper.querySelector('.pt-result');
            fileInput.addEventListener('change', function () {
                if (fileInput.files[0] && !nameInput.value) {
                    nameInput.value = fileInput.files[0].name.replace(/\.m3u8?$/i, '');
                }
            });
            wrapper.querySelectorAll('input[name="pt-target"]').forEach(function (radio) {
                radio.addEventListener('change', function () {
                    nameInput.disabled = wrapper.querySelector('input[name="pt-target"]:checked').value !== 'new';
                });
            });

            var row = actions(dialog);
            var cancel = button(t('close'));
            var run = button(t('importRun'), 'pt-primary');
            row.appendChild(cancel);
            row.appendChild(run);
            cancel.addEventListener('click', function () { close(false); });
            run.addEventListener('click', function () {
                var file = fileInput.files[0];
                var append = wrapper.querySelector('input[name="pt-target"]:checked').value === 'append';
                if (!file || (!append && !nameInput.value.trim())) {
                    (file ? nameInput : fileInput).focus();
                    return;
                }
                run.disabled = true;
                file.text().then(function (content) {
                    var body = append ? { PlaylistId: panel.id, Content: content } : { Name: nameInput.value.trim(), Content: content };
                    return request('POST', 'Import', { json: body });
                }).then(function (result) {
                    var html = '<p>' + esc(result.Matched === 0 ? t('importNone') : t('importResult', result.Matched, result.Total)) + '</p>';
                    if (result.Unmatched.length && result.Matched > 0) {
                        html += '<p class="pt-hint">' + esc(t('importUnmatched')) + '</p><div class="pt-list">' +
                            result.Unmatched.map(function (line) { return '<div>' + esc(line) + '</div>'; }).join('') + '</div>';
                    }
                    resultBox.innerHTML = html;
                    run.classList.add('pt-hidden');
                    if (result.Matched > 0 && append) {
                        if (!panel.classic) {
                            panel.load().catch(reportError);
                        }
                    } else if (result.Matched > 0) {
                        var open = button(t('open'), 'pt-primary');
                        row.appendChild(open);
                        open.addEventListener('click', function () {
                            close(true);
                            panel.navigate('#/details?id=' + result.PlaylistId + '&serverId=' + api().serverId());
                        });
                    }
                }).catch(function (error) {
                    run.disabled = false;
                    reportError(error);
                });
            });
        });
    }

    // Administrators reach every playlist of every user here, also private ones that the stock client
    // cannot open for them. The list and the playlist view live in one dialog.
    function openAdmin() {
        return getConfig().then(function (config) {
            if (!config.IsAdministrator) {
                return null;
            }
            var previousPanel = currentPanel;
            return openDialog(t('allPlaylists'), function (dialog, close) {
                dialog.classList.add('pt-wide');
                dialog.innerHTML = '<div class="pt-admin-head"><h2></h2></div><div class="pt-admin-body"></div>';
                var head = dialog.querySelector('.pt-admin-head');
                var title = head.querySelector('h2');
                var body = dialog.querySelector('.pt-admin-body');
                var backButton = button(t('back'), 'pt-hidden', 'arrow_back');
                var closeButton = button(t('close'), '', 'close');
                head.insertBefore(backButton, title);
                head.appendChild(closeButton);
                closeButton.addEventListener('click', function () { close(undefined); });
                backButton.addEventListener('click', showList);

                function visibility(entry) {
                    return entry.OpenAccess ? t('visPublic') : entry.ShareCount ? t('visShared', entry.ShareCount) : t('visPrivate');
                }

                function showList() {
                    currentPanel = previousPanel;
                    backButton.classList.add('pt-hidden');
                    title.textContent = t('allPlaylists');
                    body.innerHTML = '';
                    request('GET', 'Admin/Playlists').then(function (playlists) {
                        var filter = document.createElement('input');
                        filter.type = 'search';
                        filter.className = 'pt-input';
                        filter.placeholder = t('adminFilter');
                        filter.setAttribute('aria-label', t('adminFilter'));
                        var list = document.createElement('div');
                        body.appendChild(filter);
                        body.appendChild(list);
                        function render() {
                            var words = filter.value.trim().toLowerCase().split(/\s+/);
                            var shown = playlists.filter(function (entry) {
                                var text = (entry.Name + '\n' + (entry.OwnerName || entry.AutoUserName || '')).toLowerCase();
                                return words.every(function (word) { return text.indexOf(word) >= 0; });
                            });
                            list.innerHTML = shown.length ? '' : '<p class="pt-message">' + esc(t('adminNone')) + '</p>';
                            shown.forEach(function (entry) {
                                var item = document.createElement('button');
                                item.type = 'button';
                                item.className = 'pt-admin-item';
                                item.innerHTML = '<span><strong>' + esc(entry.Name) + '</strong></span><span>' + esc(entry.OwnerName || (entry.AutoUserName ? t('autoOwner', entry.AutoUserName) : t('noOwner'))) +
                                    '</span><span class="pt-dim">' + esc(t('tracks', entry.ItemCount)) + '</span><span class="pt-dim">' + esc(visibility(entry)) + '</span>';
                                item.addEventListener('click', function () { showPlaylist(entry.Id); });
                                list.appendChild(item);
                            });
                        }
                        filter.addEventListener('input', render);
                        render();
                        filter.focus();
                    }).catch(reportError);
                }

                function showPlaylist(id) {
                    body.innerHTML = '';
                    backButton.classList.remove('pt-hidden');
                    request('GET', 'Playlists/' + id).then(function (info) {
                        title.textContent = info.Name + (info.OwnerName ? ' · ' + info.OwnerName : '');
                        var panel = new Panel(null, id, body);
                        panel.info = info;
                        panel.config = config;
                        panel.isAudio = info.MediaType === 'Audio';
                        panel.tableEnabled = config.EnableTrackTable && panel.isAudio;
                        panel.onNavigate = function () { close(undefined); };
                        panel.onChanged = function () { showPlaylist(id); };
                        panel.build();
                        if (!panel.tableEnabled) {
                            // Same rule as on the playlist page: no table for video playlists or when the
                            // table is switched off. The menu (image, description, sharing) stays.
                            var note = document.createElement('p');
                            note.className = 'pt-message';
                            note.textContent = t('adminNoTable');
                            body.appendChild(note);
                            return null;
                        }
                        currentPanel = panel;
                        return panel.load();
                    }).catch(reportError);
                }

                showList();
            }).then(function () {
                currentPanel = previousPanel;
                if (previousPanel && !previousPanel.classic) {
                    previousPanel.load().catch(function () { });
                }
            });
        }).catch(reportError);
    }

    // ------------------------------------------------------------------ "add to playlist" with several playlists at once
    //
    // One window for one song: every playlist the user can edit with a tick where the song already is. Ticking and
    // unticking changes nothing until "Confirm"; then all changes are sent in one call. A playlist that holds the
    // same song from another album says so on its row (the duplicate warning of the stock add, in this window).
    // Automatic playlists (Favoriten, Dislikes) are not offered.

    function playlistsDialog(trackId, trackName) {
        return request('GET', 'Targets', { query: { itemId: trackId } }).then(function (targets) {
            return openDialog(t('plTitle'), function (dialog, close) {
                var wrapper = document.createElement('div');
                var html = '<p class="pt-hint">' + esc(t('plIntro', trackName || '')) + '</p>';
                if (!targets.length) {
                    html += '<p>' + esc(t('plNone')) + '</p>';
                }
                html += '<div class="pt-list pt-targets">' + targets.map(function (target, index) {
                    var notes = [t('plCount', target.ItemCount)];
                    if (target.OwnerName) {
                        notes.push(t('plOwner', target.OwnerName));
                    }
                    if (!target.Contains && target.SimilarAlbum !== null && target.SimilarAlbum !== undefined) {
                        notes.push(t('plSimilar', target.SimilarAlbum || '?'));
                    }
                    return '<label class="pt-check"><input type="checkbox" data-index="' + index + '"' + (target.Contains ? ' checked' : '') + '><span>' +
                        esc(target.Name) + '<br><span class="pt-hint">' + esc(notes.join(' · ')) + '</span></span></label>';
                }).join('') + '</div>' +
                    '<label for="pt-new-playlist">' + esc(t('plNew')) + '</label>' +
                    '<input id="pt-new-playlist" type="text" class="pt-input" maxlength="200" placeholder="' + esc(t('plNewName')) + '">';
                wrapper.innerHTML = html;
                dialog.appendChild(wrapper);

                var row = actions(dialog);
                var cancel = button(t('cancel'));
                var confirm = button(t('plConfirm'), 'pt-primary');
                row.appendChild(cancel);
                row.appendChild(confirm);
                cancel.addEventListener('click', function () { close(false); });
                confirm.addEventListener('click', function () {
                    var add = [];
                    var remove = [];
                    wrapper.querySelectorAll('input[data-index]').forEach(function (box) {
                        var target = targets[Number(box.getAttribute('data-index'))];
                        if (box.checked && !target.Contains) {
                            add.push(target.Id);
                        } else if (!box.checked && target.Contains) {
                            remove.push(target.Id);
                        }
                    });
                    var newName = wrapper.querySelector('#pt-new-playlist').value.trim();
                    if (!add.length && !remove.length && !newName) {
                        close(false);
                        toast(t('plNoChange'));
                        return;
                    }
                    confirm.disabled = true;
                    var steps = Promise.resolve({ Added: [], Removed: [], Failed: [] });
                    if (add.length || remove.length) {
                        steps = request('POST', 'Membership', { json: { ItemId: trackId, Add: add, Remove: remove } });
                    }
                    steps.then(function (result) {
                        if (!newName) {
                            return result;
                        }
                        return request('POST', 'Playlists', { stock: true, json: { Name: newName, Ids: [trackId], UserId: api().getCurrentUserId(), MediaType: 'Audio', IsPublic: false } })
                            .then(function () { result.Added.push(newName); return result; });
                    }).then(function (result) {
                        close(true);
                        toast(t('plDone', result.Added.length, result.Removed.length) + (result.Failed.length ? ' ' + t('plSomeFailed', result.Failed.length) : ''));
                        result.Removed.forEach(function (id) { playlistShrank(id); });
                        var panel = currentPanel;
                        if (panel && !panel.classic && result.Added.concat(result.Removed).some(function (id) { return normalize(id) === normalize(panel.id); })) {
                            panel.load().catch(function () { });
                        }
                    }).catch(function (error) {
                        confirm.disabled = false;
                        reportError(error);
                    });
                });
            });
        }).catch(reportError);
    }

    // The stock "Add to playlist" window (context menu of a song anywhere in the web client) is replaced by the
    // window above when it was opened for exactly one song. The stock window is told to close; anything else
    // (albums, several songs, "New playlist" from a selection) keeps the stock window.
    function takeOverStockEditor(node) {
        var select = node.querySelector && node.querySelector('#selectPlaylistToAddTo');
        if (!select || node.__ptSeen) {
            return;
        }
        node.__ptSeen = true;
        var container = node.closest && node.closest('.dialogContainer') || node;
        var attempts = 0;
        function look() {
            var field = node.querySelector('.fldSelectedItemIds');
            var ids = field && field.value ? field.value.split(',').filter(Boolean) : [];
            if (!ids.length) {
                if (attempts++ < 10) {
                    setTimeout(look, 30);
                }
                return;
            }
            if (ids.length !== 1 || !api()) {
                return;
            }
            container.style.visibility = 'hidden';
            var backdrop = document.querySelector('.dialogBackdropOpened');
            if (backdrop) {
                backdrop.style.visibility = 'hidden';
            }
            Promise.resolve(api().getItem(api().getCurrentUserId(), ids[0])).then(function (item) {
                if (!item || item.Type !== 'Audio') {
                    throw new Error('not a song');
                }
                var cancelButton = node.querySelector('.btnCancel');
                if (cancelButton) {
                    cancelButton.click();
                }
                return playlistsDialog(item.Id, item.Name);
            }).catch(function () {
                container.style.visibility = '';
                if (backdrop) {
                    backdrop.style.visibility = '';
                }
            });
        }
        look();
    }

    new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                if (node.nodeType === 1) {
                    takeOverStockEditor(node);
                }
            });
        });
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    // Resolves to the ids the stock request should still carry (all of them, or none when handled here).
    function confirmDuplicates(playlistId, check) {
        return openDialog(t('dupTitle', check.PlaylistName), function (dialog, close) {
            var wrapper = document.createElement('div');
            wrapper.innerHTML = '<p>' + esc(t('dupIntro', check.Duplicates.length, check.Total)) + '</p><div class="pt-list">' +
                check.Duplicates.map(function (duplicate, index) {
                    var note = duplicate.Kind === 'exact' ? t('dupExact') : t('dupSimilar', duplicate.ExistingAlbum || '?');
                    return '<label class="pt-check"><input type="checkbox" data-index="' + index + '"><span>' +
                        esc(duplicate.Name) + (duplicate.Artist ? ' – ' + esc(duplicate.Artist) : '') +
                        '<br><span class="pt-hint">' + esc(note) + '</span></span></label>';
                }).join('') + '</div>';
            dialog.appendChild(wrapper);

            var row = actions(dialog);
            var cancel = button(t('cancel'));
            var addAll = button(t('dupAddAll'));
            var add = button(t('dupAdd'), 'pt-primary');
            row.appendChild(cancel);
            row.appendChild(addAll);
            row.appendChild(add);
            cancel.addEventListener('click', function () { close(undefined); });
            addAll.addEventListener('click', function () { close('all'); });
            add.addEventListener('click', function () {
                var ids = check.NewIds.slice();
                wrapper.querySelectorAll('input[type="checkbox"]:checked').forEach(function (box) {
                    ids.push(check.Duplicates[Number(box.getAttribute('data-index'))].Id);
                });
                close(ids);
            });
        });
    }

    // ------------------------------------------------------------------ duplicate warning for the stock "add to playlist"
    //
    // The stock dialog adds with POST /Playlists/{id}/Items?ids=... . The request is held back until the
    // check (and, if needed, the user's answer) is in. When the user picks a subset or cancels, the tracks
    // are added through the plugin and the stock request goes out with an empty id list, which the server
    // treats as a no-op, so the stock dialog closes normally.

    var ADD_PATTERN = /\/Playlists\/([0-9a-fA-F-]{32,36})\/Items(?:\?|$)/;

    function parseAdd(method, url) {
        if (!url || String(method).toUpperCase() !== 'POST' || url.indexOf('/PlaylistToolkit/') >= 0) {
            return null;
        }
        var match = ADD_PATTERN.exec(url);
        if (!match) {
            return null;
        }
        var parsed;
        try {
            parsed = new URL(url, window.location.href);
        } catch (error) {
            return null;
        }
        var key = null;
        parsed.searchParams.forEach(function (_, name) {
            if (name.toLowerCase() === 'ids') {
                key = name;
            }
        });
        if (!key) {
            return null;
        }
        var ids = parsed.searchParams.getAll(key).join(',').split(',').filter(Boolean);
        return ids.length ? { playlistId: match[1].replace(/-/g, ''), ids: ids, parsed: parsed, key: key } : null;
    }

    function refreshPanelFor(playlistId) {
        var panel = currentPanel;
        if (panel && panel.id.replace(/-/g, '') === playlistId && !panel.classic) {
            // Once soon, once after the stock request has had time to finish.
            [600, 2500].forEach(function (delay) {
                setTimeout(function () {
                    if (currentPanel === panel && !panel.classic) {
                        panel.load().catch(function () { });
                    }
                }, delay);
            });
        }
    }

    // Returns a promise for the URL to send (unchanged, or with an empty id list).
    function guardAdd(add, url) {
        if (!api()) {
            return Promise.resolve(url);
        }
        return getConfig().then(function (config) {
            if (!config.EnableDuplicateWarning) {
                return url;
            }
            return request('POST', 'Playlists/' + add.playlistId + '/Duplicates', { json: { Ids: add.ids } }).then(function (check) {
                if (!check.Duplicates.length) {
                    return url;
                }
                return confirmDuplicates(add.playlistId, check).then(function (answer) {
                    if (answer === 'all') {
                        return url;
                    }
                    add.parsed.searchParams.delete(add.key);
                    add.parsed.searchParams.set(add.key, '');
                    var emptied = add.parsed.toString();
                    if (!answer || answer.length === 0) {
                        toast(t('dupNothing'));
                        return emptied;
                    }
                    return request('POST', 'Playlists/' + add.playlistId + '/Items', { json: { Ids: answer } }).then(function (result) {
                        toast(t('dupAdded', result.Added, check.Total - answer.length));
                        return emptied;
                    });
                });
            });
        }).catch(function (error) {
            // Never block adding because the check failed.
            console.warn(LOG, 'duplicate check failed, adding unchecked', error);
            return url;
        }).then(function (finalUrl) {
            refreshPanelFor(add.playlistId);
            return finalUrl;
        });
    }

    // The stock menu removes tracks with DELETE /Playlists/{id}/Items?entryIds=...; the running queue follows.
    function parseRemove(method, url) {
        if (!url || String(method).toUpperCase() !== 'DELETE' || url.indexOf('/PlaylistToolkit/') >= 0) {
            return null;
        }
        var match = ADD_PATTERN.exec(url);
        return match ? match[1] : null;
    }

    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url);
        var method = (init && init.method) || (input && input.method) || 'GET';
        var removed = parseRemove(method, url);
        if (removed) {
            return originalFetch(input, init).then(function (response) {
                if (response && response.ok) {
                    playlistShrank(removed);
                }
                return response;
            });
        }
        var add = parseAdd(method, url);
        if (!add || typeof input !== 'string') {
            return originalFetch(input, init);
        }
        return guardAdd(add, url).then(function (finalUrl) { return originalFetch(finalUrl, init); });
    };

    var xhrOpen = XMLHttpRequest.prototype.open;
    var xhrSend = XMLHttpRequest.prototype.send;
    var xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__pp = { method: method, url: String(url), args: arguments, headers: [] };
        var removed = parseRemove(method, String(url));
        if (removed) {
            var request = this;
            this.addEventListener('loadend', function () {
                if (request.status >= 200 && request.status < 300) {
                    playlistShrank(removed);
                }
            });
        }
        return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (this.__pp) {
            this.__pp.headers.push([name, value]);
        }
        return xhrSetHeader.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        var state = xhr.__pp;
        var add = state && parseAdd(state.method, state.url);
        if (!add || state.args[2] === false) {
            return xhrSend.apply(xhr, arguments);
        }
        guardAdd(add, state.url).then(function (finalUrl) {
            try {
                if (finalUrl !== state.url) {
                    // Opening again resets the request; headers have to be set once more.
                    xhrOpen.call(xhr, state.method, finalUrl, true);
                    state.headers.forEach(function (header) { xhrSetHeader.call(xhr, header[0], header[1]); });
                }
                xhrSend.call(xhr, body);
            } catch (error) {
                // The caller aborted the request while the dialog was open.
                console.warn(LOG, error);
            }
        });
    };

    // ------------------------------------------------------------------ queue page ("Recently played" and "Up next")
    //
    // The web client's queue page (#/queue) is rebuilt as a fixed layout: the player (cover, title, controls) stays on top and
    // never scrolls away. Below it are two framed areas, each with its own scroll bar: "Recently played" (left on wide windows,
    // above on narrow ones) and "Up next". The page itself does not scroll, so nothing can make it jump.
    //   - Recently played: newest on top, right under the player, older ones further down: first what this queue has played
    //     (a log kept while the page is open, so a track that was skipped and taken out of the queue is in it at once), then the
    //     last played tracks Jellyfin remembers for the user (UserData LastPlayedDate), 50 per page, loaded when the user
    //     scrolls to the bottom of the frame. The frame opens at the top.
    //   - Up next: the stock list (drag and drop, remove, heart, thumb) with the rows up to the running track hidden.
    // A click on a track of the history plays it at once, right after the running one; the queue goes on behind it.

    var HISTORY_PAGE = 50;
    var HISTORY_MAX_REQUESTS = 4;   // per page of history: requests spent on skipping entries without a real play
    var HISTORY_RETRIES = 3;

    function QueueView(page) {
        this.page = page;
        this.content = page.querySelector('.remoteControlContent');
        this.next = page.querySelector('.playlistSection');
        this.list = page.querySelector('.playlistSection .playlist');
        this.nextStart = 0;
        this.done = false;
        this.loading = false;
        this.queued = false;
        this.failures = 0;
        this.generation = 0;   // a new one for every start: answers of an earlier start are dropped
        this.flash = false;
        this.played = [];      // queue entries this page has seen play, newest first
        this.lastCurrent = null;
    }

    QueueView.prototype.build = function () {
        ensureStyle();
        var self = this;
        var hist = document.createElement('section');
        hist.className = 'pt-q-pane pt-q-hist';
        hist.innerHTML = '<h2 class="pt-q-title">' + esc(t('queueHistory')) + '</h2><div class="pt-q-loading pt-hidden">' + esc(t('queueLoading')) + '</div>' +
            '<div class="pt-q-scroll"><div class="pt-q-session"></div><div class="pt-q-rows"></div></div>';
        this.content.insertBefore(hist, this.next);
        this.hist = hist;
        this.scroller = hist.querySelector('.pt-q-scroll');
        this.rows = hist.querySelector('.pt-q-rows');
        this.session = hist.querySelector('.pt-q-session');
        this.loadingLabel = hist.querySelector('.pt-q-loading');
        var heading = document.createElement('h2');
        heading.className = 'pt-q-title pt-q-next-title';
        heading.textContent = t('queueNext');
        this.next.insertBefore(heading, this.next.firstChild);
        this.nextHeading = heading;
        this.page.classList.add('pt-q-on');
        this.size();
        this.onResize = function () { self.size(); };
        window.addEventListener('resize', this.onResize);
        hist.addEventListener('click', function (event) {
            var link = event.target.closest('a');
            if (link) {
                handleArtistLink(event, link);
                return;
            }
            if (event.target.closest('button')) {
                return; // heart and thumb are the stock buttons
            }
            var row = event.target.closest('.pt-q-row');
            if (row) {
                self.play(row.getAttribute('data-pt-id'), row.getAttribute('data-pt-name'));
            }
        });
        this.scroller.addEventListener('scroll', function () {
            var scroller = self.scroller;
            if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 200) {
                self.loadMore();
            }
        }, { passive: true });
        this.watcher = new MutationObserver(function () { self.queueDecorate(); });
        this.watcher.observe(this.list, { childList: true });
    };

    QueueView.prototype.destroy = function () {
        this.generation++;
        if (this.watcher) {
            this.watcher.disconnect();
        }
        window.removeEventListener('resize', this.onResize);
        this.page.classList.remove('pt-q-on');
        this.content.style.height = '';
        if (this.hist) {
            this.hist.remove();
        }
        if (this.nextHeading) {
            this.nextHeading.remove();
        }
        this.list.querySelectorAll(':scope > .listItem.pt-hidden').forEach(function (row) { row.classList.remove('pt-hidden'); });
    };

    // The page is exactly as high as the window: the fixed layout needs a height to share between the two frames.
    QueueView.prototype.size = function () {
        var top = this.content.getBoundingClientRect().top + window.scrollY;
        this.content.style.height = Math.max(240, window.innerHeight - top - 8) + 'px';
    };

    // The page is shown again: start over with the newest history.
    QueueView.prototype.reset = function () {
        this.rows.innerHTML = '';
        this.session.innerHTML = '';
        this.nextStart = 0;
        this.done = false;
        this.failures = 0;
        this.loading = false;
        this.sessionKey = null;
        window.scrollTo(0, 0);
        this.size();
        this.start();
    };

    QueueView.prototype.start = function () {
        var self = this;
        var generation = ++this.generation;
        var waited = 0;
        (function wait() {
            if (generation !== self.generation) {
                return;
            }
            // The stock page fills its list a moment after it is shown.
            if (self.list.querySelector('.listItem') || waited >= 3000) {
                self.decorate();   // the queue's own rows first, at once
                self.loadMore();
                return;
            }
            waited += 150;
            setTimeout(wait, 150);
        })();
    };

    // Things only a real play counts: PlayCount 0 with a play date comes from something that wrote user data without a
    // playback (for example a sync from another app), so such entries are not "heard".
    function isRealPlay(item) {
        var data = item.UserData || {};
        return !!data.LastPlayedDate && (data.PlayCount || 0) > 0;
    }

    QueueView.prototype.fetchPage = function () {
        var self = this;
        var client = api();
        var found = [];
        var requests = 0;
        function step() {
            if (self.done || found.length >= HISTORY_PAGE || requests >= HISTORY_MAX_REQUESTS) {
                return Promise.resolve(found);
            }
            requests++;
            return Promise.resolve(client.getItems(client.getCurrentUserId(), {
                IncludeItemTypes: 'Audio', Recursive: true, Filters: 'IsPlayed', SortBy: 'DatePlayed', SortOrder: 'Descending',
                Fields: 'AlbumId,ParentId', EnableUserData: true, EnableImageTypes: 'Primary', ImageTypeLimit: 1, StartIndex: self.nextStart, Limit: HISTORY_PAGE
            })).then(function (result) {
                var items = result.Items || [];
                self.nextStart += items.length;
                if (items.length < HISTORY_PAGE) {
                    self.done = true;
                }
                found = found.concat(items.filter(isRealPlay));
                return step();
            });
        }
        return step();
    };

    // Loads the next older page and puts it below the rows that are there (the frame lists newest first, so older rows
    // go to the end and nothing the user looks at moves).
    QueueView.prototype.loadMore = function () {
        var self = this;
        if (this.loading || this.done || !this.page.isConnected) {
            return;
        }
        this.loading = true;
        this.loadingLabel.classList.remove('pt-hidden');
        var generation = this.generation;
        this.fetchPage().then(function (items) {
            if (generation !== self.generation) {
                return;
            }
            self.failures = 0;
            var fragment = document.createDocumentFragment();
            items.forEach(function (item) { fragment.appendChild(self.row(item)); });
            self.rows.appendChild(fragment);
            self.hideShown();
        }).catch(function (error) {
            console.warn(LOG, 'could not load the recently played tracks', error);
            if (generation === self.generation && ++self.failures <= HISTORY_RETRIES) {
                setTimeout(function () { self.loadMore(); }, 1500 * self.failures);
            }
        }).then(function () {
            self.loading = false;
            self.loadingLabel.classList.add('pt-hidden');
            // A frame that is not full has no scroll bar to pull: fill it.
            if (generation === self.generation && !self.done && self.failures === 0 && self.scroller.scrollHeight <= self.scroller.clientHeight + 20) {
                self.loadMore();
            }
        });
    };

    function albumLink(item) {
        return item.AlbumId && item.Album ? '<a href="#/details?id=' + esc(item.AlbumId) + '&amp;serverId=' + esc(api().serverId()) + '" class="pt-link">' + esc(item.Album) + '</a>' : esc(item.Album || '');
    }

    function artistLinks(names) {
        var moved = articleState.on && names.some(function (name) { return splitArticle(name); });
        return names.map(function (name) {
            return '<a href="#" class="pt-link" data-pt-artist="' + esc(name) + '">' + esc(artistLabel(name)) + '</a>';
        }).join(moved ? '; ' : ', ');
    }

    // One row, the same build as a row of the queue: cover, title with artist and album (links), heart (the Dislike plugin
    // adds the thumb next to it). when: small, only in the second line, so it covers no button.
    QueueView.prototype.row = function (item, when) {
        var element = document.createElement('div');
        element.className = 'listItem listItem-border pt-q-row';
        element.setAttribute('data-pt-id', item.Id);
        element.setAttribute('data-pt-name', item.Name || '');
        element.title = t('queuePlayNow');
        var artists = item.Artists && item.Artists.length ? item.Artists : (item.AlbumArtist ? [item.AlbumArtist] : []);
        var date = when === undefined && item.UserData && item.UserData.LastPlayedDate
            ? new Date(item.UserData.LastPlayedDate).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : (when || '');
        var second = [artists.length ? artistLinks(artists) : '', albumLink(item)].filter(Boolean).join(' · ') + (date ? ' <span class="pt-q-when">' + esc(date) + '</span>' : '');
        var imageUrl = null;
        if (item.ImageTags && item.ImageTags.Primary) {
            imageUrl = api().getUrl('Items/' + item.Id + '/Images/Primary', { maxHeight: 90, tag: item.ImageTags.Primary, quality: 90 });
        } else if (item.AlbumId && item.AlbumPrimaryImageTag) {
            imageUrl = api().getUrl('Items/' + item.AlbumId + '/Images/Primary', { maxHeight: 90, tag: item.AlbumPrimaryImageTag, quality: 90 });
        }
        var favorite = !!(item.UserData && item.UserData.IsFavorite);
        element.innerHTML =
            '<div class="listItemImage cardImageContainer defaultCardBackground defaultCardBackground' + (1 + (parseInt(String(item.Id).slice(-2), 16) || 0) % 5) + '" style="' + (imageUrl ? 'background-image:url(&quot;' + esc(imageUrl) + '&quot;)' : '') + '">' +
            (imageUrl ? '' : '<span class="cardImageIcon material-icons audiotrack" aria-hidden="true"></span>') + '</div>' +
            '<div class="listItemBody"><div class="listItemBodyText"><bdi>' + esc(item.Name) + '</bdi></div>' +
            '<div class="listItemBodyText secondary"><bdi>' + second + '</bdi></div></div>' +
            '<button is="emby-ratingbutton" type="button" class="listItemButton paper-icon-button-light emby-button" data-id="' + esc(item.Id) + '" data-serverid="' + esc(api().serverId()) +
            '" data-itemtype="Audio" data-likes="" data-isfavorite="' + (favorite ? 'true' : 'false') + '"><span class="material-icons favorite" aria-hidden="true"></span></button>';
        return element;
    };

    QueueView.prototype.queueDecorate = function () {
        var self = this;
        if (this.queued) {
            return;
        }
        this.queued = true;
        requestAnimationFrame(function () { self.queued = false; self.decorate(); });
    };

    // A history row of a track that this page saw play (or is playing) is hidden: the rows of the queue's own block show it.
    QueueView.prototype.hideShown = function () {
        var shown = this.shownIds || {};
        this.rows.querySelectorAll('.pt-q-row').forEach(function (row) {
            row.classList.toggle('pt-hidden', !!shown[normalize(row.getAttribute('data-pt-id'))]);
        });
    };

    // Keeps the log of what this page saw play: the entry that was running before the current one goes to the top. The first
    // time the queue's entries before the running one are taken over, oldest first. An entry that left the queue meanwhile
    // (skipped by a dislike, removed) stays in the log.
    QueueView.prototype.updateLog = function (queue, current) {
        var self = this;
        var known = {};
        this.played.forEach(function (entry) { known[entry.PlaylistItemId] = true; });
        var added = false;
        var add = function (entry) {
            if (entry && entry.PlaylistItemId && !known[entry.PlaylistItemId]) {
                known[entry.PlaylistItemId] = true;
                self.played.unshift(entry);
                added = true;
            }
        };
        if (current >= 0) {
            queue.slice(0, current).forEach(add);
            var running = queue[current];
            if (this.lastCurrent && (!running || this.lastCurrent.PlaylistItemId !== running.PlaylistItemId)) {
                add(this.lastCurrent);
            }
            this.lastCurrent = running || null;
        }
        if (this.played.length > 200) {
            this.played.length = 200;
        }
        return added;
    };

    // After every change of the queue or of the running track: the rows of the queue up to the running track leave "Up next",
    // the log of played tracks is shown at the top of the history frame, fresh hearts are read for it.
    QueueView.prototype.decorate = function () {
        var self = this;
        if (!getPlayer()) {
            return Promise.resolve();
        }
        return queueItems().then(function (queue) {
            var current = player.getCurrentPlaylistIndex();
            var rows = self.list.querySelectorAll(':scope > .listItem');
            rows.forEach(function (row, index) { row.classList.toggle('pt-hidden', current >= 0 && index <= current); });
            self.updateLog(queue, current);
            var shown = {};
            self.played.forEach(function (entry) { shown[normalize(entry.Id)] = true; });
            if (current >= 0 && queue[current]) {
                shown[normalize(queue[current].Id)] = true;
            }
            self.shownIds = shown;
            var key = self.played.map(function (entry) { return entry.PlaylistItemId; }).join(',');
            var scroller = self.scroller;
            if (key !== self.sessionKey) {
                var heightBefore = scroller.scrollHeight;
                var topBefore = scroller.scrollTop;
                self.sessionKey = key;
                self.session.innerHTML = '';
                self.played.forEach(function (entry) { self.session.appendChild(self.row(entry, '')); });
                if (topBefore > 5) {
                    scroller.scrollTop = topBefore + (scroller.scrollHeight - heightBefore); // not at the top: keep what is looked at
                }
                self.refreshHearts();
            }
            self.hideShown();
            if (self.flash) {
                self.flash = false;
                var head = self.page.querySelector('.nowPlayingInfoContainer');
                var first = self.session.firstElementChild;
                [head, first].forEach(function (target) {
                    if (target) {
                        target.classList.add('pt-q-flash');
                        setTimeout(function () { target.classList.remove('pt-q-flash'); }, 2500);
                    }
                });
            }
        }).catch(function () { });
    };

    // The queue's entries carry the user data of the moment they were queued. The hearts of the log rows are checked
    // against the server; a row whose heart differs is built again.
    QueueView.prototype.refreshHearts = function () {
        var self = this;
        var ids = this.played.slice(0, 40).map(function (entry) { return entry.Id; });
        if (!ids.length) {
            return;
        }
        var generation = this.generation;
        Promise.resolve(api().getItems(api().getCurrentUserId(), { Ids: ids.join(','), EnableUserData: true, Fields: 'AlbumId' })).then(function (result) {
            if (generation !== self.generation) {
                return;
            }
            var fresh = {};
            (result.Items || []).forEach(function (item) { fresh[normalize(item.Id)] = !!(item.UserData && item.UserData.IsFavorite); });
            self.session.querySelectorAll('.pt-q-row').forEach(function (row) {
                var id = normalize(row.getAttribute('data-pt-id'));
                var heart = row.querySelector('button[is="emby-ratingbutton"]');
                if (heart && fresh[id] !== undefined && (heart.getAttribute('data-isfavorite') === 'true') !== fresh[id]) {
                    var entry = self.played.filter(function (e) { return normalize(e.Id) === id; })[0];
                    if (entry) {
                        var copy = Object.assign({}, entry, { UserData: Object.assign({}, entry.UserData || {}, { IsFavorite: fresh[id] }) });
                        row.replaceWith(self.row(copy, ''));
                    }
                }
            });
        }).catch(function () { });
    };

    // A click on a track of the history: it plays at once, right behind the running track; the queue goes on after it.
    // (Not "play next" without starting: the user pointed at a song to hear it now. Not a new queue: that would throw
    // away what is lined up.) The track then is the running one in the player; the track that ran before it appears at the
    // bottom of the history. Both are lit up for a moment, so nothing looks as if it had vanished.
    QueueView.prototype.play = function (id, name) {
        var self = this;
        if (!getPlayer()) {
            return;
        }
        var options = { ids: [id], serverId: api().serverId() };
        queueItems().then(function (queue) {
            self.flash = true;
            if (!queue.length || player.getCurrentPlaylistIndex() < 0) {
                return player.play(options);
            }
            return Promise.resolve(player.queueNext(options)).then(function () { return player.nextTrack(); });
        }).then(function () { toast(t('queuePlaying', name)); self.queueDecorate(); }).catch(reportError);
    };

    function setupQueuePage(page) {
        if (!api() || !page || document.documentElement.classList.contains('layout-tv')) {
            return;
        }
        var view = page.__ptQueue;
        if (view && view.content === page.querySelector('.remoteControlContent') && view.list === page.querySelector('.playlistSection .playlist') && view.hist && view.hist.isConnected) {
            view.reset();
            return;
        }
        if (view) {
            view.destroy();
            page.__ptQueue = null;
        }
        if (!page.querySelector('.remoteControlContent') || !page.querySelector('.playlistSection .playlist')) {
            return;
        }
        view = new QueueView(page);
        page.__ptQueue = view;
        view.build();
        view.start();
    }

    document.addEventListener('viewshow', function (event) {
        var page = event.target;
        if (page && page.classList && page.classList.contains('nowPlayingPage') && /#\/queue/.test(window.location.hash)) {
            setupQueuePage(page);
        }
    }, true);

    // Artist names in the table and in the history are links to the artist page of the web client. The page needs the
    // artist's id, which the row does not carry: it is looked up by name when the link is clicked.
    function handleArtistLink(event, link) {
        var name = link.getAttribute('data-pt-artist');
        if (!name) {
            return false; // an ordinary link (album): the address does the work
        }
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve(api().getArtist(name, api().getCurrentUserId())).then(function (artist) {
            if (artist && artist.Id) {
                closeMenu();
                window.location.hash = '#/details?id=' + artist.Id + '&serverId=' + api().serverId();
            }
        }).catch(reportError);
        return true;
    }

    // ------------------------------------------------------------------ hooking the details page

    // The stock playlist list is rendered through properties set on the items container. The trap keeps
    // the stock functions but answers with an empty list while the table is shown, so the stock page does
    // not fetch and build thousands of rows that nobody sees.
    function trapStockList(page) {
        var container = page.querySelector('#childrenContent .itemsContainer');
        if (!container || container.__ptTrap) {
            return;
        }
        var stockFetch = container.fetchData || null;
        container.__ptTrap = true;
        Object.defineProperty(container, 'fetchData', {
            configurable: true,
            get: function () {
                if (!stockFetch) {
                    return stockFetch;
                }
                return function () {
                    var decision = page.__ptDecision || Promise.resolve(false);
                    return decision.then(function (tableActive) {
                        var panel = page.__ptPanel;
                        if (tableActive && panel && !panel.classic) {
                            return { Items: [], TotalRecordCount: 0 };
                        }
                        return stockFetch();
                    });
                };
            },
            set: function (value) { stockFetch = value; }
        });
    }

    function onViewShow(event) {
        var page = event.target;
        if (!page || !page.classList || !page.classList.contains('itemDetailPage') || !api()) {
            return;
        }
        var params = (event.detail && event.detail.params) || {};
        var id = params.id;
        if (!id || document.documentElement.classList.contains('layout-tv')) {
            return;
        }

        closeMenu();
        var existing = page.__ptPanel;
        if (existing && existing.id === id) {
            currentPanel = existing;
            if (!existing.classic) {
                existing.load().catch(function () { });
            }
            return;
        }

        if (existing) {
            // The page element is reused for another item.
            if (existing.root) {
                existing.root.remove();
            }
            existing.stockContainer().classList.remove('pt-hidden');
            page.__ptPanel = null;
            if (currentPanel === existing) {
                currentPanel = null;
            }
        }

        trapStockList(page);
        page.__ptDecision = Promise.all([getConfig(), request('GET', 'Playlists/' + id)]).then(function (results) {
            var config = results[0];
            if (page.__ptPanel && page.__ptPanel.root) {
                page.__ptPanel.root.remove();
            }
            var panel = new Panel(page, id);
            panel.info = results[1];
            panel.config = config;
            panel.isAudio = panel.info.MediaType === 'Audio';
            panel.tableEnabled = config.EnableTrackTable && panel.isAudio;
            page.__ptPanel = panel;
            currentPanel = panel;
            panel.build();
            if (panel.tableEnabled) {
                panel.stockContainer().classList.add('pt-hidden');
                panel.load().catch(reportError);
            }
            return panel.tableEnabled;
        }).catch(function (error) {
            // 404: not a playlist (or not visible). Anything else: leave the stock page alone.
            if (error.status !== 404) {
                console.warn(LOG, error);
            }
            return false;
        });
    }

    var framePending = false;
    function onScrollOrResize(event) {
        if (!currentPanel || framePending) {
            return;
        }
        framePending = true;
        requestAnimationFrame(function () {
            framePending = false;
            if (!currentPanel) {
                return;
            }
            if (event.type === 'resize') {
                currentPanel.updateView();
            } else {
                currentPanel.updateSticky();
                currentPanel.renderRows();
            }
        });
    }

    // If the script arrives after the first page was shown, pick that page up.
    function bootstrap() {
        var queuePage = document.querySelector('.nowPlayingPage:not(.hide)');
        if (queuePage && /#\/queue/.test(window.location.hash) && !queuePage.__ptQueue) {
            setupQueuePage(queuePage);
        }
        if (api() && api().getCurrentUserId()) {
            loadArticles();
        }
        var page = document.querySelector('.itemDetailPage:not(.hide)');
        var match = /[?&]id=([0-9a-fA-F-]+)/.exec(window.location.hash);
        if (page && match && !page.__ptPanel && !page.__ptDecision) {
            onViewShow({ target: page, detail: { params: { id: match[1] } } });
        }
    }

    hookRatings();
    document.addEventListener('viewshow', function () { hookRatings(); if (api() && api().getCurrentUserId()) { loadArticles(); } }, true);
    new MutationObserver(queueArtistLabels).observe(document.body || document.documentElement, { childList: true, subtree: true });
    document.addEventListener('viewshow', onViewShow, true);
    setTimeout(bootstrap, 1500);
    setTimeout(bootstrap, 5000);
    setInterval(function () { if (!document.hidden) { refreshSmart(); } }, 2000);
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    window.__playlistToolkit = { columns: COLUMNS, getPanel: function () { return currentPanel; }, getPlayer: getPlayer, openAdmin: openAdmin };
    console.debug(LOG, 'client script loaded');
})();
