using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Normalized comparison keys for titles and artists.
/// </summary>
public static class TextKeys
{
    /// <summary>
    /// Lower-cases and keeps only letters and digits, so punctuation and spacing differences do not matter.
    /// </summary>
    /// <param name="value">Text.</param>
    /// <returns>Normalized text, possibly empty.</returns>
    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length);
        foreach (var c in value.Normalize(NormalizationForm.FormKC))
        {
            if (char.IsLetterOrDigit(c))
            {
                builder.Append(char.ToLower(c, CultureInfo.InvariantCulture));
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// Gets the artist names of an item: track artists, else album artists.
    /// </summary>
    /// <param name="item">Item.</param>
    /// <returns>Artist names, possibly empty.</returns>
    public static IReadOnlyList<string> GetArtists(BaseItem item)
    {
        if (item is IHasArtist hasArtist && hasArtist.Artists.Count > 0)
        {
            return hasArtist.Artists;
        }

        if (item is IHasAlbumArtist hasAlbumArtist && hasAlbumArtist.AlbumArtists.Count > 0)
        {
            return hasAlbumArtist.AlbumArtists;
        }

        return [];
    }

    /// <summary>
    /// Gets the normalized primary artist, or null if the item has none.
    /// </summary>
    /// <param name="item">Item.</param>
    /// <returns>Key or null.</returns>
    public static string? PrimaryArtistKey(BaseItem item)
    {
        var artists = GetArtists(item);
        if (artists.Count == 0)
        {
            return null;
        }

        var key = Normalize(artists[0]);
        return key.Length == 0 ? null : key;
    }

    /// <summary>
    /// Gets a "title by artist" key, or null if title or artist is missing.
    /// </summary>
    /// <param name="title">Title.</param>
    /// <param name="artist">Artist.</param>
    /// <returns>Key or null.</returns>
    public static string? SongKey(string? title, string? artist)
    {
        var t = Normalize(title);
        var a = Normalize(artist);
        return t.Length == 0 || a.Length == 0 ? null : string.Concat(t, "|", a);
    }

    /// <summary>
    /// Gets the song key of a library item.
    /// </summary>
    /// <param name="item">Item.</param>
    /// <returns>Key or null.</returns>
    public static string? SongKey(BaseItem item)
    {
        var artists = GetArtists(item);
        return artists.Count == 0 ? null : SongKey(item.Name, artists[0]);
    }
}
