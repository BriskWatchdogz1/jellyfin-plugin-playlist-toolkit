using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.PlaylistToolkit;

/// <summary>
/// Playlist Toolkit: owner-centric playlist features for the Jellyfin web client.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        TakeOverLegacyConfiguration();
        Instance = this;
    }

    /// <summary>
    /// Gets the configuration file name the plugin used before it was renamed (1.0.x, "Playlist Plus").
    /// </summary>
    internal const string LegacyConfigurationFileName = "Jellyfin.Plugin.PlaylistPlus.xml";

    /// <summary>
    /// Gets the running plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Playlist Toolkit";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("fd26499b-e4c1-4a7d-8648-a898f06e647b");

    /// <inheritdoc />
    public override string Description =>
        "Lets playlist owners manage image, description and per-user sharing, adds a sortable track table, smart shuffle, duplicate warnings and M3U import/export.";

    /// <summary>
    /// Copies the settings saved under the former assembly name, so they survive the rename.
    /// Runs before the configuration is read for the first time; an existing new file is never replaced.
    /// </summary>
    private void TakeOverLegacyConfiguration()
    {
        var target = ConfigurationFilePath;
        var legacy = Path.Combine(ApplicationPaths.PluginConfigurationsPath, LegacyConfigurationFileName);
        if (File.Exists(target) || !File.Exists(legacy) || string.Equals(target, legacy, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            File.Copy(legacy, target);
        }
        catch (IOException)
        {
            // Defaults are used; the legacy file stays untouched.
        }
        catch (UnauthorizedAccessException)
        {
            // Same as above.
        }
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return
        [
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
            }
        ];
    }
}
