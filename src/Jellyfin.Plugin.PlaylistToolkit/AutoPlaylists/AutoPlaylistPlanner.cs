using System;
using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.PlaylistToolkit.AutoPlaylists;

/// <summary>
/// The result of <see cref="AutoPlaylistPlanner.Plan"/>.
/// </summary>
/// <param name="NewOrder">Entries of the playlist after the run.</param>
/// <param name="Changed">The new order differs from the current one.</param>
/// <param name="Added">Number of songs added.</param>
/// <param name="Removed">Number of entries removed (also duplicates).</param>
public sealed record AutoPlaylistPlan(List<Guid> NewOrder, bool Changed, int Added, int Removed);

/// <summary>
/// Pure planning of an automatic playlist: what the list looks like after the next run.
/// </summary>
public static class AutoPlaylistPlanner
{
    /// <summary>
    /// Keeps the current order of entries that are still wanted (first occurrence), drops the others and
    /// puts the new songs on top (or at the end).
    /// </summary>
    /// <param name="current">Entries now in the playlist, in order.</param>
    /// <param name="target">Songs that belong in the playlist.</param>
    /// <param name="addedSorted">New songs in the order they should enter the list.</param>
    /// <param name="newestFirst">New songs before the kept ones (true) or after them (false).</param>
    /// <returns>The plan.</returns>
    public static AutoPlaylistPlan Plan(IReadOnlyList<Guid> current, IReadOnlySet<Guid> target, IReadOnlyList<Guid> addedSorted, bool newestFirst)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(addedSorted);

        var seen = new HashSet<Guid>();
        var kept = new List<Guid>();
        foreach (var id in current)
        {
            if (target.Contains(id) && seen.Add(id))
            {
                kept.Add(id);
            }
        }

        var added = new List<Guid>();
        foreach (var id in addedSorted)
        {
            if (target.Contains(id) && seen.Add(id))
            {
                added.Add(id);
            }
        }

        var order = newestFirst ? added.Concat(kept).ToList() : kept.Concat(added).ToList();
        var changed = !order.SequenceEqual(current);
        return new AutoPlaylistPlan(order, changed, added.Count, current.Count - kept.Count);
    }
}
