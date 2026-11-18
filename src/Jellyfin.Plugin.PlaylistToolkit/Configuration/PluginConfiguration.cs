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
}
