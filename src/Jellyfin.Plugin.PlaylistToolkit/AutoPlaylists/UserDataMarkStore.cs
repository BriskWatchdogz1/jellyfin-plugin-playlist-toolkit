using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations;
using MediaBrowser.Controller.Entities;
using Microsoft.EntityFrameworkCore;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// Reads the marks from Jellyfin's <c>UserData</c> table (read only), one query per user: a row with
/// <c>IsFavorite</c> is a favourite, a rating below <see cref="UserItemData.MinLikeValue"/> a dislike. Songs only.
/// </summary>
public class UserDataMarkStore : IUserMarkStore
{
    private static readonly string _audioTypeName = typeof(MediaBrowser.Controller.Entities.Audio.Audio).FullName!;

    private readonly IDbContextFactory<JellyfinDbContext> _dbFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="UserDataMarkStore"/> class.
    /// </summary>
    /// <param name="dbFactory">Database context factory of the server.</param>
    public UserDataMarkStore(IDbContextFactory<JellyfinDbContext> dbFactory)
    {
        _dbFactory = dbFactory;
    }

    /// <inheritdoc />
    public async Task<UserMarks> GetMarksAsync(Guid userId, CancellationToken cancellationToken)
    {
        var db = await _dbFactory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
        await using (db.ConfigureAwait(false))
        {
            var rows = await db.UserData
                .AsNoTracking()
                .Where(d => d.UserId == userId
                    && d.Item!.Type == _audioTypeName
                    && (d.IsFavorite || (d.Rating != null && d.Rating < UserItemData.MinLikeValue)))
                .Select(d => new { d.ItemId, d.IsFavorite, d.Rating })
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // A song can have several rows (one per user data key): any row counts.
            var favorites = new HashSet<Guid>();
            var dislikes = new HashSet<Guid>();
            foreach (var row in rows)
            {
                if (row.IsFavorite)
                {
                    favorites.Add(row.ItemId);
                }

                if (row.Rating is not null && row.Rating < UserItemData.MinLikeValue)
                {
                    dislikes.Add(row.ItemId);
                }
            }

            return new UserMarks(favorites, dislikes);
        }
    }
}
