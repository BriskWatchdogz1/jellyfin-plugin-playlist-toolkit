using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Playlists;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Resolves the calling user and what that user may do with a playlist.
/// </summary>
public class PlaylistAccessService
{
    private readonly IAuthorizationContext _authorizationContext;
    private readonly IPlaylistManager _playlistManager;
    private readonly ILibraryManager _libraryManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="PlaylistAccessService"/> class.
    /// </summary>
    /// <param name="authorizationContext">Authorization context.</param>
    /// <param name="playlistManager">Playlist manager.</param>
    /// <param name="libraryManager">Library manager.</param>
    public PlaylistAccessService(IAuthorizationContext authorizationContext, IPlaylistManager playlistManager, ILibraryManager libraryManager)
    {
        _authorizationContext = authorizationContext;
        _playlistManager = playlistManager;
        _libraryManager = libraryManager;
    }

    /// <summary>
    /// Checks whether a user is a server administrator.
    /// </summary>
    /// <param name="user">User.</param>
    /// <returns>True for administrators.</returns>
    public static bool IsAdministrator(User user)
    {
        return user.HasPermission(PermissionKind.IsAdministrator);
    }

    /// <summary>
    /// Lists every playlist on the server, including private playlists of other users. For administrators only;
    /// the caller checks that.
    /// </summary>
    /// <returns>All playlists.</returns>
    public IReadOnlyList<Playlist> GetAllPlaylists()
    {
        return _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.Playlist],
            Recursive = true,
            DtoOptions = new DtoOptions(false)
        }).OfType<Playlist>().ToList();
    }

    /// <summary>
    /// Gets the authenticated caller.
    /// </summary>
    /// <param name="context">HTTP context.</param>
    /// <returns>The caller, or null for requests without a user (API keys).</returns>
    public async Task<Caller?> GetCaller(HttpContext context)
    {
        var info = await _authorizationContext.GetAuthorizationInfo(context).ConfigureAwait(false);
        return info.User is null ? null : new Caller(info.User, info.DeviceId);
    }

    /// <summary>
    /// Resolves a playlist the user can see, together with the user's rights.
    /// </summary>
    /// <param name="playlistId">Playlist id.</param>
    /// <param name="user">Calling user.</param>
    /// <returns>Access info, or null if the playlist does not exist or is not visible to the user.</returns>
    public PlaylistAccess? Resolve(Guid playlistId, User user)
    {
        ArgumentNullException.ThrowIfNull(user);

        var isAdmin = IsAdministrator(user);

        // Same lookup as the stock API: only playlists visible to the user are found.
        var playlist = _playlistManager.GetPlaylistForUser(playlistId, user.Id);
        if (playlist is null && isAdmin)
        {
            // Administrators reach every playlist, also private ones of other users that the stock
            // API hides from them.
            playlist = _libraryManager.GetItemById(playlistId) as Playlist;
        }

        if (playlist is null)
        {
            return null;
        }

        var isOwner = playlist.OwnerUserId != Guid.Empty && playlist.OwnerUserId.Equals(user.Id);
        var isEditor = playlist.Shares.Any(s => s.CanEdit && s.UserId.Equals(user.Id));
        var editorsMayManage = Plugin.Instance?.Configuration.EditorsCanEditDetails ?? false;

        var access = new PlaylistAccess(
            playlist,
            isOwner,
            isAdmin,
            CanEditItems: isOwner || isEditor || isAdmin,
            CanManage: isOwner || isAdmin || (isEditor && editorsMayManage),
            CanShare: isOwner || isAdmin);

        var config = Plugin.Instance?.Configuration;
        var entry = config is null ? null : AutoPlaylistEntry.FindByPlaylist(config, playlist.Id);
        return entry is null ? access : ApplyAutoRules(access, entry.Kind, entry.UserId.Equals(user.Id));
    }

    /// <summary>
    /// Turns the rights on an automatic playlist into the read-only shape: nobody may add, remove, move or
    /// share, administrators included. The user it belongs to and administrators may still change image and
    /// description.
    /// </summary>
    /// <param name="access">Rights as for a normal playlist.</param>
    /// <param name="kind">Kind of the automatic playlist.</param>
    /// <param name="isSubject">The caller is the user the playlist belongs to.</param>
    /// <returns>The adjusted rights.</returns>
    public static PlaylistAccess ApplyAutoRules(PlaylistAccess access, AutoPlaylistKind kind, bool isSubject)
    {
        ArgumentNullException.ThrowIfNull(access);
        return access with
        {
            IsOwner = false,
            CanEditItems = false,
            CanShare = false,
            CanManage = isSubject || access.IsAdmin,
            AutoKind = kind,
            IsAutoSubject = isSubject
        };
    }
}

/// <summary>
/// The authenticated caller of a request.
/// </summary>
/// <param name="User">User.</param>
/// <param name="DeviceId">Device id of the calling client.</param>
public sealed record Caller(User User, string? DeviceId);

/// <summary>
/// A playlist and the calling user's rights on it.
/// </summary>
/// <param name="Playlist">Playlist.</param>
/// <param name="IsOwner">Caller owns the playlist.</param>
/// <param name="IsAdmin">Caller is a server administrator.</param>
/// <param name="CanEditItems">Caller may add, remove and move tracks (owner, share with edit right, or administrator).</param>
/// <param name="CanManage">Caller may change image and description.</param>
/// <param name="CanShare">Caller may change who the playlist is shared with.</param>
/// <param name="AutoKind">Kind when the playlist is an automatic one, else null.</param>
/// <param name="IsAutoSubject">The caller is the user an automatic playlist belongs to.</param>
public sealed record PlaylistAccess(Playlist Playlist, bool IsOwner, bool IsAdmin, bool CanEditItems, bool CanManage, bool CanShare, AutoPlaylistKind? AutoKind = null, bool IsAutoSubject = false);
