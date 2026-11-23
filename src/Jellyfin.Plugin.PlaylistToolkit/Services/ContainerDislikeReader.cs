using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Database.Implementations;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using Microsoft.EntityFrameworkCore;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Reads the albums and artists a user disliked from Jellyfin's <c>UserData</c> table (read only), like
/// <see cref="AutoPlaylists.UserDataMarkStore"/> does for songs. The Dislike plugin is not needed for this.
/// </summary>
public interface IContainerDislikeReader
{
    /// <summary>
    /// Gets the albums and artists the user disliked.
    /// </summary>
    /// <param name="userId">User id.</param>
    /// <returns>The dislikes.</returns>
    ContainerDislikes Read(Guid userId);
}

/// <inheritdoc />
public class UserDataContainerDislikeReader : IContainerDislikeReader
{
    private static readonly string _albumType = typeof(MusicAlbum).FullName!;
    private static readonly string _artistType = typeof(MusicArtist).FullName!;

    private readonly IDbContextFactory<JellyfinDbContext> _dbFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="UserDataContainerDislikeReader"/> class.
    /// </summary>
    /// <param name="dbFactory">Database context factory of the server.</param>
    public UserDataContainerDislikeReader(IDbContextFactory<JellyfinDbContext> dbFactory)
    {
        _dbFactory = dbFactory;
    }

    /// <inheritdoc />
    public ContainerDislikes Read(Guid userId)
    {
        using var db = _dbFactory.CreateDbContext();
        var rows = db.UserData
            .AsNoTracking()
            .Where(d => d.UserId == userId
                && d.Rating != null
                && d.Rating < UserItemData.MinLikeValue
                && (d.Item!.Type == _albumType || d.Item.Type == _artistType))
            .Select(d => new { d.ItemId, d.Item!.Type, d.Item.CleanName })
            .ToList();
        var albums = rows.Where(r => r.Type == _albumType).Select(r => r.ItemId).ToHashSet();
        var artists = rows.Where(r => r.Type == _artistType && !string.IsNullOrEmpty(r.CleanName)).Select(r => r.CleanName!).ToHashSet(StringComparer.Ordinal);
        return albums.Count == 0 && artists.Count == 0 ? ContainerDislikes.None : new ContainerDislikes(albums, artists);
    }
}
