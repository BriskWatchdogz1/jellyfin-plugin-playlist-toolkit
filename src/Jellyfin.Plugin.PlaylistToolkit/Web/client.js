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

    if (window.__playlistToolkit) {
        return;
    }

    var LOG = '[PlaylistToolkit]';
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
            back: 'Back to the list', noOwner: 'no owner', visPrivate: 'private', visShared: 'shared with {0}', visPublic: 'public'
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
            back: 'Zurück zur Liste', noOwner: 'kein Besitzer', visPrivate: 'privat', visShared: 'geteilt mit {0}', visPublic: 'öffentlich'
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

    var NARROW_WIDTH = 480;

    var COLUMNS = [
        { id: 'index', label: '#', width: '3.4em', align: 'right', hideBelow: 480, sortValue: function (r) { return r.Index; }, text: function (r) { return String(r.Index + 1); } },
        { id: 'title', labelKey: 'colTitle', width: 'minmax(6em, 3fr)', text: function (r) { return r.Name; } },
        { id: 'artist', labelKey: 'colArtist', width: 'minmax(4em, 2fr)', hideBelow: 480, text: function (r) { return (r.Artists || []).join(', '); } },
        {
            id: 'album', labelKey: 'colAlbum', width: 'minmax(5em, 2fr)', hideBelow: 640,
            text: function (r) { return r.Album || ''; },
            link: function (r) { return r.AlbumId ? '#/details?id=' + r.AlbumId + '&serverId=' + api().serverId() : null; }
        },
        { id: 'duration', labelKey: 'colDuration', width: '4.6em', align: 'right', sortValue: function (r) { return r.RunTimeTicks || 0; }, text: function (r) { return formatDuration(r.RunTimeTicks); } }
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

        return originalFetch(api().getUrl('PlaylistToolkit/' + path, options.query), { method: method, headers: headers, body: body, credentials: 'same-origin' })
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
            entry.promise = request('GET', 'Config').catch(function (error) {
                if (configCache === entry) {
                    configCache = { userId: null, promise: null };
                }
                throw error;
            });
            configCache = entry;
        }
        return configCache.promise;
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
    var session = null;        // the queue this script filled last: { firstIds, anchors, total, busy, source }
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
    var ANCHOR_COUNT = 50;

    function ownsQueue(items, current) {
        return items.some(function (entry) { return current.anchors.indexOf(entry.PlaylistItemId) >= 0; });
    }

    function rememberEntries(current, entries) {
        current.anchors = current.anchors.concat(entries.map(function (entry) { return entry.PlaylistItemId; })).slice(-ANCHOR_COUNT);
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

                    var part = ids.slice(index, index + size);
                    return Promise.resolve(player.queue({ ids: part, serverId: api().serverId() })).then(queueItems).then(function (after) {
                        // Where the part ended up: normally at the very end; further up if the user
                        // queued something behind it meanwhile.
                        var block = null;
                        for (var start = after.length - part.length; start >= 0 && !block; start--) {
                            var candidate = after.slice(start, start + part.length);
                            if (candidate.every(function (entry, i) { return entry.Id === part[i]; })) {
                                block = candidate;
                            }
                        }
                        if (session !== current || !ownsQueue(after, current)) {
                            if (block && typeof player.removeFromPlaylist === 'function') {
                                player.removeFromPlaylist(block.map(function (entry) { return entry.PlaylistItemId; }));
                            }
                            abandon(current);
                            return false;
                        }
                        if (!block) {
                            abandon(current);
                            return false;
                        }
                        rememberEntries(current, block);
                        index += part.length;
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
            var current = { id: ++sessionCounter, firstIds: first, anchors: [], total: first.length, busy: true, source: source || null };
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

    // Endless mode: called whenever a track starts. When a smart shuffle queue is almost through, a new
    // order is fetched (the server keeps the artist of the last track from opening it and puts what was
    // just heard at the back) and appended, so playback never stops.
    function onTrackStart() {
        var current = session;
        if (!player || !current || current.busy || !current.source || !current.source.smart) {
            return;
        }
        getEndless().then(function (enabled) {
            if (!enabled || session !== current || current.busy) {
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
            '<button type="button" class="pt-btn pt-primary pt-shuffle" title="' + esc(t('smartShuffleHint')) + '"><span class="material-icons shuffle" aria-hidden="true"></span><span>' + esc(t('smartShuffle')) + '</span></button>' +
            '<label class="pt-endless" title="' + esc(t('endlessHint')) + '"><input type="checkbox" class="pt-endless-box" checked><span>' + esc(t('endless')) + '</span></label>' +
            '<input type="search" class="pt-input pt-filter" placeholder="' + esc(t('filter')) + '" aria-label="' + esc(t('filter')) + '">' +
            '<button type="button" class="pt-btn pt-more" data-pt-menu title="' + esc(t('more')) + '" aria-label="' + esc(t('more')) + '"><span class="material-icons more_horiz" aria-hidden="true"></span></button>' +
            '<span class="pt-summary"></span>' +
            '</div>' +
            '<div class="pt-table" role="table"><div class="pt-head" role="row"></div><div class="pt-body" role="rowgroup"></div></div>' +
            '<div class="pt-message pt-hidden"></div>';
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
            if (event.target.closest('a')) {
                if (self.onNavigate) {
                    self.onNavigate();
                }
                return;
            }
            var index = Number(rowElement.getAttribute('data-i'));
            var menuButton = event.target.closest('[data-pt-menu]');
            if (menuButton) {
                self.showRowMenu(menuButton, index);
            } else {
                self.playFrom(index);
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
            return '<button type="button" role="columnheader" class="pt-th' + (column.align === 'right' ? ' pt-right' : '') + '" data-col="' + column.id + '"' +
                ' aria-sort="' + (active ? (self.sort.descending ? 'descending' : 'ascending') : 'none') + '">' + esc(label) + arrow + '</button>';
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
            rows.sort(function (a, b) { return direction * collator.compare(column.text(a), column.text(b)) || a.Index - b.Index; });
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
                if (column.id === 'index') {
                    inner = '<span class="pt-num">' + esc(text) + '</span><span class="material-icons play_arrow pt-play" aria-hidden="true"></span>';
                } else if (column.id === 'title' && this.narrow) {
                    inner = '<div class="pt-line">' + esc(text) + '</div><div class="pt-line pt-dim">' + esc((row.Artists || []).join(', ')) + '</div>';
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

    Panel.prototype.playFrom = function (index) {
        playAll(this.viewIds(), index, { playlistId: this.id, smart: false });
    };

    Panel.prototype.smartShuffle = function () {
        var buttonElement = this.root.querySelector('.pt-shuffle');
        buttonElement.disabled = true;
        var source = { playlistId: this.id, smart: true };
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
            .then(function () { buttonElement.disabled = false; });
    };

    // Moves and removals go through the plugin: its rights also cover administrators, whom the stock
    // endpoints refuse on playlists of other users.
    Panel.prototype.edit = function (method, path, query) {
        var self = this;
        return request(method, 'Playlists/' + this.id + '/' + path, { query: query })
            .then(function () { return self.load(); })
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
            { label: t('addToQueue'), icon: 'queue_music', run: function () { playExtra([row.Id], 'last'); } }
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
        showMenu(anchor, items);
    };

    Panel.prototype.showPlaylistMenu = function (anchor) {
        var self = this;
        var items = [];
        if (this.info.CanManage) {
            items.push({ label: t('editDetails'), icon: 'image', run: function () { detailsDialog(self); } });
        }
        if (this.info.CanShare) {
            items.push({ label: t('share'), icon: 'group', run: function () { shareDialog(self); } });
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
                                var text = (entry.Name + '\n' + (entry.OwnerName || '')).toLowerCase();
                                return words.every(function (word) { return text.indexOf(word) >= 0; });
                            });
                            list.innerHTML = shown.length ? '' : '<p class="pt-message">' + esc(t('adminNone')) + '</p>';
                            shown.forEach(function (entry) {
                                var item = document.createElement('button');
                                item.type = 'button';
                                item.className = 'pt-admin-item';
                                item.innerHTML = '<span><strong>' + esc(entry.Name) + '</strong></span><span>' + esc(entry.OwnerName || t('noOwner')) +
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

    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url);
        var method = (init && init.method) || (input && input.method) || 'GET';
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
        var page = document.querySelector('.itemDetailPage:not(.hide)');
        var match = /[?&]id=([0-9a-fA-F-]+)/.exec(window.location.hash);
        if (page && match && !page.__ptPanel && !page.__ptDecision) {
            onViewShow({ target: page, detail: { params: { id: match[1] } } });
        }
    }

    document.addEventListener('viewshow', onViewShow, true);
    setTimeout(bootstrap, 1500);
    setTimeout(bootstrap, 5000);
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    window.__playlistToolkit = { columns: COLUMNS, getPanel: function () { return currentPanel; }, getPlayer: getPlayer, openAdmin: openAdmin };
    console.debug(LOG, 'client script loaded');
})();
