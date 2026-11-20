using System;
using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.PlaylistToolkit.Services;

/// <summary>
/// Shuffle that keeps the same artist from playing twice in a row and moves recently played tracks to the back.
/// Pure logic without server dependencies, so it can be unit tested.
/// </summary>
public static class SmartShuffler
{
    /// <summary>
    /// Leaves out the items the caller disliked. If that would leave nothing, the list is returned unchanged.
    /// </summary>
    /// <typeparam name="T">Item type.</typeparam>
    /// <param name="items">Items in playlist order.</param>
    /// <param name="isDisliked">Tells whether the caller disliked an item.</param>
    /// <returns>The remaining items, order kept.</returns>
    public static List<T> WithoutDisliked<T>(IReadOnlyList<T> items, Func<T, bool> isDisliked)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(isDisliked);
        var kept = items.Where(i => !isDisliked(i)).ToList();
        return kept.Count == 0 ? items.ToList() : kept;
    }

    private const int TierCount = 4;
    private const int WaitingTier = 3;

    /// <summary>
    /// Produces a play order.
    /// </summary>
    /// <param name="tracks">Tracks in any order.</param>
    /// <param name="now">Current time (UTC).</param>
    /// <param name="recentWindow">How long a track counts as recently played.</param>
    /// <param name="random">Random source.</param>
    /// <param name="previousArtistKey">Artist of the track that plays right before this order (endless mode), or null.</param>
    /// <returns>Indices into <paramref name="tracks"/> in play order.</returns>
    public static List<int> Shuffle(IReadOnlyList<ShuffleTrack> tracks, DateTime now, TimeSpan recentWindow, Random random, string? previousArtistKey = null)
    {
        ArgumentNullException.ThrowIfNull(tracks);
        ArgumentNullException.ThrowIfNull(random);

        // Tier 0: not played recently. Tier 1 and 2: recently played, split in two halves, the ones heard
        // longest ago first. Tier 3: still waiting in the running queue (endless mode); they are about
        // to play and therefore come last of all.
        var tiers = new int[tracks.Count];
        var threshold = now - recentWindow;
        var recent = new List<int>();
        for (var i = 0; i < tracks.Count; i++)
        {
            if (tracks[i].Waiting)
            {
                tiers[i] = WaitingTier;
                continue;
            }

            var played = tracks[i].LastPlayed;
            if (played.HasValue && played.Value > threshold)
            {
                recent.Add(i);
            }
        }

        recent.Sort((a, b) => Nullable.Compare(tracks[a].LastPlayed, tracks[b].LastPlayed));
        var olderCount = recent.Count - (recent.Count / 2);
        for (var i = 0; i < recent.Count; i++)
        {
            tiers[recent[i]] = i < olderCount ? 1 : 2;
        }

        // Per artist: tracks in random order, lowest tier taken first (from the end of the list).
        var groups = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        for (var i = 0; i < tracks.Count; i++)
        {
            var key = tracks[i].ArtistKey;
            if (!groups.TryGetValue(key, out var list))
            {
                list = [];
                groups[key] = list;
            }

            list.Add(i);
        }

        var artists = groups.Keys.ToArray();
        var queues = new List<int>[artists.Length];
        var counts = new int[artists.Length];
        var tierCounts = new int[artists.Length, TierCount];
        for (var a = 0; a < artists.Length; a++)
        {
            var list = groups[artists[a]];
            ShuffleInPlace(list, random);
            queues[a] = list.OrderByDescending(i => tiers[i]).ToList();
            counts[a] = list.Count;
            foreach (var index in list)
            {
                tierCounts[a, tiers[index]]++;
            }
        }

        // With R tracks left and artist L played last, an order without repeats exists exactly when no
        // other artist has more than ceil(R/2) tracks and L has at most floor(R/2). Each step only
        // considers artists that keep this true ("safe"), so the order never paints itself into a corner.
        // Among the safe artists the ones that still have a track of the lowest tier win; recently played
        // tracks therefore move to the back, but never at the price of an artist playing twice in a row.
        var result = new List<int>(tracks.Count);
        var remaining = tracks.Count;

        // Continuing after another order: its last artist must not open this one.
        var last = previousArtistKey is null ? -1 : Array.IndexOf(artists, previousArtistKey);
        var safe = new List<int>(artists.Length);
        while (remaining > 0)
        {
            int max1 = -1, max2 = -1, max1Index = -1;
            for (var a = 0; a < counts.Length; a++)
            {
                if (counts[a] > max1)
                {
                    max2 = max1;
                    max1 = counts[a];
                    max1Index = a;
                }
                else if (counts[a] > max2)
                {
                    max2 = counts[a];
                }
            }

            var after = remaining - 1;
            var ceilHalf = (after + 1) / 2;
            var floorHalf = after / 2;

            safe.Clear();
            var fallback = -1;
            var lowestTier = TierCount;
            for (var a = 0; a < counts.Length; a++)
            {
                if (counts[a] == 0 || a == last)
                {
                    continue;
                }

                if (fallback < 0 || counts[a] > counts[fallback])
                {
                    fallback = a;
                }

                var maxOther = a == max1Index ? max2 : max1;
                if (maxOther <= ceilHalf && counts[a] - 1 <= floorHalf)
                {
                    safe.Add(a);
                    lowestTier = Math.Min(lowestTier, tiers[queues[a][^1]]);
                }
            }

            int chosen;
            if (safe.Count > 0)
            {
                // Weighted by track count in the tier: every eligible track is equally likely.
                var weight = 0;
                foreach (var a in safe)
                {
                    weight += tierCounts[a, lowestTier];
                }

                var ticket = random.Next(weight);
                chosen = -1;
                foreach (var a in safe)
                {
                    ticket -= tierCounts[a, lowestTier];
                    if (ticket < 0)
                    {
                        chosen = a;
                        break;
                    }
                }
            }
            else if (fallback >= 0)
            {
                // No repeat-free order exists any more: take the biggest other artist to limit the damage.
                chosen = fallback;
            }
            else
            {
                // Only the artist played last is left.
                chosen = last;
            }

            var queue = queues[chosen];
            var track = queue[^1];
            queue.RemoveAt(queue.Count - 1);
            result.Add(track);
            counts[chosen]--;
            tierCounts[chosen, tiers[track]]--;
            remaining--;
            last = chosen;
        }

        return result;
    }

    private static void ShuffleInPlace(List<int> list, Random random)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }
}

/// <summary>
/// Input for <see cref="SmartShuffler"/>.
/// </summary>
/// <param name="ArtistKey">Normalized primary artist; tracks without artist get a unique key.</param>
/// <param name="LastPlayed">When the user last played the track, if ever.</param>
/// <param name="Waiting">The track is still waiting in the queue that this order continues.</param>
public readonly record struct ShuffleTrack(string ArtistKey, DateTime? LastPlayed, bool Waiting = false);
