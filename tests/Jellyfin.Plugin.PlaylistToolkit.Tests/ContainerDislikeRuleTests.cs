using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class ContainerDislikeRuleTests
{
    private static readonly Guid _album = Guid.NewGuid();

    private static ContainerDislikes Artists(params string[] clean) => new(new HashSet<Guid>(), clean.ToHashSet());

    [Theory]
    [InlineData(null, ArtistDislikeScope.AlbumOrMainArtist)]
    [InlineData("", ArtistDislikeScope.AlbumOrMainArtist)]
    [InlineData("nonsense", ArtistDislikeScope.AlbumOrMainArtist)]
    [InlineData("albumartist", ArtistDislikeScope.AlbumArtist)]
    [InlineData("ANYARTIST", ArtistDislikeScope.AnyArtist)]
    public void ScopeParsing(string? value, ArtistDislikeScope expected) => Assert.Equal(expected, ContainerDislikeRule.ParseScope(value));

    [Fact]
    public void NothingDislikedCoversNothing()
    {
        Assert.False(ContainerDislikeRule.Covers(ContainerDislikes.None, _album, ["Lead"], ["Lead"], ArtistDislikeScope.AnyArtist));
        Assert.True(ContainerDislikes.None.IsEmpty);
    }

    [Fact]
    public void DislikedAlbumCoversItsSongs()
    {
        var d = new ContainerDislikes(new HashSet<Guid> { _album }, new HashSet<string>());
        Assert.True(ContainerDislikeRule.Covers(d, _album, [], [], ArtistDislikeScope.AlbumArtist));
        Assert.False(ContainerDislikeRule.Covers(d, Guid.NewGuid(), [], [], ArtistDislikeScope.AlbumArtist));
        Assert.False(ContainerDislikeRule.Covers(d, null, [], [], ArtistDislikeScope.AlbumArtist));
    }

    [Theory]
    [InlineData(ArtistDislikeScope.AlbumArtist, true, false, false)]
    [InlineData(ArtistDislikeScope.AlbumOrMainArtist, true, true, false)]
    [InlineData(ArtistDislikeScope.AnyArtist, true, true, true)]
    public void ArtistScope(ArtistDislikeScope scope, bool asAlbumArtist, bool asMain, bool asGuest)
    {
        var d = Artists("wolf");
        Assert.Equal(asAlbumArtist, ContainerDislikeRule.Covers(d, null, ["Wolf"], ["Other"], scope));
        Assert.Equal(asMain, ContainerDislikeRule.Covers(d, null, ["Various"], ["Wolf", "Other"], scope));
        Assert.Equal(asGuest, ContainerDislikeRule.Covers(d, null, ["Various"], ["Other", "Wolf"], scope));
    }

    [Fact]
    public void NamesAreComparedAsCleanNames()
    {
        Assert.True(ContainerDislikeRule.Covers(Artists("motley crue"), null, ["M\u00f6tley Cr\u00fce"], [], ArtistDislikeScope.AlbumArtist));
    }
}
