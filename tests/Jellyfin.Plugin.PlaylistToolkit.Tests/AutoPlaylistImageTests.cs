using System.Linq;
using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class AutoPlaylistImageTests
{
    private const string Bundled = "bundled";

    [Fact]
    public void NoImageGetsTheBundledOne()
    {
        Assert.Equal(ImageAction.Apply, AutoPlaylistImage.Decide(false, false, null, null, Bundled));
    }

    [Fact]
    public void AnUnmarkedImageIsReplaced()
    {
        // 1.3.0.0 playlist or generated collage
        Assert.Equal(ImageAction.Apply, AutoPlaylistImage.Decide(true, false, null, "other", Bundled));
    }

    [Fact]
    public void ACustomImageIsKeptWhateverElseIsTrue()
    {
        Assert.Equal(ImageAction.Keep, AutoPlaylistImage.Decide(true, true, null, "other", Bundled));
        Assert.Equal(ImageAction.Keep, AutoPlaylistImage.Decide(false, true, null, null, Bundled));
    }

    [Fact]
    public void TheOwnCurrentImageIsKept()
    {
        Assert.Equal(ImageAction.Keep, AutoPlaylistImage.Decide(true, false, Bundled, Bundled, Bundled));
    }

    [Fact]
    public void TheOwnOutdatedImageIsRefreshed()
    {
        Assert.Equal(ImageAction.Apply, AutoPlaylistImage.Decide(true, false, "old", "old", Bundled));
    }

    [Fact]
    public void AChangedFileIsForeignAndRemembered()
    {
        Assert.Equal(ImageAction.MarkCustom, AutoPlaylistImage.Decide(true, false, "mine", "theirs", Bundled));
        Assert.Equal(ImageAction.MarkCustom, AutoPlaylistImage.Decide(true, false, "mine", null, Bundled));
    }

    [Fact]
    public void ARemovedImageComesBackWhenNotCustom()
    {
        Assert.Equal(ImageAction.Apply, AutoPlaylistImage.Decide(false, false, "mine", null, Bundled));
    }

    [Theory]
    [InlineData(AutoPlaylistKind.Favorites)]
    [InlineData(AutoPlaylistKind.Dislikes)]
    public void TheBundledImagesAreSquarePngs(AutoPlaylistKind kind)
    {
        var data = AutoPlaylistImage.Load(kind);
        Assert.True(data.Take(8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }));
        var width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
        var height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
        Assert.Equal(800, width);
        Assert.Equal(800, height);
    }

    [Fact]
    public void TheTwoImagesDiffer()
    {
        Assert.NotEqual(
            AutoPlaylistImage.Checksum(AutoPlaylistImage.Load(AutoPlaylistKind.Favorites)),
            AutoPlaylistImage.Checksum(AutoPlaylistImage.Load(AutoPlaylistKind.Dislikes)));
    }

    [Fact]
    public void TheRegistrySerialisesTheImageMarker()
    {
        var entry = new AutoPlaylistEntry { ImageChecksum = "abc", CustomImage = true };
        var serializer = new System.Xml.Serialization.XmlSerializer(typeof(AutoPlaylistEntry));
        using var writer = new System.IO.StringWriter();
        serializer.Serialize(writer, entry);
        using var reader = new System.IO.StringReader(writer.ToString());
        var back = (AutoPlaylistEntry)serializer.Deserialize(reader)!;
        Assert.Equal("abc", back.ImageChecksum);
        Assert.True(back.CustomImage);
    }
}
