using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.PlaylistToolkit.ArtistNames;

/// <summary>
/// Scheduled task (startup and daily, also runnable by hand) that sets the sort names of artists with a leading article.
/// </summary>
public class ArtistSortTask : IScheduledTask
{
    private readonly ArtistSortService _service;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArtistSortTask"/> class.
    /// </summary>
    /// <param name="service">Artist sort service.</param>
    public ArtistSortTask(ArtistSortService service)
    {
        _service = service;
    }

    /// <inheritdoc />
    public string Name => "Sort artists without leading article";

    /// <inheritdoc />
    public string Key => "PlaylistToolkitArtistSort";

    /// <inheritdoc />
    public string Description => "Sorts artists like \"Die Antwoord\" under their name without the article (list of articles in the plugin settings).";

    /// <inheritdoc />
    public string Category => "Playlist Toolkit";

    /// <inheritdoc />
    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(progress);
        progress.Report(0);
        await _service.ApplyAsync(cancellationToken).ConfigureAwait(false);
        progress.Report(100);
    }

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return
        [
            new TaskTriggerInfo { Type = TaskTriggerInfoType.StartupTrigger },
            new TaskTriggerInfo { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = TimeSpan.FromHours(24).Ticks }
        ];
    }
}

/// <summary>
/// Runs after every library scan, so artists that the scan found get their sort name at once.
/// </summary>
public class ArtistSortPostScanTask : ILibraryPostScanTask
{
    private readonly ArtistSortService _service;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArtistSortPostScanTask"/> class.
    /// </summary>
    /// <param name="service">Artist sort service.</param>
    public ArtistSortPostScanTask(ArtistSortService service)
    {
        _service = service;
    }

    /// <inheritdoc />
    public async Task Run(IProgress<double> progress, CancellationToken cancellationToken)
    {
        await _service.ApplyAsync(cancellationToken).ConfigureAwait(false);
    }
}
