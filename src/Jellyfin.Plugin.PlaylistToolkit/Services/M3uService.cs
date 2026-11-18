using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Extended M3U export and import.
/// </summary>
public class M3uService
{
    private readonly ILibraryManager _libraryManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="M3uService"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    public M3uService(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    /// <summary>
    /// Parses M3U text.
    /// </summary>
    /// <param name="content">File content.</param>
    /// <returns>Entries in file order.</returns>
    public static List<M3uEntry> Parse(string content)
    {
        var entries = new List<M3uEntry>();
        string? artist = null;
        string? title = null;

        using var reader = new StringReader(content ?? string.Empty);
        while (reader.ReadLine() is { } raw)
        {
            var line = raw.Trim().TrimStart('﻿');
            if (line.Length == 0)
            {
                continue;
            }

            if (line.StartsWith("#EXTINF:", StringComparison.OrdinalIgnoreCase))
            {
                // #EXTINF:<seconds>[ key=value ...],<artist> - <title>
                var comma = line.IndexOf(',', StringComparison.Ordinal);
                var display = comma >= 0 ? line[(comma + 1)..].Trim() : string.Empty;
                var separator = display.IndexOf(" - ", StringComparison.Ordinal);
                if (separator > 0)
                {
                    artist = display[..separator].Trim();
                    title = display[(separator + 3)..].Trim();
                }
                else
                {
                    artist = null;
                    title = display.Length == 0 ? null : display;
                }

                continue;
            }

            if (line[0] == '#')
            {
                continue;
            }

            entries.Add(new M3uEntry(line, artist, title));
            artist = null;
            title = null;
        }

        return entries;
    }

    /// <summary>
    /// Writes extended M3U text.
    /// </summary>
    /// <param name="playlistName">Playlist name.</param>
    /// <param name="items">Tracks in order.</param>
    /// <returns>File content.</returns>
    public static string Write(string playlistName, IEnumerable<BaseItem> items)
    {
        var builder = new StringBuilder();
        builder.Append("#EXTM3U\n");
        builder.Append("#PLAYLIST:").Append(SingleLine(playlistName)).Append('\n');
        foreach (var item in items)
        {
            var seconds = item.RunTimeTicks.HasValue
                ? (long)Math.Round(TimeSpan.FromTicks(item.RunTimeTicks.Value).TotalSeconds)
                : -1;
            var artist = TextKeys.GetArtists(item).FirstOrDefault();
            builder.Append("#EXTINF:").Append(seconds.ToString(CultureInfo.InvariantCulture)).Append(',');
            if (!string.IsNullOrEmpty(artist))
            {
                builder.Append(SingleLine(artist)).Append(" - ");
            }

            builder.Append(SingleLine(item.Name)).Append('\n');
            builder.Append(SingleLine(item.Path)).Append('\n');
        }

        return builder.ToString();
    }

    /// <summary>
    /// Matches M3U entries to library tracks the user can see.
    /// Order of attempts: exact path, unique file name, title and artist from the EXTINF line.
    /// </summary>
    /// <param name="entries">Entries.</param>
    /// <param name="user">User.</param>
    /// <returns>Matched item ids in file order and the entries without match.</returns>
    public (List<Guid> Ids, List<string> Unmatched) Match(IReadOnlyList<M3uEntry> entries, User user)
    {
        var library = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = [BaseItemKind.Audio],
            Recursive = true,
            DtoOptions = new DtoOptions(false)
        });

        var byPath = new Dictionary<string, BaseItem>(StringComparer.Ordinal);
        var byFileName = new Dictionary<string, BaseItem?>(StringComparer.OrdinalIgnoreCase);
        var bySong = new Dictionary<string, BaseItem>(StringComparer.Ordinal);
        foreach (var item in library)
        {
            if (!string.IsNullOrEmpty(item.Path))
            {
                byPath.TryAdd(item.Path, item);
                var fileName = FileNameOf(item.Path);

                // A file name that exists more than once cannot identify a track.
                byFileName[fileName] = byFileName.ContainsKey(fileName) ? null : item;
            }

            var key = TextKeys.SongKey(item);
            if (key is not null)
            {
                bySong.TryAdd(key, item);
            }
        }

        var ids = new List<Guid>(entries.Count);
        var unmatched = new List<string>();
        foreach (var entry in entries)
        {
            BaseItem? match = null;
            if (!byPath.TryGetValue(entry.Path, out match))
            {
                byFileName.TryGetValue(FileNameOf(entry.Path), out match);
            }

            if (match is null)
            {
                var key = TextKeys.SongKey(entry.Title, entry.Artist);
                if (key is not null)
                {
                    bySong.TryGetValue(key, out match);
                }
            }

            if (match is null)
            {
                unmatched.Add(entry.Artist is null && entry.Title is null
                    ? entry.Path
                    : string.Concat(entry.Artist, " - ", entry.Title, " (", entry.Path, ")"));
            }
            else
            {
                ids.Add(match.Id);
            }
        }

        return (ids, unmatched);
    }

    /// <summary>
    /// Gets the tracks of a playlist for export.
    /// </summary>
    /// <param name="playlist">Playlist.</param>
    /// <param name="user">User.</param>
    /// <returns>Tracks in playlist order.</returns>
    public static IEnumerable<BaseItem> ExportItems(Playlist playlist, User user)
    {
        return PlaylistContentService.GetVisibleEntries(playlist, user).Select(e => e.Item2);
    }

    private static string FileNameOf(string path)
    {
        var index = path.LastIndexOfAny(['/', '\\']);
        return index >= 0 ? path[(index + 1)..] : path;
    }

    private static string SingleLine(string? value)
    {
        return (value ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ');
    }
}

/// <summary>
/// One M3U entry.
/// </summary>
/// <param name="Path">Path or URL as written in the file.</param>
/// <param name="Artist">Artist from the EXTINF line, if present.</param>
/// <param name="Title">Title from the EXTINF line, if present.</param>
public sealed record M3uEntry(string Path, string? Artist, string? Title);
