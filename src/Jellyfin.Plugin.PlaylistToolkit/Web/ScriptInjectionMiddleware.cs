using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.PlaylistToolkit.Web;

/// <summary>
/// Adds a script tag for the plugin's client script to the web client's index.html while it is served.
/// Nothing on disk is modified, so container updates cannot leave a patched file behind.
/// </summary>
public class ScriptInjectionMiddleware
{
    /// <summary>
    /// Marker attribute used to detect an already injected tag.
    /// </summary>
    internal const string Marker = "data-playlisttoolkit";

    private readonly RequestDelegate _next;
    private readonly ILogger<ScriptInjectionMiddleware> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ScriptInjectionMiddleware"/> class.
    /// </summary>
    /// <param name="next">Next middleware.</param>
    /// <param name="logger">Logger.</param>
    public ScriptInjectionMiddleware(RequestDelegate next, ILogger<ScriptInjectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Decides whether a request path addresses the web client's entry document.
    /// </summary>
    /// <param name="path">Request path, possibly with a base URL prefix.</param>
    /// <returns>True for /web, /web/ and /web/index.html.</returns>
    internal static bool IsIndexPath(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        return path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Inserts the script tag before the closing body tag.
    /// </summary>
    /// <param name="html">Original document.</param>
    /// <param name="version">Script version, used as cache buster.</param>
    /// <returns>The document with the tag, or the unchanged document if it already has one or has no body end tag.</returns>
    internal static string Inject(string html, string version)
    {
        if (html.Contains(Marker, StringComparison.Ordinal))
        {
            return html;
        }

        var index = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            return html;
        }

        // index.html lives in <base>/web/, the API one level above.
        var tag = "<script defer " + Marker + " src=\"../PlaylistToolkit/ClientScript?v=" + Uri.EscapeDataString(version) + "\"></script>";
        return html.Insert(index, tag);
    }

    /// <summary>
    /// Handles a request.
    /// </summary>
    /// <param name="context">HTTP context.</param>
    /// <returns>Task.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        var plugin = Plugin.Instance;
        if (plugin is null
            || !plugin.Configuration.InjectClientScript
            || !HttpMethods.IsGet(context.Request.Method)
            || !IsIndexPath(context.Request.Path.Value))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        await ProcessAsync(context, _next, html => Inject(html, ClientScript.Version), _logger).ConfigureAwait(false);
    }

    /// <summary>
    /// Runs the rest of the pipeline with a buffered response and replaces an HTML document with its transformed version.
    /// Whatever goes wrong in the plugin's own part, the response of the pipeline is passed on unchanged:
    /// the web client's entry document must never fail because of this plugin.
    /// </summary>
    /// <param name="context">HTTP context.</param>
    /// <param name="next">Rest of the pipeline.</param>
    /// <param name="transform">Returns the changed document, or the same string instance for "no change".</param>
    /// <param name="logger">Logger.</param>
    /// <returns>Task.</returns>
    internal static async Task ProcessAsync(HttpContext context, RequestDelegate next, Func<string, string> transform, ILogger logger)
    {
        // The document must arrive here complete and uncompressed, and a cached copy without the
        // script must not be revalidated with a 304.
        context.Request.Headers.Remove(HeaderNames.AcceptEncoding);
        context.Request.Headers.Remove(HeaderNames.IfNoneMatch);
        context.Request.Headers.Remove(HeaderNames.IfModifiedSince);
        context.Request.Headers.Remove(HeaderNames.Range);
        context.Request.Headers.Remove(HeaderNames.IfRange);

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next(context).ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        var original = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        byte[]? replacement = null;
        try
        {
            var contentType = context.Response.ContentType;
            var isHtml = !context.Response.HasStarted
                && context.Response.StatusCode == StatusCodes.Status200OK
                && contentType is not null
                && contentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase);
            if (isHtml)
            {
                var html = Encoding.UTF8.GetString(original.Span);
                var changed = transform(html);
                if (!ReferenceEquals(changed, html))
                {
                    replacement = Encoding.UTF8.GetBytes(changed);
                }
            }
        }
#pragma warning disable CA1031 // The stock document is the fallback for every failure in here.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            logger.LogError(ex, "Could not add the Playlist Toolkit script to index.html; serving the stock document");
            replacement = null;
        }

        if (replacement is null)
        {
            await originalBody.WriteAsync(original, context.RequestAborted).ConfigureAwait(false);
            return;
        }

        context.Response.Headers.Remove(HeaderNames.ETag);
        context.Response.Headers.Remove(HeaderNames.LastModified);
        context.Response.Headers.Remove(HeaderNames.AcceptRanges);
        context.Response.Headers[HeaderNames.CacheControl] = "no-cache";
        context.Response.ContentLength = replacement.Length;
        await originalBody.WriteAsync(replacement, context.RequestAborted).ConfigureAwait(false);
    }
}
