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
        // The script carries the version of the plugin that serves it (token __PT_VERSION__), so the script can tell when the
        // page is older than the server. The content hash in the URL changes with it.
        var text = System.Text.Encoding.UTF8.GetString(buffer.ToArray())
            .Replace("__PT_VERSION__", typeof(Plugin).Assembly.GetName().Version?.ToString() ?? string.Empty, StringComparison.Ordinal);
        return System.Text.Encoding.UTF8.GetBytes(text);
    }
}
