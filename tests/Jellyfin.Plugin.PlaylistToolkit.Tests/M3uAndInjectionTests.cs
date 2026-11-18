using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using Jellyfin.Plugin.PlaylistToolkit.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class M3uAndInjectionTests
{
    [Fact]
    public void ParsesExtendedM3u()
    {
        const string Text = "﻿#EXTM3U\r\n#PLAYLIST:Test\r\n#EXTINF:215,Some Artist - A Title - With Dash\r\n/music/a/01.opus\r\n\r\n#EXTINF:-1,Only Title\r\nrel/02.mp3\r\n# comment\r\n/music/b/03.flac\r\n";
        var entries = M3uService.Parse(Text);
        Assert.Equal(3, entries.Count);
        Assert.Equal(new M3uEntry("/music/a/01.opus", "Some Artist", "A Title - With Dash"), entries[0]);
        Assert.Equal(new M3uEntry("rel/02.mp3", null, "Only Title"), entries[1]);
        Assert.Equal(new M3uEntry("/music/b/03.flac", null, null), entries[2]);
    }

    [Fact]
    public void ParsesPlainM3uAndEmptyInput()
    {
        Assert.Empty(M3uService.Parse(string.Empty));
        Assert.Single(M3uService.Parse("/x/y.mp3"));
    }

    [Theory]
    [InlineData("Don't Stop", "dontstop")]
    [InlineData("  DON’T   stop ", "dontstop")]
    [InlineData("Ｆｕｌｌｗｉｄｔｈ", "fullwidth")]
    [InlineData(null, "")]
    public void NormalizesText(string? input, string expected)
    {
        Assert.Equal(expected, TextKeys.Normalize(input));
    }

    [Fact]
    public void SongKeyNeedsTitleAndArtist()
    {
        Assert.Equal("title|artist", TextKeys.SongKey("Title!", "The-Artist".Replace("The-", string.Empty, StringComparison.Ordinal)));
        Assert.Null(TextKeys.SongKey("Title", null));
        Assert.Null(TextKeys.SongKey(" ", "Artist"));
    }

    [Theory]
    [InlineData("/web/index.html", true)]
    [InlineData("/web/", true)]
    [InlineData("/jellyfin/web/index.html", true)]
    [InlineData("/WEB/INDEX.HTML", true)]
    [InlineData("/web/main.bundle.js", false)]
    [InlineData("/web/index.html.map", false)]
    [InlineData("/Items", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void DetectsIndexPath(string? path, bool expected)
    {
        Assert.Equal(expected, ScriptInjectionMiddleware.IsIndexPath(path));
    }

    [Fact]
    public void InjectsScriptTagOnceBeforeBodyEnd()
    {
        const string Html = "<html><body><div id=\"reactRoot\"></div></body></html>";
        var injected = ScriptInjectionMiddleware.Inject(Html, "1.0.0.0");
        Assert.Contains("<script defer data-playlisttoolkit src=\"../PlaylistToolkit/ClientScript?v=1.0.0.0\"></script></body>", injected, StringComparison.Ordinal);
        Assert.Same(injected, ScriptInjectionMiddleware.Inject(injected, "1.0.0.0"));
    }

    [Fact]
    public void LeavesDocumentsWithoutBodyUntouched()
    {
        const string Html = "<html>no body</html>";
        Assert.Same(Html, ScriptInjectionMiddleware.Inject(Html, "1.0.0.0"));
    }

    private static async Task<(DefaultHttpContext Context, string Body)> RunMiddleware(RequestDelegate next, Func<string, string> transform)
    {
        var context = new DefaultHttpContext();
        var output = new MemoryStream();
        context.Response.Body = output;
        context.Request.Headers.AcceptEncoding = "gzip";
        context.Request.Headers.IfNoneMatch = "\"abc\"";
        await ScriptInjectionMiddleware.ProcessAsync(context, next, transform, NullLogger.Instance);
        return (context, Encoding.UTF8.GetString(output.ToArray()));
    }

    private static RequestDelegate Respond(string body, string contentType = "text/html", int status = 200)
    {
        return async context =>
        {
            context.Response.StatusCode = status;
            context.Response.ContentType = contentType;
            context.Response.Headers.ETag = "\"abc\"";
            var bytes = Encoding.UTF8.GetBytes(body);
            context.Response.ContentLength = bytes.Length;
            await context.Response.Body.WriteAsync(bytes);
        };
    }

    [Fact]
    public async Task MiddlewareReplacesHtmlAndFixesHeaders()
    {
        const string Html = "<html><body>ü</body></html>";
        var (context, body) = await RunMiddleware(Respond(Html), html => ScriptInjectionMiddleware.Inject(html, "v1"));
        Assert.Contains("data-playlisttoolkit", body, StringComparison.Ordinal);
        Assert.Equal(Encoding.UTF8.GetByteCount(body), context.Response.ContentLength);
        Assert.Equal("no-cache", context.Response.Headers.CacheControl.ToString());
        Assert.False(context.Response.Headers.ContainsKey("ETag"));
        Assert.False(context.Request.Headers.ContainsKey("Accept-Encoding"));
        Assert.False(context.Request.Headers.ContainsKey("If-None-Match"));
    }

    [Fact]
    public async Task MiddlewareServesTheStockDocumentWhenTheTransformFails()
    {
        const string Html = "<html><body>stock</body></html>";
        var (context, body) = await RunMiddleware(Respond(Html), _ => throw new InvalidOperationException("broken"));
        Assert.Equal(Html, body);
        Assert.Equal(200, context.Response.StatusCode);
        Assert.Equal(Encoding.UTF8.GetByteCount(Html), context.Response.ContentLength);
        Assert.Equal("\"abc\"", context.Response.Headers.ETag.ToString());
    }

    [Fact]
    public async Task MiddlewarePassesOtherResponsesThroughUnchanged()
    {
        var (notFound, notFoundBody) = await RunMiddleware(Respond("missing", "text/html", 404), _ => "changed");
        Assert.Equal("missing", notFoundBody);
        Assert.Equal(404, notFound.Response.StatusCode);

        var (_, jsonBody) = await RunMiddleware(Respond("{}", "application/json"), _ => "changed");
        Assert.Equal("{}", jsonBody);

        const string Tagged = "<html><body><script data-playlisttoolkit></script></body></html>";
        var (tagged, taggedBody) = await RunMiddleware(Respond(Tagged), html => ScriptInjectionMiddleware.Inject(html, "v1"));
        Assert.Equal(Tagged, taggedBody);
        Assert.Equal("\"abc\"", tagged.Response.Headers.ETag.ToString());
    }

    [Fact]
    public async Task MiddlewareDoesNotSwallowErrorsOfThePipelineAndRestoresTheBody()
    {
        var context = new DefaultHttpContext();
        var output = new MemoryStream();
        context.Response.Body = output;
        await Assert.ThrowsAsync<InvalidOperationException>(() => ScriptInjectionMiddleware.ProcessAsync(
            context, _ => throw new InvalidOperationException("pipeline"), html => html, NullLogger.Instance));
        Assert.Same(output, context.Response.Body);
    }
}
