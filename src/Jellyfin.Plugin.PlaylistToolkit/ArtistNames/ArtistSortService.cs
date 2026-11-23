using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PlaylistToolkit.ArtistNames;

/// <summary>
/// Gives artists whose name starts with a configured article a forced sort name without it, so "Die Antwoord" sorts
/// under A. The server's own list of ignored words stays as it is (it would also move song titles). An artist whose
/// forced sort name somebody set differently is left alone.
/// </summary>
public class ArtistSortService
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<ArtistSortService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArtistSortService"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="logger">Logger.</param>
    public ArtistSortService(ILibraryManager libraryManager, ILogger<ArtistSortService> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Sets the forced sort name of every artist that needs one.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The number of artists changed.</returns>
    public async Task<int> ApplyAsync(CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        if (!config.EnableArtistSortFix)
        {
            return 0;
        }

        var articles = ArticleRule.ParseArticles(config.SortArticles);
        if (articles.Count == 0)
        {
            return 0;
        }

        var artists = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.MusicArtist],
            Recursive = true,
            DtoOptions = new DtoOptions(false)
        }).OfType<MusicArtist>().ToList();

        var changed = 0;
        foreach (var artist in artists)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var wanted = ArticleRule.SortName(artist.Name, articles);
            if (wanted is null)
            {
                continue;
            }

            if (!string.IsNullOrEmpty(artist.ForcedSortName))
            {
                continue; // set by the plugin earlier (nothing to do) or by a person (stays)
            }

            if (string.Equals(artist.SortName, wanted, StringComparison.OrdinalIgnoreCase))
            {
                continue; // the server already sorts it that way ("The ...")
            }

            artist.ForcedSortName = wanted;
            await artist.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
            changed++;
            _logger.LogInformation("Artist sort name: '{Name}' sorts as '{Sort}'", artist.Name, wanted);
        }

        return changed;
    }
}
