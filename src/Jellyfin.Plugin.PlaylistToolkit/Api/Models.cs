using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.PlaylistToolkit.Api;

#pragma warning disable SA1402, SA1649, CA1002, CA2227, CA1819

/// <summary>Settings the web client needs.</summary>
public class ClientConfigDto
{
    /// <summary>Gets or sets the plugin version.</summary>
    public string Version { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the track table is enabled.</summary>
    public bool EnableTrackTable { get; set; }

    /// <summary>Gets or sets a value indicating whether the duplicate warning is enabled.</summary>
    public bool EnableDuplicateWarning { get; set; }

    /// <summary>Gets or sets the number of tracks the client hands to the player per request.</summary>
    public int MaxQueueSize { get; set; }

    /// <summary>Gets or sets a value indicating whether the caller is a server administrator.</summary>
    public bool IsAdministrator { get; set; }

    /// <summary>Gets or sets the maximum image size in bytes.</summary>
    public long MaxImageBytes { get; set; }

    /// <summary>Gets or sets the maximum description length.</summary>
    public int MaxDescriptionLength { get; set; }
}

/// <summary>A user that a playlist can be shared with.</summary>
public class UserDto
{
    /// <summary>Gets or sets the user id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the user name.</summary>
    public string Name { get; set; } = string.Empty;
}

/// <summary>One share entry.</summary>
public class ShareDto
{
    /// <summary>Gets or sets the user id.</summary>
    public Guid UserId { get; set; }

    /// <summary>Gets or sets the user name (output only).</summary>
    public string? UserName { get; set; }

    /// <summary>Gets or sets a value indicating whether the user may edit the playlist.</summary>
    public bool CanEdit { get; set; }
}

/// <summary>Playlist summary with the caller's rights.</summary>
public class PlaylistInfoDto
{
    /// <summary>Gets or sets the playlist id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the description.</summary>
    public string Overview { get; set; } = string.Empty;

    /// <summary>Gets or sets the media type (Audio, Video).</summary>
    public string MediaType { get; set; } = string.Empty;

    /// <summary>Gets or sets the owner id.</summary>
    public Guid OwnerUserId { get; set; }

    /// <summary>Gets or sets the owner name.</summary>
    public string? OwnerName { get; set; }

    /// <summary>Gets or sets a value indicating whether every user can see the playlist.</summary>
    public bool OpenAccess { get; set; }

    /// <summary>Gets or sets a value indicating whether the playlist has a primary image.</summary>
    public bool HasImage { get; set; }

    /// <summary>Gets or sets a value indicating whether the caller owns the playlist.</summary>
    public bool IsOwner { get; set; }

    /// <summary>Gets or sets a value indicating whether the caller may add, remove and move tracks.</summary>
    public bool CanEditItems { get; set; }

    /// <summary>Gets or sets a value indicating whether the caller may change image and description.</summary>
    public bool CanManage { get; set; }

    /// <summary>Gets or sets a value indicating whether the caller may change sharing.</summary>
    public bool CanShare { get; set; }

    /// <summary>Gets or sets the shares. Only filled for callers that may change sharing.</summary>
    public List<ShareDto> Shares { get; set; } = [];
}

/// <summary>One playlist in the administrator's list of all playlists.</summary>
public class PlaylistSummaryDto
{
    /// <summary>Gets or sets the playlist id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the media type (Audio, Video).</summary>
    public string MediaType { get; set; } = string.Empty;

    /// <summary>Gets or sets the owner id.</summary>
    public Guid OwnerUserId { get; set; }

    /// <summary>Gets or sets the owner name.</summary>
    public string? OwnerName { get; set; }

    /// <summary>Gets or sets a value indicating whether every user can see the playlist.</summary>
    public bool OpenAccess { get; set; }

    /// <summary>Gets or sets the number of users the playlist is shared with.</summary>
    public int ShareCount { get; set; }

    /// <summary>Gets or sets the number of entries.</summary>
    public int ItemCount { get; set; }
}

/// <summary>One row of the track table. New columns are added here and in the client's column list.</summary>
public class TrackRowDto
{
    /// <summary>Gets or sets the position in playlist order (0-based).</summary>
    public int Index { get; set; }

    /// <summary>Gets or sets the playlist entry id used by the stock move and remove endpoints.</summary>
    public string PlaylistItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the item id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the item type.</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>Gets or sets the title.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the artists.</summary>
    public IReadOnlyList<string> Artists { get; set; } = [];

    /// <summary>Gets or sets the album.</summary>
    public string? Album { get; set; }

    /// <summary>Gets or sets the album id, if the track is inside an album.</summary>
    public Guid? AlbumId { get; set; }

    /// <summary>Gets or sets the duration in ticks.</summary>
    public long? RunTimeTicks { get; set; }

    /// <summary>Gets or sets a value indicating whether the item has its own primary image.</summary>
    public bool HasImage { get; set; }
}

/// <summary>Track table content.</summary>
public class TrackListDto
{
    /// <summary>Gets or sets the rows in playlist order.</summary>
    public List<TrackRowDto> Items { get; set; } = [];

    /// <summary>Gets or sets the number of rows.</summary>
    public int TotalRecordCount { get; set; }

    /// <summary>Gets or sets the total duration in ticks.</summary>
    public long TotalRunTimeTicks { get; set; }
}

/// <summary>Request to change the description.</summary>
public class DescriptionRequest
{
    /// <summary>Gets or sets the description.</summary>
    public string? Overview { get; set; }
}

/// <summary>Request to replace the sharing settings.</summary>
public class SharingRequest
{
    /// <summary>Gets or sets a value indicating whether every user can see the playlist. Null leaves it unchanged.</summary>
    public bool? OpenAccess { get; set; }

    /// <summary>Gets or sets the complete list of shares. Null leaves it unchanged.</summary>
    public List<ShareDto>? Shares { get; set; }
}

/// <summary>Request carrying item ids.</summary>
public class ItemIdsRequest
{
    /// <summary>Gets or sets the item ids.</summary>
    public List<Guid> Ids { get; set; } = [];
}

/// <summary>A track that is already in the playlist.</summary>
public class DuplicateDto
{
    /// <summary>Gets or sets the id of the track to add.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the title.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the artist.</summary>
    public string? Artist { get; set; }

    /// <summary>Gets or sets the album.</summary>
    public string? Album { get; set; }

    /// <summary>Gets or sets the kind: "exact" (same library item) or "similar" (same title and artist, other item).</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Gets or sets the album of the entry already in the playlist.</summary>
    public string? ExistingAlbum { get; set; }
}

/// <summary>Result of a duplicate check.</summary>
public class DuplicateCheckDto
{
    /// <summary>Gets or sets the playlist name.</summary>
    public string PlaylistName { get; set; } = string.Empty;

    /// <summary>Gets or sets the number of tracks the request expands to (albums and artists become their tracks).</summary>
    public int Total { get; set; }

    /// <summary>Gets or sets the tracks already in the playlist.</summary>
    public List<DuplicateDto> Duplicates { get; set; } = [];

    /// <summary>Gets or sets the ids of the tracks not yet in the playlist.</summary>
    public List<Guid> NewIds { get; set; } = [];
}

/// <summary>Result of adding tracks.</summary>
public class AddResultDto
{
    /// <summary>Gets or sets the number of tracks added.</summary>
    public int Added { get; set; }
}

/// <summary>Smart shuffle result.</summary>
public class ShuffleResultDto
{
    /// <summary>Gets or sets the item ids in play order.</summary>
    public List<Guid> ItemIds { get; set; } = [];
}

/// <summary>Request for a smart shuffle order that continues a running queue (endless mode).</summary>
public class SmartShuffleRequest
{
    /// <summary>Gets or sets the track that plays right before the new order; its artist does not open it.</summary>
    public Guid? After { get; set; }

    /// <summary>Gets or sets the tracks that are still waiting in the queue; they count as just played.</summary>
    public List<Guid> Pending { get; set; } = [];
}

/// <summary>Request to start playback on the calling client.</summary>
public class PlayRequestDto
{
    /// <summary>Gets or sets the item ids in play order.</summary>
    public List<Guid> ItemIds { get; set; } = [];

    /// <summary>Gets or sets the index of the first track to play.</summary>
    public int StartIndex { get; set; }

    /// <summary>Gets or sets the mode: "play" (default), "next" or "last".</summary>
    public string? Mode { get; set; }
}

/// <summary>Result of a play request.</summary>
public class PlayResultDto
{
    /// <summary>Gets or sets the number of tracks sent to the client.</summary>
    public int Queued { get; set; }

    /// <summary>Gets or sets the number of tracks left out because of the queue limit.</summary>
    public int Truncated { get; set; }
}

/// <summary>M3U import request.</summary>
public class ImportRequest
{
    /// <summary>Gets or sets the name of the new playlist. Ignored when <see cref="PlaylistId"/> is set.</summary>
    public string? Name { get; set; }

    /// <summary>Gets or sets an existing playlist to append to.</summary>
    public Guid? PlaylistId { get; set; }

    /// <summary>Gets or sets the M3U text.</summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>M3U import result.</summary>
public class ImportResultDto
{
    /// <summary>Gets or sets the playlist id.</summary>
    public Guid PlaylistId { get; set; }

    /// <summary>Gets or sets the number of entries in the file.</summary>
    public int Total { get; set; }

    /// <summary>Gets or sets the number of entries matched to library tracks.</summary>
    public int Matched { get; set; }

    /// <summary>Gets or sets the entries that could not be matched.</summary>
    public List<string> Unmatched { get; set; } = [];
}
