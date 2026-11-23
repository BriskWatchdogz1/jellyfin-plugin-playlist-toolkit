using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// One registry entry: which playlist is the automatic playlist of a kind for a user.
/// It is serialised with the plugin configuration, hence the public setters.
/// </summary>
public class AutoPlaylistEntry
{
    /// <summary>Gets or sets the user the playlist belongs to.</summary>
    public Guid UserId { get; set; }

    /// <summary>Gets or sets the kind.</summary>
    public AutoPlaylistKind Kind { get; set; }

    /// <summary>Gets or sets the playlist id.</summary>
    public Guid PlaylistId { get; set; }

    /// <summary>Gets or sets the checksum of the image file the plugin saved, null when it saved none.</summary>
    public string? ImageChecksum { get; set; }

    /// <summary>Gets or sets a value indicating whether a person set an image (it is never replaced).</summary>
    public bool CustomImage { get; set; }

    /// <summary>
    /// Finds the entry of a user and kind.
    /// </summary>
    /// <param name="config">Configuration.</param>
    /// <param name="userId">User id.</param>
    /// <param name="kind">Kind.</param>
    /// <returns>The entry, or null.</returns>
    public static AutoPlaylistEntry? Find(PluginConfiguration config, Guid userId, AutoPlaylistKind kind)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.AutoPlaylists.FirstOrDefault(e => e.UserId.Equals(userId) && e.Kind == kind);
    }

    /// <summary>
    /// Finds the entry that names a playlist.
    /// </summary>
    /// <param name="config">Configuration.</param>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>The entry, or null.</returns>
    public static AutoPlaylistEntry? FindByPlaylist(PluginConfiguration config, Guid playlistId)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.AutoPlaylists.FirstOrDefault(e => e.PlaylistId.Equals(playlistId));
    }

    /// <summary>
    /// Sets the playlist of a user and kind: replaces an existing entry, else adds one.
    /// </summary>
    /// <param name="config">Configuration.</param>
    /// <param name="userId">User id.</param>
    /// <param name="kind">Kind.</param>
    /// <param name="playlistId">Playlist id.</param>
    public static void Set(PluginConfiguration config, Guid userId, AutoPlaylistKind kind, Guid playlistId)
    {
        ArgumentNullException.ThrowIfNull(config);
        var existing = Find(config, userId, kind);
        if (existing is null)
        {
            config.AutoPlaylists.Add(new AutoPlaylistEntry { UserId = userId, Kind = kind, PlaylistId = playlistId });
        }
        else
        {
            existing.PlaylistId = playlistId;
        }
    }

    /// <summary>
    /// Removes the entry of a user and kind.
    /// </summary>
    /// <param name="config">Configuration.</param>
    /// <param name="userId">User id.</param>
    /// <param name="kind">Kind.</param>
    /// <returns>True when an entry was removed.</returns>
    public static bool Remove(PluginConfiguration config, Guid userId, AutoPlaylistKind kind)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.AutoPlaylists.RemoveAll(e => e.UserId.Equals(userId) && e.Kind == kind) > 0;
    }

    /// <summary>
    /// Lists the entries of a kind.
    /// </summary>
    /// <param name="config">Configuration.</param>
    /// <param name="kind">Kind.</param>
    /// <returns>Copy of the matching entries.</returns>
    public static List<AutoPlaylistEntry> OfKind(PluginConfiguration config, AutoPlaylistKind kind)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.AutoPlaylists.Where(e => e.Kind == kind).ToList();
    }
}
