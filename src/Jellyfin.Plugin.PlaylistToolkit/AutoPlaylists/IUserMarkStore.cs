using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// The songs a user marked: favourites and dislikes.
/// </summary>
/// <param name="Favorites">Ids of favourite songs.</param>
/// <param name="Dislikes">Ids of disliked songs.</param>
public sealed record UserMarks(IReadOnlySet<Guid> Favorites, IReadOnlySet<Guid> Dislikes);

/// <summary>
/// Reads the marks of a user.
/// </summary>
public interface IUserMarkStore
{
    /// <summary>
    /// Gets the favourite and the disliked songs of a user.
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The marks.</returns>
    Task<UserMarks> GetMarksAsync(Guid userId, CancellationToken cancellationToken);
}
