using System.Collections.Generic;
using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PlaylistToolkit.Configuration;

/// <summary>
/// Plugin configuration. Every tunable lives here; nothing is hard-coded elsewhere.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the web client script is injected into index.html.
    /// </summary>
    public bool InjectClientScript { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the sortable track table replaces the stock playlist list.
    /// </summary>
    public bool EnableTrackTable { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the duplicate warning is shown when adding items.
    /// </summary>
    public bool EnableDuplicateWarning { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether users with edit permission (not only the owner)
    /// may change image and description.
    /// </summary>
    public bool EditorsCanEditDetails { get; set; }

    /// <summary>
    /// Gets or sets the number of tracks the web client hands to its player per request. The whole list
    /// is played; it is taken over in parts of this size.
    /// The web client resolves each part with a single GET request; Kestrel limits the request line
    /// to 8192 bytes. Measured on Jellyfin 12.4.0: 227 item ids fit, 229 do not.
    /// </summary>
    public int MaxQueueSize { get; set; } = 200;

    /// <summary>
    /// Gets or sets the number of hours a track counts as "recently played" for smart shuffle.
    /// </summary>
    public int SmartShuffleRecentHours { get; set; } = 72;

    /// <summary>
    /// Gets or sets a value indicating whether smart shuffle leaves out songs the caller disliked
    /// (Jellyfin's per-user rating, <c>Likes == false</c>), and the songs of albums and artists the caller disliked
    /// (unless the song has a heart).
    /// </summary>
    public bool SmartShuffleSkipDisliked { get; set; } = true;

    /// <summary>
    /// Gets or sets which songs a disliked artist covers in smart shuffle: AlbumArtist, AlbumOrMainArtist or AnyArtist.
    /// </summary>
    public string SmartShuffleArtistDislikeScope { get; set; } = "AlbumOrMainArtist";

    /// <summary>
    /// Gets or sets the maximum accepted image upload size in megabytes.
    /// </summary>
    public int MaxImageSizeMb { get; set; } = 10;

    /// <summary>
    /// Gets or sets the maximum length of a playlist description in characters.
    /// </summary>
    public int MaxDescriptionLength { get; set; } = 2000;

    /// <summary>
    /// Gets or sets the maximum accepted M3U import size in kilobytes.
    /// </summary>
    public int MaxImportSizeKb { get; set; } = 2048;

    /// <summary>
    /// Gets or sets a value indicating whether every user gets a read-only playlist with all songs
    /// they marked as favourite.
    /// </summary>
    public bool EnableFavoritesPlaylist { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether every user who disliked a song gets a read-only playlist
    /// with all songs they disliked.
    /// </summary>
    public bool EnableDislikesPlaylist { get; set; } = true;

    /// <summary>
    /// Gets or sets the name of the favourites playlist (one name for all users). Empty falls back to the default.
    /// </summary>
    public string FavoritesPlaylistName { get; set; } = "Favoriten";

    /// <summary>
    /// Gets or sets the name of the dislikes playlist (one name for all users). Empty falls back to the default.
    /// </summary>
    public string DislikesPlaylistName { get; set; } = "Dislikes";

    /// <summary>
    /// Gets or sets a value indicating whether new songs enter an automatic playlist at the top (false: at the end).
    /// </summary>
    public bool AutoPlaylistNewestFirst { get; set; } = true;

    /// <summary>
    /// Gets or sets the seconds to wait after a change before an automatic playlist is written (0 to 60).
    /// </summary>
    public int AutoPlaylistSyncDelaySeconds { get; set; } = 2;

    /// <summary>
    /// Gets or sets a value indicating whether artists whose name starts with one of <see cref="SortArticles"/>
    /// get a sort name without it.
    /// </summary>
    public bool EnableArtistSortFix { get; set; } = true;

    /// <summary>
    /// Gets or sets the articles at the start of an artist name that are moved behind it in the web client and
    /// ignored when sorting (comma separated, whole first word only).
    /// </summary>
    public string SortArticles { get; set; } = "The,Die";

    /// <summary>
    /// Gets or sets the registry of the automatic playlists. State, not a setting.
    /// </summary>
#pragma warning disable CA2227 // XML serialisation and the settings page need a setter
    public List<AutoPlaylistEntry> AutoPlaylists { get; set; } = [];
#pragma warning restore CA2227

    /// <summary>
    /// Gets the configured name of an automatic playlist.
    /// </summary>
    /// <param name="kind">Kind.</param>
    /// <returns>The configured name, or the default when the setting is empty.</returns>
    public string GetAutoPlaylistName(AutoPlaylistKind kind)
    {
        var configured = kind == AutoPlaylistKind.Favorites ? FavoritesPlaylistName : DislikesPlaylistName;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured.Trim();
        }

        var defaults = new PluginConfiguration();
        return kind == AutoPlaylistKind.Favorites ? defaults.FavoritesPlaylistName : defaults.DislikesPlaylistName;
    }

    /// <summary>
    /// Gets a value indicating whether a kind of automatic playlist is switched on.
    /// </summary>
    /// <param name="kind">Kind.</param>
    /// <returns>True when on.</returns>
    public bool IsAutoPlaylistEnabled(AutoPlaylistKind kind)
    {
        return kind == AutoPlaylistKind.Favorites ? EnableFavoritesPlaylist : EnableDislikesPlaylist;
    }
}
