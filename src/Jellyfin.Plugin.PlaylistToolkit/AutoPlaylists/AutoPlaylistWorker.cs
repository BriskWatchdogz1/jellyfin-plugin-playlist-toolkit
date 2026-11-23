using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Plugins;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// Listens for changes of favourites and ratings and reconciles the affected user after a short delay.
/// The event handler does nothing but a check and a queue write: it runs on the request thread of every
/// user data save.
/// </summary>
public sealed class AutoPlaylistWorker : IHostedService, IDisposable
{
    private readonly IUserDataManager _userDataManager;
    private readonly ILibraryManager _libraryManager;
    private readonly AutoPlaylistService _service;
    private readonly ILogger<AutoPlaylistWorker> _logger;
    private readonly IServiceProvider _services;
    private readonly ConcurrentDictionary<(Guid User, Guid Item), MarkIntent> _intents = new();
    private const int MaxIntents = 20000;
    private readonly Channel<Guid> _queue = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private bool _configSubscribed;

    /// <summary>
    /// Initializes a new instance of the <see cref="AutoPlaylistWorker"/> class.
    /// </summary>
    /// <param name="userDataManager">User data manager.</param>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="service">Automatic playlist service.</param>
    /// <param name="logger">Logger.</param>
    /// <param name="services">Service provider (for the HTTP context, which only exists inside a request).</param>
    public AutoPlaylistWorker(IUserDataManager userDataManager, ILibraryManager libraryManager, AutoPlaylistService service, ILogger<AutoPlaylistWorker> logger, IServiceProvider services)
    {
        _userDataManager = userDataManager;
        _libraryManager = libraryManager;
        _service = service;
        _logger = logger;
        _services = services;
    }

    /// <summary>
    /// Decides whether a user data save can change an automatic playlist: songs only, and not the
    /// playback bookkeeping that makes up most saves.
    /// </summary>
    /// <param name="item">Saved item.</param>
    /// <param name="reason">Save reason.</param>
    /// <param name="config">Configuration.</param>
    /// <returns>True when the user should be reconciled.</returns>
    internal static bool IsRelevant(BaseItem? item, UserDataSaveReason reason, PluginConfiguration config)
    {
        if (item is not Audio || (!config.EnableFavoritesPlaylist && !config.EnableDislikesPlaylist))
        {
            return false;
        }

        return reason is not (UserDataSaveReason.PlaybackStart
            or UserDataSaveReason.PlaybackProgress
            or UserDataSaveReason.PlaybackFinished
            or UserDataSaveReason.TogglePlayed);
    }

    /// <summary>
    /// Queues a user for reconciliation (after the usual delay).
    /// </summary>
    /// <param name="userId">User id.</param>
    public void Enqueue(Guid userId)
    {
        _queue.Writer.TryWrite(userId);
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = new CancellationTokenSource();
        _userDataManager.UserDataSaved += OnUserDataSaved;
        _libraryManager.ItemRemoved += OnItemRemoved;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationChanged += OnConfigurationChanged;
            _configSubscribed = true;
        }

        _loop = Task.Run(() => RunAsync(_cts.Token), CancellationToken.None);
        _logger.LogInformation("Automatic playlists: listening");
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Unsubscribe();
        if (_cts is not null)
        {
            await _cts.CancelAsync().ConfigureAwait(false);
        }

        if (_loop is not null)
        {
            try
            {
                await _loop.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is OperationCanceledException or TimeoutException)
            {
                // The loop ends with the process.
            }
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        Unsubscribe();
        _cts?.Dispose();
    }

    private void Unsubscribe()
    {
        _userDataManager.UserDataSaved -= OnUserDataSaved;
        _libraryManager.ItemRemoved -= OnItemRemoved;
        if (_configSubscribed && Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationChanged -= OnConfigurationChanged;
            _configSubscribed = false;
        }
    }

    /// <summary>
    /// A heart or rating (the marks) set while a song plays is wiped again by the next playback report of that song
    /// (Jellyfin 12.4: the report saves user data that it read before the mark was set; reproduced on the test server, also
    /// with the stock web client). The marks every explicit change left are remembered; when a playback report saves
    /// different marks, the remembered ones are written back.
    /// </summary>
    /// <param name="e">The saved user data.</param>
    private void GuardMarks(UserDataSaveEventArgs e)
    {
        if (e.Item is not Audio)
        {
            return;
        }

        var key = (e.UserId, e.Item.Id);
        var saved = new MarkIntent(e.UserData.IsFavorite, e.UserData.Rating, DateTime.UtcNow);
        if (e.SaveReason is UserDataSaveReason.UpdateUserRating or UserDataSaveReason.UpdateUserData)
        {
            if (_intents.Count > MaxIntents)
            {
                _intents.Clear();
            }

            _intents[key] = saved;
            return;
        }

        if (e.SaveReason is not (UserDataSaveReason.PlaybackStart or UserDataSaveReason.PlaybackProgress or UserDataSaveReason.PlaybackFinished)
            || !_intents.TryGetValue(key, out var intent))
        {
            return;
        }

        if (DateTime.UtcNow - intent.At > MarkIntent.MaxAge)
        {
            _intents.TryRemove(key, out _);
            return;
        }

        if (intent.Matches(saved))
        {
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(150).ConfigureAwait(false);
                RestoreMarks(key.Item1, e.Item, intent);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Marks of a song could not be restored after a playback report");
            }
        });
    }

    private void RestoreMarks(Guid userId, BaseItem item, MarkIntent intent)
    {
        var user = _services.GetService<IUserManager>()?.GetUserById(userId);
        if (user is null)
        {
            return;
        }

        var data = _userDataManager.GetUserData(user, item);
        if (data is null || intent.Matches(new MarkIntent(data.IsFavorite, data.Rating, DateTime.UtcNow)))
        {
            return;
        }

        data.IsFavorite = intent.Favorite;
        data.Rating = intent.Rating;
        _userDataManager.SaveUserData(user, item, data, UserDataSaveReason.UpdateUserRating, CancellationToken.None);
        _logger.LogInformation("Heart and rating of '{Song}' for user {User} were wiped by a playback report and written back (favourite {Favorite}, rating {Rating})", item.Name, userId, intent.Favorite, intent.Rating);
    }

    private static readonly Regex ClientField = new("(Client|Device)=\"([^\"]*)\"", RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));

    // Traces who changed a mark of a song: Jellyfin keeps no record of the caller. One line per change that is not
    // playback bookkeeping: the song, what is stored now, the request (method and path, no query) and the client name.
    private void LogMarkChange(UserDataSaveEventArgs e)
    {
        if (e.Item is not Audio || e.SaveReason is UserDataSaveReason.PlaybackStart or UserDataSaveReason.PlaybackProgress or UserDataSaveReason.PlaybackFinished)
        {
            return;
        }

        var request = _services.GetService<IHttpContextAccessor>()?.HttpContext?.Request;
        var header = request is null ? string.Empty : (request.Headers.Authorization.ToString() + request.Headers["X-Emby-Authorization"].ToString());
        var client = string.Join(' ', ClientField.Matches(header).Select(m => m.Groups[1].Value + "=" + m.Groups[2].Value));
        _logger.LogInformation(
            "User data of a song changed: user {User}, '{Song}', reason {Reason}, favourite {Favorite}, played {Played}, play count {Count}, rating {Rating}, request {Method} {Path}, client {Client}",
            e.UserId,
            e.Item.Name,
            e.SaveReason,
            e.UserData.IsFavorite,
            e.UserData.Played,
            e.UserData.PlayCount,
            e.UserData.Rating,
            request?.Method ?? "-",
            request?.Path.Value ?? "-",
            string.IsNullOrEmpty(client) ? "-" : client);
    }

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs e)
    {
        try
        {
            LogMarkChange(e);
            GuardMarks(e);
            var config = Plugin.Instance?.Configuration;
            if (config is not null && IsRelevant(e.Item, e.SaveReason, config))
            {
                _queue.Writer.TryWrite(e.UserId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Automatic playlists: a user data change could not be queued");
        }
    }

    private void OnItemRemoved(object? sender, ItemChangeEventArgs e)
    {
        try
        {
            if (e.Item is Playlist playlist && Plugin.Instance is { } plugin)
            {
                var entry = AutoPlaylistEntry.FindByPlaylist(plugin.Configuration, playlist.Id);
                if (entry is not null)
                {
                    _queue.Writer.TryWrite(entry.UserId);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Automatic playlists: a removed playlist could not be queued");
        }
    }

    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e)
    {
        try
        {
            _queue.Writer.TryWrite(Guid.Empty);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Automatic playlists: a settings change could not be queued");
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var first = await _queue.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                var delay = Math.Clamp(Plugin.Instance?.Configuration.AutoPlaylistSyncDelaySeconds ?? 2, 0, 60);
                if (delay > 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(delay), cancellationToken).ConfigureAwait(false);
                }

                var users = new HashSet<Guid> { first };
                while (_queue.Reader.TryRead(out var next))
                {
                    users.Add(next);
                }

                if (users.Contains(Guid.Empty))
                {
                    await _service.ReconcileAllAsync(cancellationToken).ConfigureAwait(false);
                    continue;
                }

                foreach (var userId in users)
                {
                    await _service.ReconcileUserAsync(userId, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Automatic playlists: update failed");
            }
        }
    }
}


/// <summary>
/// The heart and rating a user last set on a song by an explicit change.
/// </summary>
/// <param name="Favorite">Favourite.</param>
/// <param name="Rating">Rating (null: none).</param>
/// <param name="At">When it was set.</param>
internal sealed record MarkIntent(bool Favorite, double? Rating, DateTime At)
{
    /// <summary>How long a remembered mark counts.</summary>
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);

    /// <summary>
    /// Checks whether another state carries the same heart and rating.
    /// </summary>
    /// <param name="other">The other state.</param>
    /// <returns>True when equal.</returns>
    public bool Matches(MarkIntent other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Favorite == other.Favorite && Nullable.Equals(Rating, other.Rating);
    }
}
