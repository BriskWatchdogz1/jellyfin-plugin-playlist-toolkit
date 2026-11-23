using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class LogValueTests
{
    [Theory]
    [InlineData(null, "-")]
    [InlineData("", "-")]
    [InlineData("/Users/x/FavoriteItems/y", "/Users/x/FavoriteItems/y")]
    [InlineData("Client=Web\r\nfake line", "Client=Web  fake line")]
    public void ForLog_RemovesControlCharacters(string? input, string expected)
    {
        Assert.Equal(expected, AutoPlaylistWorker.ForLog(input));
    }
}
