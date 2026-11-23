using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using Jellyfin.Plugin.PlaylistToolkit.Web;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PlaylistToolkit.Api;

/// <summary>
/// Playlist Toolkit API. Every write checks the caller's rights on the playlist; an owner needs no administrator.
/// </summary>
[ApiController]
[Authorize]
[Route("PlaylistToolkit")]
[Produces(MediaTypeNames.Application.Json)]
public class PlaylistToolkitController : ControllerBase
{
    private static readonly Dictionary<string, string> _imageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "image/jpeg",
        ["image/jpg"] = "image/jpeg",
        ["image/png"] = "image/png",
        ["image/webp"] = "image/webp",
        ["image/gif"] = "image/gif"
    };

    private readonly PlaylistAccessService _access;
    private readonly PlaylistContentService _content;
    private readonly M3uService _m3u;
    private readonly AutoPlaylistService _autoPlaylists;
    private readonly AutoPlaylistWorker _autoWorker;
    private readonly ILibraryManager _libraryManager;
    private readonly IPlaylistManager _playlistManager;
    private readonly IUserManager _userManager;
    private readonly IProviderManager _providerManager;
    private readonly ISessionManager _sessionManager;
    private readonly ILogger<PlaylistToolkitController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PlaylistToolkitController"/> class.
    /// </summary>
    /// <param name="access">Access service.</param>
    /// <param name="content">Content service.</param>
    /// <param name="m3u">M3U service.</param>
    /// <param name="autoPlaylists">Automatic playlist service.</param>
    /// <param name="autoWorker">Automatic playlist worker.</param>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="playlistManager">Playlist manager.</param>
    /// <param name="userManager">User manager.</param>
    /// <param name="providerManager">Provider manager.</param>
    /// <param name="sessionManager">Session manager.</param>
    /// <param name="logger">Logger.</param>
    public PlaylistToolkitController(
        PlaylistAccessService access,
        PlaylistContentService content,
        M3uService m3u,
        AutoPlaylistService autoPlaylists,
        AutoPlaylistWorker autoWorker,
        ILibraryManager libraryManager,
        IPlaylistManager playlistManager,
        IUserManager userManager,
        IProviderManager providerManager,
        ISessionManager sessionManager,
        ILogger<PlaylistToolkitController> logger)
    {
        _access = access;
        _content = content;
        _m3u = m3u;
        _autoPlaylists = autoPlaylists;
        _autoWorker = autoWorker;
        _libraryManager = libraryManager;
        _playlistManager = playlistManager;
        _userManager = userManager;
        _providerManager = providerManager;
        _sessionManager = sessionManager;
        _logger = logger;
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    /// <summary>
    /// Serves the web client script that the injection middleware references.
    /// </summary>
    /// <returns>JavaScript.</returns>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        // The URL carries a hash of the script, so a cached copy can never be stale.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return File(ClientScript.Content, "application/javascript; charset=utf-8");
    }

    /// <summary>
    /// Gets the settings the web client needs.
    /// </summary>
    /// <returns>Settings.</returns>
    [HttpGet("Config")]
    public async Task<ActionResult<ClientConfigDto>> GetConfig()
    {
        var config = Config;
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is not null && _autoPlaylists.IsMissingFor(caller.User.Id))
        {
            // A user created after the last run (or a playlist that was deleted): have it created in the background.
            _autoWorker.Enqueue(caller.User.Id);
        }

        return new ClientConfigDto
        {
            IsAdministrator = caller is not null && PlaylistAccessService.IsAdministrator(caller.User),
            Version = typeof(Plugin).Assembly.GetName().Version?.ToString() ?? string.Empty,
            EnableTrackTable = config.EnableTrackTable,
            EnableDuplicateWarning = config.EnableDuplicateWarning,
            MaxQueueSize = Math.Max(1, config.MaxQueueSize),
            MaxImageBytes = MaxImageBytes(config),
            MaxDescriptionLength = Math.Max(0, config.MaxDescriptionLength),
            SortArticles = config.EnableArtistSortFix ? ArtistNames.ArticleRule.ParseArticles(config.SortArticles) : []
        };
    }

    /// <summary>
    /// Lists the users a playlist can be shared with (everyone except the caller).
    /// The stock user list is admin-only and the public list omits hidden users.
    /// </summary>
    /// <returns>Users.</returns>
    [HttpGet("Users")]
    public async Task<ActionResult<List<UserDto>>> GetUsers()
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        return _userManager.GetUsers()
            .Where(u => !u.Id.Equals(caller.User.Id))
            .Select(u => new UserDto { Id = u.Id, Name = u.Username })
            .OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Lists every playlist on the server with its owner. Administrators only.
    /// </summary>
    /// <returns>All playlists.</returns>
    [HttpGet("Admin/Playlists")]
    public async Task<ActionResult<List<PlaylistSummaryDto>>> GetAllPlaylists()
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null || !PlaylistAccessService.IsAdministrator(caller.User))
        {
            return Forbid();
        }

        var registry = Config.AutoPlaylists.ToList();
        return _access.GetAllPlaylists()
            .Select(p => (Playlist: p, Auto: registry.FirstOrDefault(e => e.PlaylistId.Equals(p.Id))))
            .Select(x => new PlaylistSummaryDto
            {
                AutoKind = x.Auto?.Kind.ToString(),
                AutoUserName = x.Auto is null ? null : _userManager.GetUserById(x.Auto.UserId)?.Username,
                Id = x.Playlist.Id,
                Name = x.Playlist.Name ?? string.Empty,
                MediaType = x.Playlist.MediaType.ToString(),
                OwnerUserId = x.Playlist.OwnerUserId,
                OwnerName = x.Playlist.OwnerUserId == Guid.Empty ? null : _userManager.GetUserById(x.Playlist.OwnerUserId)?.Username,
                OpenAccess = x.Playlist.OpenAccess,
                ShareCount = x.Playlist.Shares.Count,
                ItemCount = x.Playlist.LinkedChildren.Length
            })
            .OrderBy(p => p.OwnerName ?? p.AutoUserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Gets a playlist summary with the caller's rights.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>Summary.</returns>
    [HttpGet("Playlists/{playlistId}")]
    public async Task<ActionResult<PlaylistInfoDto>> GetPlaylist([FromRoute, Required] Guid playlistId)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        return ToInfo(access);
    }

    /// <summary>
    /// Gets the rows of the track table.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>Rows in playlist order.</returns>
    [HttpGet("Playlists/{playlistId}/Items")]
    public async Task<ActionResult<TrackListDto>> GetItems([FromRoute, Required] Guid playlistId)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        return _content.GetRows(access.Playlist, caller!.User);
    }

    /// <summary>
    /// Sets the playlist description.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="request">New description.</param>
    /// <returns>No content.</returns>
    [HttpPost("Playlists/{playlistId}/Description")]
    public async Task<ActionResult> SetDescription([FromRoute, Required] Guid playlistId, [FromBody, Required] DescriptionRequest request)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanManage)
        {
            return Forbid();
        }

        var text = (request.Overview ?? string.Empty).Trim();
        var max = Math.Max(0, Config.MaxDescriptionLength);
        if (text.Length > max)
        {
            return BadRequest($"Description is longer than {max} characters.");
        }

        access.Playlist.Overview = text.Length == 0 ? null : text;
        await access.Playlist.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, CancellationToken.None).ConfigureAwait(false);
        return NoContent();
    }

    /// <summary>
    /// Sets the playlist image. The body is the raw image file; the content type names its format.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>No content.</returns>
    [HttpPost("Playlists/{playlistId}/Image")]
    [Consumes("image/jpeg", "image/png", "image/webp", "image/gif")]
    public async Task<ActionResult> SetImage([FromRoute, Required] Guid playlistId)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanManage)
        {
            return Forbid();
        }

        var contentType = Request.ContentType?.Split(';')[0].Trim();
        if (contentType is null || !_imageTypes.TryGetValue(contentType, out var mimeType))
        {
            return BadRequest("Unsupported image type.");
        }

        var limit = MaxImageBytes(Config);
        if (Request.ContentLength > limit)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk, HttpContext.RequestAborted).ConfigureAwait(false)) > 0)
        {
            if (buffer.Length + read > limit)
            {
                return StatusCode(StatusCodes.Status413PayloadTooLarge);
            }

            await buffer.WriteAsync(chunk.AsMemory(0, read), HttpContext.RequestAborted).ConfigureAwait(false);
        }

        if (!LooksLikeImage(buffer, mimeType))
        {
            return BadRequest("The body is not an image of the declared type.");
        }

        buffer.Position = 0;
        var playlist = access.Playlist;
        await _providerManager.SaveImage(playlist, buffer, mimeType, ImageType.Primary, null, CancellationToken.None).ConfigureAwait(false);
        await playlist.UpdateToRepositoryAsync(ItemUpdateType.ImageUpdate, CancellationToken.None).ConfigureAwait(false);
        MarkAutoImage(playlist.Id, custom: true);
        return NoContent();
    }

    /// <summary>
    /// Removes the playlist image. Jellyfin then generates its collage again on the next refresh.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>No content.</returns>
    [HttpDelete("Playlists/{playlistId}/Image")]
    public async Task<ActionResult> DeleteImage([FromRoute, Required] Guid playlistId)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanManage)
        {
            return Forbid();
        }

        await access.Playlist.DeleteImageAsync(ImageType.Primary, 0).ConfigureAwait(false);
        MarkAutoImage(access.Playlist.Id, custom: false);
        return NoContent();
    }

    /// <summary>
    /// Replaces the sharing settings of a playlist.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="request">Sharing settings.</param>
    /// <returns>The updated playlist summary.</returns>
    [HttpPost("Playlists/{playlistId}/Sharing")]
    public async Task<ActionResult<PlaylistInfoDto>> SetSharing([FromRoute, Required] Guid playlistId, [FromBody, Required] SharingRequest request)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanShare)
        {
            return Forbid();
        }

        var playlist = access.Playlist;
        if (request.Shares is not null)
        {
            var shares = new List<PlaylistUserPermissions>();
            foreach (var share in request.Shares)
            {
                if (share.UserId.Equals(playlist.OwnerUserId) || shares.Any(s => s.UserId.Equals(share.UserId)))
                {
                    continue;
                }

                if (_userManager.GetUserById(share.UserId) is null)
                {
                    return BadRequest($"Unknown user {share.UserId}.");
                }

                shares.Add(new PlaylistUserPermissions(share.UserId, share.CanEdit));
            }

            // Set directly instead of IPlaylistManager.AddUserToShares: that method looks the playlist up
            // as the user being added and fails for private playlists (jellyfin/jellyfin#18534).
            playlist.Shares = shares;
        }

        if (request.OpenAccess.HasValue)
        {
            playlist.OpenAccess = request.OpenAccess.Value;
        }

        await playlist.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, CancellationToken.None).ConfigureAwait(false);
        if (playlist.IsFile)
        {
            _playlistManager.SavePlaylistFile(playlist);
        }

        return ToInfo(access);
    }

    /// <summary>
    /// Gets the caller's automatic playlists: switched on, playlist id (null until created), number of entries.
    /// </summary>
    /// <returns>The state of both kinds.</returns>
    [HttpGet("AutoPlaylists")]
    public async Task<ActionResult<AutoPlaylistsDto>> GetAutoPlaylists()
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        return ToAutoDto(caller.User.Id);
    }

    /// <summary>
    /// Reconciles the caller's automatic playlists now, without the delay of the background worker.
    /// </summary>
    /// <returns>The state of both kinds.</returns>
    [HttpPost("AutoPlaylists/Sync")]
    public async Task<ActionResult<AutoPlaylistsDto>> SyncAutoPlaylists()
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        await _autoPlaylists.ReconcileUserAsync(caller.User.Id, HttpContext.RequestAborted).ConfigureAwait(false);
        return ToAutoDto(caller.User.Id);
    }

    /// <summary>
    /// Lists the playlists the caller can edit (own and shared with the edit right, no automatic ones) with the
    /// state of one track in each: already in it, or the same song from another album.
    /// </summary>
    /// <param name="itemId">The track.</param>
    /// <returns>Playlists.</returns>
    [HttpGet("Targets")]
    public async Task<ActionResult<List<PlaylistTargetDto>>> GetTargets([FromQuery, Required] Guid itemId)
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        var isVisible = PlaylistContentService.VisibilityCheck(caller.User);
        var track = _libraryManager.GetItemById(itemId);
        if (track is null || !isVisible(track))
        {
            return NotFound("Track not found");
        }

        var auto = Config.AutoPlaylists.Select(e => e.PlaylistId).ToHashSet();
        var result = new List<PlaylistTargetDto>();
        foreach (var playlist in _access.GetAllPlaylists())
        {
            if (!IsEditableTarget(playlist, caller.User.Id, auto))
            {
                continue;
            }

            var (contains, similar) = _content.Relation(playlist, caller.User, track);
            result.Add(new PlaylistTargetDto
            {
                Id = playlist.Id,
                Name = playlist.Name ?? string.Empty,
                ItemCount = playlist.LinkedChildren.Length,
                OwnerName = playlist.OwnerUserId.Equals(caller.User.Id) ? null : _userManager.GetUserById(playlist.OwnerUserId)?.Username,
                Contains = contains,
                SimilarAlbum = similar
            });
        }

        return result.OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>
    /// Adds a track to some playlists and takes it out of others in one call. Every playlist is checked for the
    /// caller's right to edit it; a playlist that is refused is reported and the others are still handled.
    /// </summary>
    /// <param name="request">The changes.</param>
    /// <returns>What was done.</returns>
    [HttpPost("Membership")]
    public async Task<ActionResult<MembershipResultDto>> ChangeMembership([FromBody, Required] MembershipRequest request)
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        var track = _libraryManager.GetItemById(request.ItemId);
        if (track is null || !PlaylistContentService.VisibilityCheck(caller.User)(track))
        {
            return NotFound("Track not found");
        }

        var auto = Config.AutoPlaylists.Select(e => e.PlaylistId).ToHashSet();
        var result = new MembershipResultDto();
        foreach (var id in request.Remove.Distinct())
        {
            var playlist = _libraryManager.GetItemById(id) as Playlist;
            if (playlist is null || !IsEditableTarget(playlist, caller.User.Id, auto))
            {
                result.Failed.Add(id);
                continue;
            }

            try
            {
                var entries = PlaylistContentService.EntryIdsOf(playlist, track.Id);
                if (entries.Count > 0)
                {
                    await _content.RemoveItems(playlist, entries).ConfigureAwait(false);
                }

                result.Removed.Add(id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Membership: removing a track from playlist {Playlist} failed", id);
                result.Failed.Add(id);
            }
        }

        foreach (var id in request.Add.Distinct().Where(i => !request.Remove.Contains(i)))
        {
            var playlist = _libraryManager.GetItemById(id) as Playlist;
            if (playlist is null || !IsEditableTarget(playlist, caller.User.Id, auto))
            {
                result.Failed.Add(id);
                continue;
            }

            try
            {
                if (PlaylistContentService.EntryIdsOf(playlist, track.Id).Count == 0)
                {
                    await _content.AddItems(playlist, caller.User, [track.Id]).ConfigureAwait(false);
                }

                result.Added.Add(id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Membership: adding a track to playlist {Playlist} failed", id);
                result.Failed.Add(id);
            }
        }

        return result;
    }

    /// <summary>
    /// Checks the rights an ordinary user has on a music playlist as a target: owner or editor, never an
    /// automatic playlist. Administrators get no extra right here; this is the list of "their" playlists.
    /// </summary>
    private static bool IsEditableTarget(Playlist playlist, Guid userId, HashSet<Guid> automatic)
    {
        if (automatic.Contains(playlist.Id) || playlist.MediaType != MediaType.Audio)
        {
            return false;
        }

        return playlist.OwnerUserId.Equals(userId) || playlist.Shares.Any(s => s.CanEdit && s.UserId.Equals(userId));
    }

    /// <summary>
    /// Checks which of the given items are already in the playlist.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="request">Ids about to be added.</param>
    /// <returns>Duplicates and new tracks.</returns>
    [HttpPost("Playlists/{playlistId}/Duplicates")]
    public async Task<ActionResult<DuplicateCheckDto>> CheckDuplicates([FromRoute, Required] Guid playlistId, [FromBody, Required] ItemIdsRequest request)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        return _content.FindDuplicates(access.Playlist, caller!.User, request.Ids);
    }

    /// <summary>
    /// Appends tracks to the playlist. Used by the duplicate dialog to add a selection.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="request">Ids to add.</param>
    /// <returns>Number of tracks added.</returns>
    [HttpPost("Playlists/{playlistId}/Items")]
    public async Task<ActionResult<AddResultDto>> AddItems([FromRoute, Required] Guid playlistId, [FromBody, Required] ItemIdsRequest request)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanEditItems)
        {
            return Forbid();
        }

        var added = await _content.AddItems(access.Playlist, caller!.User, request.Ids).ConfigureAwait(false);
        return new AddResultDto { Added = added };
    }

    /// <summary>
    /// Removes entries from the playlist.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="entryIds">Entry ids, comma separated.</param>
    /// <returns>No content.</returns>
    [HttpDelete("Playlists/{playlistId}/Items")]
    public async Task<ActionResult> RemoveItems([FromRoute, Required] Guid playlistId, [FromQuery, Required] string entryIds)
    {
        var (access, _, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanEditItems)
        {
            return Forbid();
        }

        var ids = entryIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (ids.Length == 0)
        {
            return BadRequest("No entries.");
        }

        await _content.RemoveItems(access.Playlist, ids).ConfigureAwait(false);
        return NoContent();
    }

    /// <summary>
    /// Moves an entry to a new position.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="entryId">Entry id.</param>
    /// <param name="newIndex">New 0-based position.</param>
    /// <returns>No content.</returns>
    [HttpPost("Playlists/{playlistId}/Items/{entryId}/Move/{newIndex}")]
    public async Task<ActionResult> MoveItem([FromRoute, Required] Guid playlistId, [FromRoute, Required] string entryId, [FromRoute, Required] int newIndex)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        if (!access.CanEditItems)
        {
            return Forbid();
        }

        if (!Guid.TryParse(entryId, out var entryGuid))
        {
            return BadRequest("Invalid entry id.");
        }

        // The stock move fails with an internal error for positions outside the list; check them here.
        var entries = PlaylistContentService.GetVisibleEntries(access.Playlist, caller!.User);
        if (!entries.Any(e => e.Item1.ItemId.HasValue && e.Item1.ItemId.Value.Equals(entryGuid)))
        {
            return NotFound("Entry not found");
        }

        if (newIndex < 0 || newIndex >= entries.Count)
        {
            return BadRequest($"Position must be between 0 and {entries.Count - 1}.");
        }

        await _content.MoveItem(access.Playlist, entryGuid.ToString("N", System.Globalization.CultureInfo.InvariantCulture), newIndex, caller.User).ConfigureAwait(false);
        return NoContent();
    }

    /// <summary>
    /// Computes a smart shuffle order: no artist twice in a row, recently played tracks last.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="seed">Optional seed for a reproducible order (tests).</param>
    /// <param name="after">Optional id of the track that plays right before this order (endless mode).</param>
    /// <returns>Item ids in play order.</returns>
    [HttpGet("Playlists/{playlistId}/SmartShuffle")]
    public async Task<ActionResult<ShuffleResultDto>> GetSmartShuffle([FromRoute, Required] Guid playlistId, [FromQuery] int? seed, [FromQuery] Guid? after)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        var window = TimeSpan.FromHours(Math.Max(0, Config.SmartShuffleRecentHours));
        var random = seed.HasValue ? new Random(seed.Value) : Random.Shared;
        return new ShuffleResultDto { ItemIds = _content.SmartShuffle(access.Playlist, caller!.User, window, random, after) };
    }

    /// <summary>
    /// Computes a smart shuffle order that continues a running queue (endless mode).
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="request">Track before the new order and the tracks still waiting in the queue.</param>
    /// <returns>Item ids in play order.</returns>
    [HttpPost("Playlists/{playlistId}/SmartShuffle")]
    public async Task<ActionResult<ShuffleResultDto>> ContinueSmartShuffle([FromRoute, Required] Guid playlistId, [FromBody, Required] SmartShuffleRequest request)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        var window = TimeSpan.FromHours(Math.Max(0, Config.SmartShuffleRecentHours));
        return new ShuffleResultDto
        {
            ItemIds = _content.SmartShuffle(access.Playlist, caller!.User, window, Random.Shared, request.After, request.Pending)
        };
    }

    /// <summary>
    /// Starts playback of the given tracks on the client that sent the request.
    /// The server sends the same "Play" command a remote control would send, so no client internals are needed.
    /// </summary>
    /// <param name="request">Tracks and start index.</param>
    /// <returns>How many tracks were queued.</returns>
    [HttpPost("Play")]
    public async Task<ActionResult<PlayResultDto>> Play([FromBody, Required] PlayRequestDto request)
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        if (request.ItemIds.Count == 0)
        {
            return BadRequest("No items.");
        }

        var session = _sessionManager.Sessions
            .Where(s => s.UserId.Equals(caller.User.Id) && string.Equals(s.DeviceId, caller.DeviceId, StringComparison.Ordinal))
            .OrderByDescending(s => s.LastActivityDate)
            .FirstOrDefault();
        if (session is null || !session.SupportsRemoteControl)
        {
            return Conflict("This client has no controllable session (no open connection to the server).");
        }

        var command = request.Mode switch
        {
            "next" => PlayCommand.PlayNext,
            "last" => PlayCommand.PlayLast,
            _ => PlayCommand.PlayNow
        };

        // The client fetches the queue with one GET request, so its length is limited.
        var max = Math.Max(1, Config.MaxQueueSize);
        var start = command == PlayCommand.PlayNow ? Math.Clamp(request.StartIndex, 0, request.ItemIds.Count - 1) : 0;
        var ids = request.ItemIds.Skip(start).Take(max).ToArray();

        await _sessionManager.SendPlayCommand(
            session.Id,
            session.Id,
            new PlayRequest { ItemIds = ids, PlayCommand = command, StartIndex = 0 },
            CancellationToken.None).ConfigureAwait(false);

        return new PlayResultDto { Queued = ids.Length, Truncated = request.ItemIds.Count - start - ids.Length };
    }

    /// <summary>
    /// Exports a playlist as extended M3U (UTF-8).
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <returns>M3U8 file.</returns>
    [HttpGet("Playlists/{playlistId}/Export")]
    public async Task<ActionResult> Export([FromRoute, Required] Guid playlistId)
    {
        var (access, caller, error) = await ResolveAsync(playlistId).ConfigureAwait(false);
        if (access is null)
        {
            return error!;
        }

        var text = M3uService.Write(access.Playlist.Name, M3uService.ExportItems(access.Playlist, caller!.User));
        return File(Encoding.UTF8.GetBytes(text), "audio/x-mpegurl; charset=utf-8", SafeFileName(access.Playlist.Name) + ".m3u8");
    }

    /// <summary>
    /// Imports M3U text into a new playlist owned by the caller, or appends to an existing one.
    /// </summary>
    /// <param name="request">Import request.</param>
    /// <returns>Import result.</returns>
    [HttpPost("Import")]
    public async Task<ActionResult<ImportResultDto>> Import([FromBody, Required] ImportRequest request)
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return Forbid();
        }

        if (request.Content.Length > Math.Max(1, Config.MaxImportSizeKb) * 1024L)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        PlaylistAccess? target = null;
        if (request.PlaylistId.HasValue)
        {
            target = _access.Resolve(request.PlaylistId.Value, caller.User);
            if (target is null)
            {
                return NotFound("Playlist not found");
            }

            if (!target.CanEditItems)
            {
                return Forbid();
            }
        }
        else if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest("A name is required for a new playlist.");
        }

        var entries = M3uService.Parse(request.Content);
        if (entries.Count == 0)
        {
            return BadRequest("The file has no entries.");
        }

        var (ids, unmatched) = _m3u.Match(entries, caller.User);
        var result = new ImportResultDto { Total = entries.Count, Matched = ids.Count, Unmatched = unmatched };
        if (ids.Count == 0)
        {
            // Nothing matched: do not create an empty playlist.
            return result;
        }

        if (target is not null)
        {
            await _playlistManager.AddItemToPlaylistAsync(target.Playlist.Id, ids, null, caller.User.Id).ConfigureAwait(false);
            result.PlaylistId = target.Playlist.Id;
        }
        else
        {
            var created = await _playlistManager.CreatePlaylist(new PlaylistCreationRequest
            {
                Name = request.Name!.Trim(),
                ItemIdList = ids,
                UserId = caller.User.Id,
                MediaType = MediaType.Audio,
                Public = false
            }).ConfigureAwait(false);
            result.PlaylistId = Guid.Parse(created.Id);
        }

        _logger.LogInformation("M3U import by {User}: {Matched} of {Total} entries matched", caller.User.Username, result.Matched, result.Total);
        return result;
    }

    /// <summary>
    /// Records that a person set (custom) or removed (not custom) the image of an automatic playlist, so the
    /// reconcile leaves a set image alone and puts the fixed image back after a removal.
    /// </summary>
    private static void MarkAutoImage(Guid playlistId, bool custom)
    {
        var entry = AutoPlaylistEntry.FindByPlaylist(Config, playlistId);
        if (entry is null)
        {
            return;
        }

        entry.CustomImage = custom;
        entry.ImageChecksum = null;
        Plugin.Instance?.SaveConfiguration();
    }

    private static long MaxImageBytes(PluginConfiguration config)
    {
        return Math.Max(1, config.MaxImageSizeMb) * 1024L * 1024L;
    }

    private static bool LooksLikeImage(MemoryStream stream, string mimeType)
    {
        if (stream.Length < 12)
        {
            return false;
        }

        var head = stream.GetBuffer().AsSpan(0, 12);
        return mimeType switch
        {
            "image/jpeg" => head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF,
            "image/png" => head[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }),
            "image/gif" => head[..4].SequenceEqual("GIF8"u8),
            "image/webp" => head[..4].SequenceEqual("RIFF"u8) && head[8..12].SequenceEqual("WEBP"u8),
            _ => false
        };
    }

    private static string SafeFileName(string? name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string((name ?? "playlist").Select(c => invalid.Contains(c) || c == '"' ? '_' : c).ToArray()).Trim();
        return cleaned.Length == 0 ? "playlist" : cleaned;
    }

    private async Task<(PlaylistAccess? Access, Caller? Caller, ActionResult? Error)> ResolveAsync(Guid playlistId)
    {
        var caller = await _access.GetCaller(HttpContext).ConfigureAwait(false);
        if (caller is null)
        {
            return (null, null, Forbid());
        }

        var access = _access.Resolve(playlistId, caller.User);
        return access is null
            ? (null, caller, NotFound("Playlist not found"))
            : (access, caller, null);
    }

    private AutoPlaylistsDto ToAutoDto(Guid userId)
    {
        static AutoPlaylistStateDto Map(AutoPlaylistState state) => new()
        {
            Enabled = state.Enabled,
            PlaylistId = state.PlaylistId,
            ItemCount = state.ItemCount
        };

        return new AutoPlaylistsDto
        {
            Favorites = Map(_autoPlaylists.GetState(userId, AutoPlaylistKind.Favorites)),
            Dislikes = Map(_autoPlaylists.GetState(userId, AutoPlaylistKind.Dislikes))
        };
    }

    private PlaylistInfoDto ToInfo(PlaylistAccess access)
    {
        var playlist = access.Playlist;
        var info = new PlaylistInfoDto
        {
            Id = playlist.Id,
            Name = playlist.Name ?? string.Empty,
            Overview = playlist.Overview ?? string.Empty,
            MediaType = playlist.MediaType.ToString(),
            OwnerUserId = playlist.OwnerUserId,
            OwnerName = playlist.OwnerUserId == Guid.Empty ? null : _userManager.GetUserById(playlist.OwnerUserId)?.Username,
            OpenAccess = playlist.OpenAccess,
            HasImage = playlist.HasImage(ImageType.Primary, 0),
            IsOwner = access.IsOwner,
            CanEditItems = access.CanEditItems,
            CanManage = access.CanManage,
            CanShare = access.CanShare,
            AutoKind = access.AutoKind?.ToString(),
            IsAutoSubject = access.IsAutoSubject
        };

        if (access.CanShare)
        {
            info.Shares = playlist.Shares
                .Select(s => new ShareDto
                {
                    UserId = s.UserId,
                    UserName = _userManager.GetUserById(s.UserId)?.Username,
                    CanEdit = s.CanEdit
                })
                .ToList();
        }

        return info;
    }
}
