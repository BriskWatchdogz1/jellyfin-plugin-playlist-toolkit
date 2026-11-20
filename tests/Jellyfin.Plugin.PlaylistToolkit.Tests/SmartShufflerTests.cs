using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.PlaylistToolkit.Services;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class SmartShufflerTests
{
    private static readonly DateTime _now = new(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan _window = TimeSpan.FromHours(72);

    [Fact]
    public void ReturnsEveryTrackExactlyOnce()
    {
        var tracks = Enumerable.Range(0, 500).Select(i => new ShuffleTrack("a" + (i % 37), null)).ToList();
        var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(1));
        Assert.Equal(Enumerable.Range(0, 500), order.OrderBy(i => i));
    }

    [Fact]
    public void EmptyAndSingle()
    {
        Assert.Empty(SmartShuffler.Shuffle([], _now, _window, new Random(1)));
        Assert.Equal([0], SmartShuffler.Shuffle([new ShuffleTrack("a", null)], _now, _window, new Random(1)));
    }

    [Fact]
    public void NeverRepeatsAnArtistWhenAnOrderWithoutRepeatsExists()
    {
        // Random artist distributions, including the tightest feasible one (largest artist = ceil(n/2)).
        var random = new Random(42);
        for (var round = 0; round < 400; round++)
        {
            var n = random.Next(1, 120);
            var artistCount = random.Next(1, 12);
            var tracks = new List<ShuffleTrack>();
            var dominant = round % 4 == 0 ? (n + 1) / 2 : 0;
            for (var i = 0; i < n; i++)
            {
                var artist = i < dominant ? "dominant" : "a" + random.Next(artistCount);
                tracks.Add(new ShuffleTrack(artist, null));
            }

            var largest = tracks.GroupBy(t => t.ArtistKey).Max(g => g.Count());
            if (largest > (n + 1) / 2)
            {
                continue;
            }

            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(round));
            for (var i = 1; i < order.Count; i++)
            {
                Assert.True(
                    tracks[order[i]].ArtistKey != tracks[order[i - 1]].ArtistKey,
                    $"round {round}: artist repeated at position {i}");
            }
        }
    }

    [Fact]
    public void KeepsRepeatsMinimalWhenOneArtistDominates()
    {
        // 8 of 10 tracks by one artist: repeats are unavoidable, but all tracks must still be returned.
        var tracks = Enumerable.Range(0, 10).Select(i => new ShuffleTrack(i < 8 ? "x" : "y" + i, null)).ToList();
        var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(3));
        Assert.Equal(10, order.Distinct().Count());
        var repeats = Enumerable.Range(1, 9).Count(i => tracks[order[i]].ArtistKey == tracks[order[i - 1]].ArtistKey);
        Assert.Equal(5, repeats); // x y x y x x x x x x -> best possible is 5 repeats
    }

    [Fact]
    public void RecentlyPlayedTracksComeLast()
    {
        var tracks = new List<ShuffleTrack>();
        for (var i = 0; i < 300; i++)
        {
            DateTime? played = i switch
            {
                < 100 => null,                       // never played
                < 200 => _now.AddDays(-30),          // long ago
                _ => _now.AddHours(-(i - 199))       // within the last 100 hours
            };
            tracks.Add(new ShuffleTrack("a" + (i % 50), played));
        }

        var recent = Enumerable.Range(0, 300).Where(i => tracks[i].LastPlayed > _now - _window).ToHashSet();
        Assert.Equal(72 - 1, recent.Count); // played 1..71 hours ago
        var newerHalf = recent.OrderBy(i => tracks[i].LastPlayed).Skip(recent.Count - (recent.Count / 2)).ToHashSet();
        const int PerArtist = 6;

        for (var seed = 0; seed < 50; seed++)
        {
            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(seed));

            // A recently played track may only move forward to separate the last few tracks of one artist.
            Assert.DoesNotContain(order.Take(300 - recent.Count - PerArtist), recent.Contains);
            Assert.All(order.Skip(300 - (newerHalf.Count - PerArtist)), i => Assert.Contains(i, newerHalf));
            for (var i = 1; i < order.Count; i++)
            {
                Assert.NotEqual(tracks[order[i]].ArtistKey, tracks[order[i - 1]].ArtistKey);
            }
        }
    }

    [Fact]
    public void ArtistRuleWinsOverRecency()
    {
        // 5 tracks each of two artists; play history is lopsided (4 of A's tracks are recent).
        // Strict alternation is the only order without repeats and must be found.
        var tracks = new List<ShuffleTrack>();
        for (var i = 0; i < 5; i++)
        {
            tracks.Add(new ShuffleTrack("a", i < 4 ? _now.AddHours(-1 - i) : null));
            tracks.Add(new ShuffleTrack("b", null));
        }

        for (var seed = 0; seed < 100; seed++)
        {
            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(seed));
            for (var i = 1; i < order.Count; i++)
            {
                Assert.NotEqual(tracks[order[i]].ArtistKey, tracks[order[i - 1]].ArtistKey);
            }
        }
    }

    [Fact]
    public void NoRepeatWithMixedHistory()
    {
        var random = new Random(5);
        for (var round = 0; round < 300; round++)
        {
            var tracks = new List<ShuffleTrack>();
            var n = random.Next(2, 80);
            for (var i = 0; i < n; i++)
            {
                tracks.Add(new ShuffleTrack("a" + random.Next(6), random.Next(2) == 0 ? null : _now.AddHours(-random.Next(1, 70))));
            }

            if (tracks.GroupBy(t => t.ArtistKey).Max(g => g.Count()) > (n + 1) / 2)
            {
                continue;
            }

            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(round));
            Assert.Equal(n, order.Distinct().Count());
            for (var i = 1; i < order.Count; i++)
            {
                Assert.NotEqual(tracks[order[i]].ArtistKey, tracks[order[i - 1]].ArtistKey);
            }
        }
    }

    [Fact]
    public void DoesNotStartWithThePreviousArtist()
    {
        // Endless mode: the new order follows a track by "a3"; with 5 artists that is always avoidable.
        var tracks = Enumerable.Range(0, 60).Select(i => new ShuffleTrack("a" + (i % 5), i % 3 == 0 ? _now.AddHours(-i - 1) : null)).ToList();
        for (var seed = 0; seed < 200; seed++)
        {
            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(seed), "a3");
            Assert.NotEqual("a3", tracks[order[0]].ArtistKey);
            for (var i = 1; i < order.Count; i++)
            {
                Assert.NotEqual(tracks[order[i]].ArtistKey, tracks[order[i - 1]].ArtistKey);
            }
        }

        // An artist that is not in the list, or the only artist, must not break anything.
        Assert.Equal(60, SmartShuffler.Shuffle(tracks, _now, _window, new Random(1), "unknown").Count);
        var single = new List<ShuffleTrack> { new("x", null), new("x", null) };
        Assert.Equal(2, SmartShuffler.Shuffle(single, _now, _window, new Random(1), "x").Count);
    }

    [Fact]
    public void WaitingTracksComeLastOfAll()
    {
        // Endless mode on a playlist that was just played through: everything is "recent"; the 5 tracks
        // still waiting in the queue must not open the next round.
        var tracks = new List<ShuffleTrack>();
        for (var i = 0; i < 40; i++)
        {
            tracks.Add(new ShuffleTrack("a" + (i % 8), i < 35 ? _now.AddMinutes(-200 + (i * 4)) : null, Waiting: i >= 35));
        }

        for (var seed = 0; seed < 100; seed++)
        {
            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(seed), tracks[39].ArtistKey);
            Assert.Equal(40, order.Distinct().Count());
            Assert.NotEqual(tracks[39].ArtistKey, tracks[order[0]].ArtistKey);

            // A waiting track may only move forward to separate the last tracks of one artist (5 per artist).
            Assert.DoesNotContain(order.Take(40 - 5 - 5), i => tracks[i].Waiting);
            for (var i = 1; i < order.Count; i++)
            {
                Assert.NotEqual(tracks[order[i]].ArtistKey, tracks[order[i - 1]].ArtistKey);
            }
        }
    }

    [Fact]
    public void WaitingTracksOnATinyPlaylist()
    {
        // 8 tracks, 4 artists; 6 are still waiting when the next round is fetched. The 2 tracks that are
        // already through open the next round.
        var tracks = new List<ShuffleTrack>
        {
            new("c", _now.AddSeconds(-8)), new("b", _now.AddSeconds(-4)),
            new("c", null, true), new("d", null, true), new("b", null, true), new("a", null, true), new("d", null, true), new("a", null, true)
        };
        for (var seed = 0; seed < 100; seed++)
        {
            var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(seed), "a");
            Assert.Equal([0, 1], order.Take(2).OrderBy(i => i));
        }
    }

    [Fact]
    public void IsRandom()
    {
        var tracks = Enumerable.Range(0, 200).Select(i => new ShuffleTrack("a" + (i % 40), null)).ToList();
        var a = SmartShuffler.Shuffle(tracks, _now, _window, new Random(1));
        var b = SmartShuffler.Shuffle(tracks, _now, _window, new Random(2));
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void HandlesLargePlaylistsQuickly()
    {
        var random = new Random(9);
        var tracks = Enumerable.Range(0, 5000).Select(_ => new ShuffleTrack("a" + random.Next(900), null)).ToList();
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var order = SmartShuffler.Shuffle(tracks, _now, _window, new Random(1));
        watch.Stop();
        Assert.Equal(5000, order.Count);
        Assert.True(watch.ElapsedMilliseconds < 2000, $"took {watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void WithoutDislikedDropsDislikedItemsAndKeepsOrder()
    {
        var kept = SmartShuffler.WithoutDisliked(new[] { 1, 2, 3, 4, 5 }, i => i % 2 == 0);
        Assert.Equal([1, 3, 5], kept);
    }

    [Fact]
    public void WithoutDislikedKeepsEverythingWhenAllAreDisliked()
    {
        Assert.Equal([1, 2], SmartShuffler.WithoutDisliked(new[] { 1, 2 }, _ => true));
        Assert.Empty(SmartShuffler.WithoutDisliked(Array.Empty<int>(), _ => true));
    }
}
