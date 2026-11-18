using System;
using System.IO;
using System.Security.Cryptography;

namespace Jellyfin.Plugin.PlaylistToolkit.Web;

/// <summary>
/// The embedded web client script.
/// </summary>
public static class ClientScript
{
    private static readonly Lazy<byte[]> _content = new(Load);
    private static readonly Lazy<string> _version = new(() => Convert.ToHexString(SHA256.HashData(_content.Value), 0, 8).ToLowerInvariant());

    /// <summary>
    /// Gets the script bytes (UTF-8).
    /// </summary>
    public static byte[] Content => _content.Value;

    /// <summary>
    /// Gets a short content hash. It is part of the script URL, so browsers fetch a changed script at once
    /// and may cache an unchanged one for a long time.
    /// </summary>
    public static string Version => _version.Value;

    private static byte[] Load()
    {
        using var stream = typeof(ClientScript).Assembly.GetManifestResourceStream(typeof(Plugin).Namespace + ".Web.client.js")
            ?? throw new InvalidOperationException("Embedded client script is missing.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
