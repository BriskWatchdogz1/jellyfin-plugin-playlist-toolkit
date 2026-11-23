using System;
using System.Collections.Generic;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// Sort key of a song: album artist, album, disc, track, name, id.
/// </summary>
/// <param name="AlbumArtist">Album artist (else artist).</param>
/// <param name="Album">Album.</param>
/// <param name="Disc">Disc number, 0 when unknown.</param>
/// <param name="Track">Track number, 0 when unknown.</param>
/// <param name="Name">Title.</param>
/// <param name="Id">Item id, the last tie-breaker.</param>
public sealed record TrackSortKey(string AlbumArtist, string Album, int Disc, int Track, string Name, Guid Id);

/// <summary>
/// The order in which songs that enter an automatic playlist together are arranged.
/// </summary>
public sealed class TrackOrder : IComparer<TrackSortKey>
{
    /// <summary>Gets the shared instance.</summary>
    public static TrackOrder Instance { get; } = new();

    /// <summary>
    /// Builds the sort key of an item.
    /// </summary>
    /// <param name="item">Item.</param>
    /// <returns>Key.</returns>
    public static TrackSortKey FromItem(BaseItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var artist = string.Empty;
        if (item is IHasAlbumArtist hasAlbumArtist && hasAlbumArtist.AlbumArtists.Count > 0)
        {
            artist = hasAlbumArtist.AlbumArtists[0];
        }
        else if (item is IHasArtist hasArtist && hasArtist.Artists.Count > 0)
        {
            artist = hasArtist.Artists[0];
        }

        return new TrackSortKey(artist, item.Album ?? string.Empty, item.ParentIndexNumber ?? 0, item.IndexNumber ?? 0, item.Name ?? string.Empty, item.Id);
    }

    /// <inheritdoc />
    public int Compare(TrackSortKey? x, TrackSortKey? y)
    {
        if (ReferenceEquals(x, y))
        {
            return 0;
        }

        if (x is null)
        {
            return -1;
        }

        if (y is null)
        {
            return 1;
        }

        var result = string.Compare(x.AlbumArtist, y.AlbumArtist, StringComparison.OrdinalIgnoreCase);
        if (result != 0)
        {
            return result;
        }

        result = string.Compare(x.Album, y.Album, StringComparison.OrdinalIgnoreCase);
        if (result != 0)
        {
            return result;
        }

        result = x.Disc.CompareTo(y.Disc);
        if (result != 0)
        {
            return result;
        }

        result = x.Track.CompareTo(y.Track);
        if (result != 0)
        {
            return result;
        }

        result = string.Compare(x.Name, y.Name, StringComparison.OrdinalIgnoreCase);
        return result != 0 ? result : x.Id.CompareTo(y.Id);
    }
}
