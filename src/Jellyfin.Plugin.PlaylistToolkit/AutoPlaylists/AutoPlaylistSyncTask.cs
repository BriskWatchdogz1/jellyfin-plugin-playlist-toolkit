using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// Scheduled task that reconciles every user: covers changes made while the plugin was not loaded,
/// deleted users and direct database changes.
/// </summary>
public class AutoPlaylistSyncTask : IScheduledTask
{
    private readonly AutoPlaylistService _service;

    /// <summary>
    /// Initializes a new instance of the <see cref="AutoPlaylistSyncTask"/> class.
    /// </summary>
    /// <param name="service">Automatic playlist service.</param>
    public AutoPlaylistSyncTask(AutoPlaylistService service)
    {
        _service = service;
    }

    /// <inheritdoc />
    public string Name => "Synchronise automatic playlists";

    /// <inheritdoc />
    public string Key => "PlaylistToolkitAutoPlaylists";

    /// <inheritdoc />
    public string Description => "Brings the favourites and dislikes playlists of every user in line with their songs and removes those of deleted users.";

    /// <inheritdoc />
    public string Category => "Playlist Toolkit";

    /// <inheritdoc />
    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(progress);
        progress.Report(0);
        await _service.ReconcileAllAsync(cancellationToken).ConfigureAwait(false);
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
