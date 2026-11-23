using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Extensions;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// The albums and artists a user disliked (Jellyfin's rating <c>Likes == false</c> on the album or artist item).
/// </summary>
/// <param name="AlbumIds">Ids of the disliked albums.</param>
/// <param name="ArtistCleanNames">Clean names of the disliked artists. Artists are matched by clean name, like the server's own artist filter.</param>
public sealed record ContainerDislikes(IReadOnlySet<Guid> AlbumIds, IReadOnlySet<string> ArtistCleanNames)
{
    /// <summary>Gets the instance without any dislike.</summary>
    public static ContainerDislikes None { get; } = new(new HashSet<Guid>(), new HashSet<string>());

    /// <summary>Gets a value indicating whether nothing is disliked.</summary>
    public bool IsEmpty => AlbumIds.Count == 0 && ArtistCleanNames.Count == 0;
}

/// <summary>
/// Which songs a disliked artist covers.
/// </summary>
public enum ArtistDislikeScope
{
    /// <summary>The artist is one of the song's album artists.</summary>
    AlbumArtist,

    /// <summary>The artist is one of the album artists, or the first track artist (the main artist).</summary>
    AlbumOrMainArtist,

    /// <summary>The artist is an album artist or any track artist.</summary>
    AnyArtist
}

/// <summary>
/// The rule that decides whether a disliked album or artist covers a song. Same rule as the Dislike plugin's
/// default (a song with a heart is protected by the caller of this class, not here).
/// </summary>
public static class ContainerDislikeRule
{
    /// <summary>
    /// Parses a setting value; unknown or empty values give <see cref="ArtistDislikeScope.AlbumOrMainArtist"/>.
    /// </summary>
    /// <param name="value">The stored value.</param>
    /// <returns>The scope.</returns>
    public static ArtistDislikeScope ParseScope(string? value)
    {
        return Enum.TryParse<ArtistDislikeScope>(value?.Trim(), true, out var scope) && Enum.IsDefined(scope)
            ? scope
            : ArtistDislikeScope.AlbumOrMainArtist;
    }

    /// <summary>
    /// Tells whether a disliked album or artist covers the song.
    /// </summary>
    /// <param name="dislikes">The disliked albums and artists.</param>
    /// <param name="albumId">The song's album (nearest album ancestor), if any.</param>
    /// <param name="albumArtists">Names of the song's album artists.</param>
    /// <param name="artists">Names of the song's track artists in tag order (the first is the main artist).</param>
    /// <param name="scope">Which artists count.</param>
    /// <returns>True when the song is covered.</returns>
    public static bool Covers(ContainerDislikes dislikes, Guid? albumId, IEnumerable<string> albumArtists, IReadOnlyList<string> artists, ArtistDislikeScope scope)
    {
        ArgumentNullException.ThrowIfNull(dislikes);
        ArgumentNullException.ThrowIfNull(albumArtists);
        ArgumentNullException.ThrowIfNull(artists);

        if (albumId is { } album && dislikes.AlbumIds.Contains(album))
        {
            return true;
        }

        if (dislikes.ArtistCleanNames.Count == 0)
        {
            return false;
        }

        if (albumArtists.Any(a => dislikes.ArtistCleanNames.Contains(a.GetCleanValue())))
        {
            return true;
        }

        return scope switch
        {
            ArtistDislikeScope.AnyArtist => artists.Any(a => dislikes.ArtistCleanNames.Contains(a.GetCleanValue())),
            ArtistDislikeScope.AlbumOrMainArtist => artists.Select(a => a.GetCleanValue()).FirstOrDefault(c => !string.IsNullOrEmpty(c)) is { } main
                && dislikes.ArtistCleanNames.Contains(main),
            _ => false
        };
    }
}
