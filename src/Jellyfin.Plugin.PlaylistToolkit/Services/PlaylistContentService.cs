using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PlaylistToolkit.Api;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Reads and changes the tracks of a playlist.
/// </summary>
public class PlaylistContentService
{
    private readonly ILibraryManager _libraryManager;
    private readonly IPlaylistManager _playlistManager;
    private readonly IUserDataManager _userDataManager;
    private readonly IContainerDislikeReader _containerDislikes;

    /// <summary>
    /// Initializes a new instance of the <see cref="PlaylistContentService"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="playlistManager">Playlist manager.</param>
    /// <param name="userDataManager">User data manager.</param>
    /// <param name="containerDislikes">Reader for the albums and artists a user disliked.</param>
    public PlaylistContentService(ILibraryManager libraryManager, IPlaylistManager playlistManager, IUserDataManager userDataManager, IContainerDislikeReader containerDislikes)
    {
        _containerDislikes = containerDislikes;
        _libraryManager = libraryManager;
        _playlistManager = playlistManager;
        _userDataManager = userDataManager;
    }

    /// <summary>
    /// Gets the playlist entries the user may see, in playlist order.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <returns>Entries.</returns>
    public static List<Tuple<LinkedChild, BaseItem>> GetVisibleEntries(Playlist playlist, User user)
    {
        var isVisible = VisibilityCheck(user);
        return playlist.GetManageableItems().Where(e => isVisible(e.Item2)).ToList();
    }

    /// <summary>
    /// Creates a check for "the user may see this item". Unlike the stock playlist endpoint, which only
    /// looks at parental rating and tags, this also respects library access: a track from a library the
    /// user has no access to stays hidden even when it is in a playlist shared with that user.
    /// </summary>
    /// <param name="user">User.</param>
    /// <returns>The check. It caches the folder part per parent folder, so long playlists stay fast.</returns>
    public static Func<BaseItem, bool> VisibilityCheck(User user)
    {
        var folders = new Dictionary<Guid, bool>();
        return item =>
        {
            if (!item.IsVisible(user))
            {
                return false;
            }

            if (folders.TryGetValue(item.ParentId, out var folderVisible))
            {
                return folderVisible;
            }

            // The parent's standalone check covers its own visibility, all folders above it and the
            // user's library access; together with the item's own check above this equals
            // item.IsVisibleStandalone(user).
            var parent = item.GetParent();
            folderVisible = parent is null ? item.IsVisibleStandalone(user) : parent.IsVisibleStandalone(user);
            folders[item.ParentId] = folderVisible;
            return folderVisible;
        };
    }

    /// <summary>
    /// Builds the rows of the track table.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <returns>Rows in playlist order.</returns>
    public TrackListDto GetRows(Playlist playlist, User user)
    {
        var entries = GetVisibleEntries(playlist, user);
        var marks = _userDataManager.GetUserDataBatch(entries.Select(e => e.Item2).ToList(), user);
        var result = new TrackListDto { TotalRecordCount = entries.Count };
        result.Items.Capacity = entries.Count;

        for (var i = 0; i < entries.Count; i++)
        {
            var (link, item) = entries[i];
            result.Items.Add(new TrackRowDto
            {
                Index = i,
                PlaylistItemId = link.ItemId?.ToString("N", CultureInfo.InvariantCulture) ?? string.Empty,
                Id = item.Id,
                Type = item.GetBaseItemKind().ToString(),
                Name = item.Name ?? string.Empty,
                Artists = TextKeys.GetArtists(item),
                Album = item.Album,
                AlbumId = item is Audio ? AlbumIdOf(item) : null,
                RunTimeTicks = item.RunTimeTicks,
                HasImage = item.HasImage(ImageType.Primary, 0),
                IsFavorite = marks.TryGetValue(item.Id, out var mark) && mark.IsFavorite,
                IsDisliked = mark is not null && mark.Likes == false
            });
            result.TotalRunTimeTicks += item.RunTimeTicks ?? 0;
        }

        return result;
    }

    /// <summary>
    /// Checks which of the given items are already in the playlist.
    /// Containers (albums, artists, genres, folders) are expanded to their tracks exactly like the stock "add to playlist".
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <param name="ids">Ids about to be added.</param>
    /// <returns>Duplicates and new tracks.</returns>
    public DuplicateCheckDto FindDuplicates(Playlist playlist, User user, IReadOnlyCollection<Guid> ids)
    {
        var candidates = Expand(ids, user);

        // Only entries the user may see count: a duplicate report must not reveal hidden tracks.
        var existing = GetVisibleEntries(playlist, user);

        var existingIds = new HashSet<Guid>();
        var existingSongs = new Dictionary<string, BaseItem>(StringComparer.Ordinal);
        foreach (var (_, item) in existing)
        {
            existingIds.Add(item.Id);
            var key = TextKeys.SongKey(item);
            if (key is not null)
            {
                existingSongs.TryAdd(key, item);
            }
        }

        var result = new DuplicateCheckDto { PlaylistName = playlist.Name ?? string.Empty, Total = candidates.Count };
        foreach (var candidate in candidates)
        {
            string? kind = null;
            BaseItem? match = null;
            if (existingIds.Contains(candidate.Id))
            {
                kind = "exact";
            }
            else
            {
                var key = TextKeys.SongKey(candidate);
                if (key is not null && existingSongs.TryGetValue(key, out match))
                {
                    kind = "similar";
                }
            }

            if (kind is null)
            {
                result.NewIds.Add(candidate.Id);
                continue;
            }

            result.Duplicates.Add(new DuplicateDto
            {
                Id = candidate.Id,
                Name = candidate.Name ?? string.Empty,
                Artist = TextKeys.GetArtists(candidate).FirstOrDefault(),
                Album = candidate.Album,
                Kind = kind,
                ExistingAlbum = match?.Album
            });
        }

        return result;
    }

    /// <summary>
    /// Describes how a track relates to a playlist: already in it, or the same song from another album.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <param name="track">The track.</param>
    /// <returns>Whether the track is in the playlist, and the album of a same-named song otherwise.</returns>
    public (bool Contains, string? SimilarAlbum) Relation(Playlist playlist, User user, BaseItem track)
    {
        if (playlist.LinkedChildren.Any(c => c.ItemId.HasValue && c.ItemId.Value.Equals(track.Id)))
        {
            return (true, null);
        }

        var key = TextKeys.SongKey(track);
        if (key is null)
        {
            return (false, null);
        }

        var match = GetVisibleEntries(playlist, user).Select(e => e.Item2).FirstOrDefault(i => TextKeys.SongKey(i) == key);
        return (false, match is null ? null : (match.Album ?? string.Empty));
    }

    /// <summary>
    /// Gets the entry ids of a track in a playlist (more than one when it was added twice).
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="trackId">Track id.</param>
    /// <returns>Entry ids as used by the remove call.</returns>
    public static List<string> EntryIdsOf(Playlist playlist, Guid trackId)
    {
        return playlist.LinkedChildren
            .Where(c => c.ItemId.HasValue && c.ItemId.Value.Equals(trackId))
            .Select(c => c.ItemId!.Value.ToString("N", CultureInfo.InvariantCulture))
            .ToList();
    }

    /// <summary>
    /// Appends tracks to the playlist.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <param name="ids">Item ids.</param>
    /// <returns>Number of tracks added.</returns>
    public async Task<int> AddItems(Playlist playlist, User user, IReadOnlyCollection<Guid> ids)
    {
        if (ids.Count == 0)
        {
            return 0;
        }

        // Expanded and filtered here, so nothing the user may not see can be added by guessing an id.
        var trackIds = Expand(ids, user).Select(i => i.Id).ToArray();
        if (trackIds.Length == 0)
        {
            return 0;
        }

        await _playlistManager.AddItemToPlaylistAsync(playlist.Id, trackIds, null, user.Id).ConfigureAwait(false);
        return trackIds.Length;
    }

    /// <summary>
    /// Computes a smart shuffle order for the playlist.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User whose play history decides what is "recent".</param>
    /// <param name="recentWindow">How long a track counts as recently played.</param>
    /// <param name="random">Random source.</param>
    /// <param name="after">Track that plays right before this order (endless mode); its artist does not open the new order.</param>
    /// <param name="pending">Tracks still waiting in the running queue (endless mode). They are about to play, so they come last in the new order instead of opening it.</param>
    /// <returns>Item ids in play order.</returns>
    public List<Guid> SmartShuffle(Playlist playlist, User user, TimeSpan recentWindow, Random random, Guid? after = null, IReadOnlyCollection<Guid>? pending = null)
    {
        var items = GetVisibleEntries(playlist, user).Select(e => e.Item2).ToList();
        var userData = _userDataManager.GetUserDataBatch(items, user);
        if (Plugin.Instance?.Configuration.SmartShuffleSkipDisliked ?? true)
        {
            // Songs the caller disliked (Jellyfin's own rating) do not take part, unless nothing else is left. The same
            // goes for songs of a disliked album or artist, unless the song itself has a heart.
            var containers = _containerDislikes.Read(user.Id);
            var scope = ContainerDislikeRule.ParseScope(Plugin.Instance?.Configuration.SmartShuffleArtistDislikeScope);
            items = SmartShuffler.WithoutDisliked(items, i =>
            {
                if (userData.TryGetValue(i.Id, out var d) && d.Likes == false)
                {
                    return true;
                }

                if (containers.IsEmpty || (d is not null && d.IsFavorite) || i is not Audio song)
                {
                    return false;
                }

                return ContainerDislikeRule.Covers(containers, AlbumIdOf(song), song.AlbumArtists, song.Artists, scope);
            });
        }

        var waiting = pending is null ? null : new HashSet<Guid>(pending);
        var tracks = new ShuffleTrack[items.Count];
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            DateTime? lastPlayed = userData.TryGetValue(item.Id, out var data) ? data.LastPlayedDate : null;

            // Tracks without artist must not block each other.
            var artistKey = TextKeys.PrimaryArtistKey(item) ?? string.Concat("\0", item.Id.ToString("N", CultureInfo.InvariantCulture));
            tracks[i] = new ShuffleTrack(artistKey, lastPlayed, waiting is not null && waiting.Contains(item.Id));
        }

        string? previousArtist = null;
        if (after.HasValue && _libraryManager.GetItemById(after.Value) is { } previous)
        {
            previousArtist = TextKeys.PrimaryArtistKey(previous);
        }

        var order = SmartShuffler.Shuffle(tracks, DateTime.UtcNow, recentWindow, random, previousArtist);
        return order.Select(i => items[i].Id).ToList();
    }

    /// <summary>
    /// Removes entries from the playlist.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="entryIds">Entry ids as used in <see cref="TrackRowDto.PlaylistItemId"/>.</param>
    /// <returns>Task.</returns>
    public Task RemoveItems(Playlist playlist, IReadOnlyCollection<string> entryIds)
    {
        return _playlistManager.RemoveItemFromPlaylistAsync(playlist.Id.ToString("N", CultureInfo.InvariantCulture), entryIds);
    }

    /// <summary>
    /// Moves an entry to a new position.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="entryId">Entry id.</param>
    /// <param name="newIndex">New 0-based position among the entries the user can see.</param>
    /// <param name="user">Calling user.</param>
    /// <returns>Task.</returns>
    public Task MoveItem(Playlist playlist, string entryId, int newIndex, User user)
    {
        return _playlistManager.MoveItemAsync(playlist.Id.ToString("N", CultureInfo.InvariantCulture), entryId, newIndex, user.Id);
    }

    private static Guid? AlbumIdOf(BaseItem item)
    {
        var album = item.FindParent<MusicAlbum>();
        return album?.Id;
    }

    private List<BaseItem> Expand(IEnumerable<Guid> ids, User user)
    {
        var items = ids.Select(id => _libraryManager.GetItemById(id)).Where(i => i is not null).Select(i => i!);
        var isVisible = VisibilityCheck(user);
        return Playlist.GetPlaylistItems(items, user, new DtoOptions(false))
            .Where(i => i.SupportsAddingToPlaylist && isVisible(i))
            .ToList();
    }
}
