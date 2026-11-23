using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;
using Microsoft.Extensions.Logging;
using JellyfinUser = Jellyfin.Database.Implementations.Entities.User;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// The state of one automatic playlist for the endpoint.
/// </summary>
/// <param name="Enabled">The kind is switched on.</param>
/// <param name="PlaylistId">Playlist id, null while it has not been created.</param>
/// <param name="ItemCount">Number of entries.</param>
public sealed record AutoPlaylistState(bool Enabled, Guid? PlaylistId, int ItemCount);

/// <summary>
/// Keeps the automatic playlists in line with the users' favourites and dislikes. Jellyfin's user data is the
/// truth, the playlist is a mirror. Every trigger runs the same reconcile under one lock.
/// </summary>
public class AutoPlaylistService
{
    private const int ChunkSize = 500;

    private readonly ILibraryManager _libraryManager;
    private readonly IPlaylistManager _playlistManager;
    private readonly IUserManager _userManager;
    private readonly IProviderManager _providerManager;
    private readonly IFileSystem _fileSystem;
    private readonly IUserMarkStore _marks;
    private readonly ILogger<AutoPlaylistService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    /// <summary>
    /// Initializes a new instance of the <see cref="AutoPlaylistService"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="playlistManager">Playlist manager.</param>
    /// <param name="userManager">User manager.</param>
    /// <param name="providerManager">Provider manager.</param>
    /// <param name="fileSystem">File system.</param>
    /// <param name="marks">Mark store.</param>
    /// <param name="logger">Logger.</param>
    public AutoPlaylistService(
        ILibraryManager libraryManager,
        IPlaylistManager playlistManager,
        IUserManager userManager,
        IProviderManager providerManager,
        IFileSystem fileSystem,
        IUserMarkStore marks,
        ILogger<AutoPlaylistService> logger)
    {
        _libraryManager = libraryManager;
        _playlistManager = playlistManager;
        _userManager = userManager;
        _providerManager = providerManager;
        _fileSystem = fileSystem;
        _marks = marks;
        _logger = logger;
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    /// <summary>
    /// Reconciles every user and cleans up entries of deleted users and of switched-off kinds.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public async Task ReconcileAllAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var config = Config;
            var registryChanged = false;
            var users = _userManager.GetUsers().ToList();
            var userIds = users.Select(u => u.Id).ToHashSet();

            foreach (var entry in config.AutoPlaylists.ToList())
            {
                if (!userIds.Contains(entry.UserId))
                {
                    DeletePlaylist(entry);
                    config.AutoPlaylists.Remove(entry);
                    registryChanged = true;
                }
            }

            foreach (var user in users)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    registryChanged |= await ReconcileUserCoreAsync(user, config, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Automatic playlists of user {User} could not be updated", user.Username);
                }
            }

            SaveRegistry(registryChanged);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Reconciles one user.
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public async Task ReconcileUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var config = Config;
            var user = _userManager.GetUserById(userId);
            var registryChanged = false;
            if (user is null)
            {
                foreach (var entry in config.AutoPlaylists.Where(e => e.UserId.Equals(userId)).ToList())
                {
                    DeletePlaylist(entry);
                    config.AutoPlaylists.Remove(entry);
                    registryChanged = true;
                }
            }
            else
            {
                registryChanged = await ReconcileUserCoreAsync(user, config, cancellationToken).ConfigureAwait(false);
            }

            SaveRegistry(registryChanged);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Gets the state of the 2 playlists of a user.
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <param name="kind">Kind.</param>
    /// <returns>The state.</returns>
    public AutoPlaylistState GetState(Guid userId, AutoPlaylistKind kind)
    {
        var config = Config;
        var enabled = config.IsAutoPlaylistEnabled(kind);
        var entry = AutoPlaylistEntry.Find(config, userId, kind);
        if (entry is not null && _libraryManager.GetItemById(entry.PlaylistId) is Playlist playlist)
        {
            return new AutoPlaylistState(enabled, playlist.Id, playlist.LinkedChildren.Length);
        }

        return new AutoPlaylistState(enabled, null, 0);
    }

    /// <summary>
    /// Tells whether an enabled automatic playlist of the user does not exist yet (a new user, or a playlist that was removed).
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <returns>True when a reconcile would create a playlist.</returns>
    public bool IsMissingFor(Guid userId)
    {
        return Enum.GetValues<AutoPlaylistKind>().Any(kind => GetState(userId, kind) is { Enabled: true, PlaylistId: null });
    }

    private void SaveRegistry(bool changed)
    {
        if (changed)
        {
            Plugin.Instance?.SaveConfiguration();
        }
    }

    private void DeletePlaylist(AutoPlaylistEntry entry)
    {
        if (_libraryManager.GetItemById(entry.PlaylistId) is Playlist playlist)
        {
            _libraryManager.DeleteItem(playlist, new DeleteOptions { DeleteFileLocation = true }, true);
            _logger.LogInformation("Automatic playlist {Kind} of user {UserId} deleted", entry.Kind, entry.UserId);
        }
    }

    private async Task<bool> ReconcileUserCoreAsync(JellyfinUser user, PluginConfiguration config, CancellationToken cancellationToken)
    {
        var registryChanged = false;
        UserMarks? marks = null;
        foreach (var kind in Enum.GetValues<AutoPlaylistKind>())
        {
            var entry = AutoPlaylistEntry.Find(config, user.Id, kind);
            if (!config.IsAutoPlaylistEnabled(kind))
            {
                if (entry is not null)
                {
                    DeletePlaylist(entry);
                    config.AutoPlaylists.Remove(entry);
                    registryChanged = true;
                }

                continue;
            }

            marks ??= await _marks.GetMarksAsync(user.Id, cancellationToken).ConfigureAwait(false);
            var target = kind == AutoPlaylistKind.Favorites ? marks.Favorites : marks.Dislikes;
            registryChanged |= await ReconcileKindAsync(user, kind, target, config, cancellationToken).ConfigureAwait(false);
        }

        return registryChanged;
    }

    private async Task<bool> ReconcileKindAsync(JellyfinUser user, AutoPlaylistKind kind, IReadOnlySet<Guid> target, PluginConfiguration config, CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var registryChanged = false;
        var name = config.GetAutoPlaylistName(kind);

        // 2. Find the playlist: registry, else adoption.
        var entry = AutoPlaylistEntry.Find(config, user.Id, kind);
        var playlist = entry is null ? null : _libraryManager.GetItemById(entry.PlaylistId) as Playlist;
        if (entry is not null && playlist is null)
        {
            AutoPlaylistEntry.Remove(config, user.Id, kind);
            registryChanged = true;
        }

        if (playlist is null)
        {
            playlist = Adopt(user, kind, name, config);
            if (playlist is not null)
            {
                AutoPlaylistEntry.Set(config, user.Id, kind, playlist.Id);
                registryChanged = true;
            }
        }

        // 3. Create, also when there is nothing to mirror yet: every user has both playlists from the start.
        if (playlist is null)
        {
            var result = await _playlistManager.CreatePlaylist(new PlaylistCreationRequest
            {
                Name = name,
                ItemIdList = [],
                UserId = user.Id,
                MediaType = MediaType.Audio,
                Public = false
            }).ConfigureAwait(false);
            playlist = _libraryManager.GetItemById(Guid.Parse(result.Id)) as Playlist
                ?? throw new InvalidOperationException("The created playlist was not found");
            AutoPlaylistEntry.Set(config, user.Id, kind, playlist.Id);
            registryChanged = true;
        }

        // 5. Enforce the shape on every run.
        var dirty = EnforceShape(playlist, user, name);

        // 6. What is missing, resolved and ordered.
        var current = playlist.LinkedChildren.Where(c => c.ItemId.HasValue).Select(c => c.ItemId!.Value).ToList();
        var currentSet = current.ToHashSet();
        var missing = target.Where(id => !currentSet.Contains(id)).ToList();
        var addedItems = ResolveSorted(missing, user);

        // 7. Plan.
        var plan = AutoPlaylistPlanner.Plan(current, target, addedItems.Select(i => i.Id).ToList(), config.AutoPlaylistNewestFirst);

        // 8. Write.
        if (plan.Changed || dirty)
        {
            if (plan.Changed)
            {
                var existing = playlist.LinkedChildren
                    .Where(c => c.ItemId.HasValue)
                    .GroupBy(c => c.ItemId!.Value)
                    .ToDictionary(g => g.Key, g => g.First());
                var byId = addedItems.ToDictionary(i => i.Id);
                playlist.LinkedChildren = plan.NewOrder
                    .Select(id => existing.TryGetValue(id, out var child) ? child : LinkedChild.Create(byId[id]))
                    .ToArray();
                if (plan.Added > 0)
                {
                    playlist.DateLastMediaAdded = DateTime.UtcNow;
                }
            }

            await playlist.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
            _providerManager.QueueRefresh(playlist.Id, new MetadataRefreshOptions(new DirectoryService(_fileSystem)) { ForceSave = true }, RefreshPriority.High);
            _logger.LogInformation(
                "Automatic playlist {Kind} of {User}: {Added} added, {Removed} removed, {Total} entries, {Ms} ms",
                kind,
                user.Username,
                plan.Added,
                plan.Removed,
                plan.NewOrder.Count,
                watch.ElapsedMilliseconds);
        }

        registryChanged |= await EnsureImageAsync(playlist, user, kind, config, cancellationToken).ConfigureAwait(false);
        return registryChanged;
    }

    private async Task<bool> EnsureImageAsync(Playlist playlist, JellyfinUser user, AutoPlaylistKind kind, PluginConfiguration config, CancellationToken cancellationToken)
    {
        var entry = AutoPlaylistEntry.Find(config, user.Id, kind);
        if (entry is null)
        {
            return false;
        }

        var bundled = AutoPlaylistImage.Load(kind);
        var bundledChecksum = AutoPlaylistImage.Checksum(bundled);
        var hasImage = playlist.HasImage(ImageType.Primary, 0);
        string? diskChecksum = null;
        if (hasImage && entry.ImageChecksum is not null)
        {
            diskChecksum = await ChecksumOfAsync(playlist.GetImagePath(ImageType.Primary, 0), cancellationToken).ConfigureAwait(false);
        }

        switch (AutoPlaylistImage.Decide(hasImage, entry.CustomImage, entry.ImageChecksum, diskChecksum, bundledChecksum))
        {
            case ImageAction.MarkCustom:
                entry.CustomImage = true;
                _logger.LogInformation("Automatic playlist {Kind} of {User} has an image set by a person, it stays", kind, user.Username);
                return true;
            case ImageAction.Apply:
                using (var stream = new MemoryStream(bundled))
                {
                    await _providerManager.SaveImage(playlist, stream, AutoPlaylistImage.MimeType, ImageType.Primary, null, cancellationToken).ConfigureAwait(false);
                }

                await playlist.UpdateToRepositoryAsync(ItemUpdateType.ImageUpdate, cancellationToken).ConfigureAwait(false);
                var saved = playlist.HasImage(ImageType.Primary, 0) ? await ChecksumOfAsync(playlist.GetImagePath(ImageType.Primary, 0), cancellationToken).ConfigureAwait(false) : null;
                entry.ImageChecksum = saved ?? bundledChecksum;
                _logger.LogInformation("Automatic playlist {Kind} of {User}: fixed image set", kind, user.Username);
                return true;
            default:
                return false;
        }
    }

    private static async Task<string?> ChecksumOfAsync(string? path, CancellationToken cancellationToken)
    {
        try
        {
            return string.IsNullOrEmpty(path) ? null : AutoPlaylistImage.Checksum(await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false));
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool EnforceShape(Playlist playlist, JellyfinUser user, string name)
    {
        var dirty = false;
        if (playlist.OwnerUserId != Guid.Empty)
        {
            playlist.OwnerUserId = Guid.Empty;
            dirty = true;
        }

        if (playlist.OpenAccess)
        {
            playlist.OpenAccess = false;
            dirty = true;
        }

        if (!HasShape(playlist.Shares, user.Id))
        {
            playlist.Shares = [new PlaylistUserPermissions(user.Id, false)];
            dirty = true;
        }

        if (!string.Equals(playlist.Name, name, StringComparison.Ordinal))
        {
            playlist.Name = name;
            dirty = true;
        }

        return dirty;
    }

    private static bool HasShape(IReadOnlyList<PlaylistUserPermissions> shares, Guid userId)
    {
        return shares.Count == 1 && shares[0].UserId.Equals(userId) && !shares[0].CanEdit;
    }

    private Playlist? Adopt(JellyfinUser user, AutoPlaylistKind kind, string name, PluginConfiguration config)
    {
        var registered = config.AutoPlaylists.Select(e => e.PlaylistId).ToHashSet();
        return _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.Playlist],
            Recursive = true,
            DtoOptions = new DtoOptions(false)
        }).OfType<Playlist>().FirstOrDefault(p =>
            p.OwnerUserId == Guid.Empty
            && !p.OpenAccess
            && HasShape(p.Shares, user.Id)
            && string.Equals(p.Name, name, StringComparison.Ordinal)
            && !registered.Contains(p.Id));
    }

    private List<BaseItem> ResolveSorted(IReadOnlyList<Guid> ids, JellyfinUser user)
    {
        var found = new List<BaseItem>();
        var isVisible = PlaylistContentService.VisibilityCheck(user);
        for (var i = 0; i < ids.Count; i += ChunkSize)
        {
            var chunk = ids.Skip(i).Take(ChunkSize).ToArray();
            var items = _libraryManager.GetItemList(new InternalItemsQuery
            {
                ItemIds = chunk,
                DtoOptions = new DtoOptions(false)
            });
            found.AddRange(items.Where(item => item is MediaBrowser.Controller.Entities.Audio.Audio && isVisible(item)));
        }

        return found.OrderBy(TrackOrder.FromItem, TrackOrder.Instance).ToList();
    }
}
