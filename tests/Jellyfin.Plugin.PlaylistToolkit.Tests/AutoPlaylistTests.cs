using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Serialization;
using Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;
using Jellyfin.Plugin.PlaylistToolkit.Configuration;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class AutoPlaylistTests
{
    private static Guid G(int n) => new(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    private static HashSet<Guid> Set(params int[] n) => n.Select(G).ToHashSet();

    private static List<Guid> L(params int[] n) => n.Select(G).ToList();

    [Fact]
    public void EmptyListGetsTheSortedAdditions()
    {
        var plan = AutoPlaylistPlanner.Plan([], Set(1, 2, 3), L(2, 3, 1), true);
        Assert.Equal(L(2, 3, 1), plan.NewOrder);
        Assert.True(plan.Changed);
        Assert.Equal(3, plan.Added);
        Assert.Equal(0, plan.Removed);
    }

    [Fact]
    public void NewestFirstPutsAdditionsBeforeKeptEntries()
    {
        var plan = AutoPlaylistPlanner.Plan(L(1, 2), Set(1, 2, 3, 4), L(3, 4), true);
        Assert.Equal(L(3, 4, 1, 2), plan.NewOrder);
    }

    [Fact]
    public void AppendModePutsAdditionsAfterKeptEntries()
    {
        var plan = AutoPlaylistPlanner.Plan(L(1, 2), Set(1, 2, 3, 4), L(3, 4), false);
        Assert.Equal(L(1, 2, 3, 4), plan.NewOrder);
    }

    [Fact]
    public void AnEntryNotInTheTargetIsRemoved()
    {
        var plan = AutoPlaylistPlanner.Plan(L(1, 2, 3), Set(1, 3), [], true);
        Assert.Equal(L(1, 3), plan.NewOrder);
        Assert.True(plan.Changed);
        Assert.Equal(1, plan.Removed);
    }

    [Fact]
    public void ADuplicateInTheCurrentListIsKeptOnce()
    {
        var plan = AutoPlaylistPlanner.Plan(L(1, 2, 1), Set(1, 2), [], true);
        Assert.Equal(L(1, 2), plan.NewOrder);
        Assert.True(plan.Changed);
        Assert.Equal(1, plan.Removed);
    }

    [Fact]
    public void NothingToDoChangesNothing()
    {
        var plan = AutoPlaylistPlanner.Plan(L(3, 1, 2), Set(1, 2, 3), [], true);
        Assert.False(plan.Changed);
        Assert.Equal(L(3, 1, 2), plan.NewOrder);
        Assert.Equal(0, plan.Added);
        Assert.Equal(0, plan.Removed);
    }

    [Fact]
    public void AnIdAlreadyInTheListIsNotAddedTwice()
    {
        var plan = AutoPlaylistPlanner.Plan(L(1, 2), Set(1, 2, 3), L(2, 3, 3), true);
        Assert.Equal(L(3, 1, 2), plan.NewOrder);
        Assert.Equal(1, plan.Added);
    }

    [Fact]
    public void TrackOrderSortsByArtistAlbumDiscTrackName()
    {
        var keys = new List<TrackSortKey>
        {
            new("b", "x", 1, 1, "t", G(1)),
            new("a", "z", 1, 1, "t", G(2)),
            new("a", "y", 2, 1, "t", G(3)),
            new("a", "y", 1, 2, "t", G(4)),
            new("a", "y", 1, 1, "b", G(5)),
            new("a", "y", 1, 1, "A", G(6))
        };
        var sorted = keys.OrderBy(k => k, TrackOrder.Instance).Select(k => k.Id).ToList();
        Assert.Equal(L(6, 5, 4, 3, 2, 1), sorted);
    }

    [Fact]
    public void TrackOrderIgnoresCaseAndIsStableForEqualKeys()
    {
        var a = new TrackSortKey("ABBA", "x", 1, 1, "t", G(2));
        var b = new TrackSortKey("abba", "x", 1, 1, "T", G(1));
        Assert.Equal(new[] { G(1), G(2) }, new[] { a, b }.OrderBy(k => k, TrackOrder.Instance).Select(k => k.Id).ToArray());
        Assert.Equal(0, TrackOrder.Instance.Compare(a, a));
    }

    [Fact]
    public void RegistryHelpersFindSetAndRemove()
    {
        var config = new PluginConfiguration();
        AutoPlaylistEntry.Set(config, G(1), AutoPlaylistKind.Favorites, G(10));
        AutoPlaylistEntry.Set(config, G(1), AutoPlaylistKind.Dislikes, G(11));
        AutoPlaylistEntry.Set(config, G(1), AutoPlaylistKind.Favorites, G(12));
        Assert.Equal(2, config.AutoPlaylists.Count);
        Assert.Equal(G(12), AutoPlaylistEntry.Find(config, G(1), AutoPlaylistKind.Favorites)!.PlaylistId);
        Assert.Equal(AutoPlaylistKind.Dislikes, AutoPlaylistEntry.FindByPlaylist(config, G(11))!.Kind);
        Assert.Null(AutoPlaylistEntry.Find(config, G(2), AutoPlaylistKind.Favorites));
        Assert.True(AutoPlaylistEntry.Remove(config, G(1), AutoPlaylistKind.Favorites));
        Assert.False(AutoPlaylistEntry.Remove(config, G(1), AutoPlaylistKind.Favorites));
        Assert.Single(config.AutoPlaylists);
    }

    [Fact]
    public void ConfigurationWithRegistrySurvivesAnXmlRoundTrip()
    {
        var config = new PluginConfiguration { FavoritesPlaylistName = "X" };
        AutoPlaylistEntry.Set(config, G(1), AutoPlaylistKind.Favorites, G(10));
        AutoPlaylistEntry.Set(config, G(2), AutoPlaylistKind.Dislikes, G(11));
        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        serializer.Serialize(writer, config);
        var back = (PluginConfiguration)serializer.Deserialize(new StringReader(writer.ToString()))!;
        Assert.Equal("X", back.FavoritesPlaylistName);
        Assert.Equal(2, back.AutoPlaylists.Count);
        Assert.Equal(G(11), AutoPlaylistEntry.Find(back, G(2), AutoPlaylistKind.Dislikes)!.PlaylistId);
    }

    [Fact]
    public void DefaultsAreOnWithTheOwnersNames()
    {
        var config = new PluginConfiguration();
        Assert.True(config.EnableFavoritesPlaylist);
        Assert.True(config.EnableDislikesPlaylist);
        Assert.Equal("Favoriten", config.GetAutoPlaylistName(AutoPlaylistKind.Favorites));
        Assert.Equal("Dislikes", config.GetAutoPlaylistName(AutoPlaylistKind.Dislikes));
        config.FavoritesPlaylistName = "  ";
        Assert.Equal("Favoriten", config.GetAutoPlaylistName(AutoPlaylistKind.Favorites));
        config.DislikesPlaylistName = " Mist ";
        Assert.Equal("Mist", config.GetAutoPlaylistName(AutoPlaylistKind.Dislikes));
    }

    [Theory]
    [InlineData(UserDataSaveReason.UpdateUserRating, true)]
    [InlineData(UserDataSaveReason.UpdateUserData, true)]
    [InlineData(UserDataSaveReason.Import, true)]
    [InlineData(UserDataSaveReason.PlaybackProgress, false)]
    [InlineData(UserDataSaveReason.PlaybackStart, false)]
    [InlineData(UserDataSaveReason.PlaybackFinished, false)]
    [InlineData(UserDataSaveReason.TogglePlayed, false)]
    public void WorkerReactsToSongsExceptPlaybackBookkeeping(UserDataSaveReason reason, bool expected)
    {
        Assert.Equal(expected, AutoPlaylistWorker.IsRelevant(new Audio(), reason, new PluginConfiguration()));
    }

    [Fact]
    public void WorkerIgnoresAlbumsAndSwitchedOffKinds()
    {
        Assert.False(AutoPlaylistWorker.IsRelevant(new MusicAlbum(), UserDataSaveReason.UpdateUserRating, new PluginConfiguration()));
        Assert.False(AutoPlaylistWorker.IsRelevant(null, UserDataSaveReason.UpdateUserRating, new PluginConfiguration()));
        var off = new PluginConfiguration { EnableFavoritesPlaylist = false, EnableDislikesPlaylist = false };
        Assert.False(AutoPlaylistWorker.IsRelevant(new Audio(), UserDataSaveReason.UpdateUserRating, off));
        var one = new PluginConfiguration { EnableFavoritesPlaylist = false };
        Assert.True(AutoPlaylistWorker.IsRelevant(new Audio(), UserDataSaveReason.UpdateUserRating, one));
    }

    private static PlaylistAccess Normal(bool admin, bool owner = false) =>
        new(null!, owner, admin, CanEditItems: true, CanManage: true, CanShare: true);

    [Fact]
    public void SubjectOfAnAutomaticPlaylistMayOnlyManageDetails()
    {
        var access = PlaylistAccessService.ApplyAutoRules(Normal(false, true), AutoPlaylistKind.Favorites, true);
        Assert.False(access.CanEditItems);
        Assert.False(access.CanShare);
        Assert.False(access.IsOwner);
        Assert.True(access.CanManage);
        Assert.True(access.IsAutoSubject);
        Assert.Equal(AutoPlaylistKind.Favorites, access.AutoKind);
    }

    [Fact]
    public void AnotherAdministratorGetsNoEditRightOnAnAutomaticPlaylist()
    {
        var access = PlaylistAccessService.ApplyAutoRules(Normal(true), AutoPlaylistKind.Dislikes, false);
        Assert.False(access.CanEditItems);
        Assert.False(access.CanShare);
        Assert.True(access.CanManage);
        Assert.False(access.IsAutoSubject);
    }

    [Fact]
    public void ANormalPlaylistKeepsItsRights()
    {
        var access = Normal(false, true);
        Assert.True(access.CanEditItems && access.CanShare && access.CanManage && access.IsOwner);
        Assert.Null(access.AutoKind);
        Assert.False(access.IsAutoSubject);
    }
}
