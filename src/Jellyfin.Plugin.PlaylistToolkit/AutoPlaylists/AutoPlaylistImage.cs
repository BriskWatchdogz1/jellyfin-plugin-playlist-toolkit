using System;
using System.IO;
using System.Security.Cryptography;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>What the reconcile does with the image of an automatic playlist.</summary>
public enum ImageAction
{
    /// <summary>Leave the image as it is.</summary>
    Keep,

    /// <summary>Save the bundled image.</summary>
    Apply,

    /// <summary>Somebody else set the image: remember that and leave it alone from now on.</summary>
    MarkCustom
}

/// <summary>
/// The fixed images of the automatic playlists (embedded in the plugin) and the rule when they are applied.
/// An image set by a person is never replaced: the plugin's own image endpoints and the check of the
/// recorded checksum against the file on disk tell the plugin's image from a foreign one.
/// </summary>
public static class AutoPlaylistImage
{
    /// <summary>The MIME type of the bundled images.</summary>
    public const string MimeType = "image/png";

    /// <summary>
    /// Reads the bundled image of a kind.
    /// </summary>
    /// <param name="kind">Kind.</param>
    /// <returns>The PNG bytes.</returns>
    public static byte[] Load(AutoPlaylistKind kind)
    {
        var name = typeof(Plugin).Namespace + ".Resources." + (kind == AutoPlaylistKind.Favorites ? "favorites.png" : "dislikes.png");
        using var stream = typeof(AutoPlaylistImage).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException("Embedded playlist image is missing: " + name);
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    /// <summary>
    /// Computes the checksum used as marker.
    /// </summary>
    /// <param name="data">File content.</param>
    /// <returns>Lower-case hex SHA-256.</returns>
    public static string Checksum(byte[] data)
    {
        return Convert.ToHexStringLower(SHA256.HashData(data));
    }

    /// <summary>
    /// Decides what to do with the image of an automatic playlist.
    /// </summary>
    /// <param name="hasImage">The playlist has a primary image.</param>
    /// <param name="customImage">A person set an image earlier (recorded in the registry).</param>
    /// <param name="markedChecksum">Checksum of the file when the plugin saved its image, null when it never did.</param>
    /// <param name="diskChecksum">Checksum of the file now, null when it cannot be read.</param>
    /// <param name="bundledChecksum">Checksum of the bundled image (what the plugin would save now).</param>
    /// <returns>The action.</returns>
    public static ImageAction Decide(bool hasImage, bool customImage, string? markedChecksum, string? diskChecksum, string bundledChecksum)
    {
        if (customImage)
        {
            return ImageAction.Keep;
        }

        if (!hasImage)
        {
            return ImageAction.Apply;
        }

        if (markedChecksum is null)
        {
            // Never marked: a playlist from 1.3.0.0 or a generated collage. Nobody chose it, so it is replaced.
            return ImageAction.Apply;
        }

        if (diskChecksum is not null && string.Equals(diskChecksum, markedChecksum, StringComparison.Ordinal))
        {
            // The plugin's own earlier image: refresh it only when the bundled one changed.
            return string.Equals(markedChecksum, bundledChecksum, StringComparison.Ordinal) ? ImageAction.Keep : ImageAction.Apply;
        }

        return ImageAction.MarkCustom;
    }
}
