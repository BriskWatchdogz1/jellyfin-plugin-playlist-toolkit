namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// The kinds of automatic playlist.
/// </summary>
public enum AutoPlaylistKind
{
    /// <summary>Every song the user marked as favourite.</summary>
    Favorites,

    /// <summary>Every song the user disliked (Jellyfin's rating <c>Likes == false</c>).</summary>
    Dislikes
}
