using System;
using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.PlaylistToolkit.ArtistNames;

/// <summary>
/// The rule for a leading article of an artist name ("The Pretty Reckless" is shown as "Pretty Reckless, The"
/// and sorted under P). Only a whole first word counts, so "Diesel" and "Theory" are left alone.
/// </summary>
public static class ArticleRule
{
    /// <summary>
    /// Splits a configured list ("The, Die") into articles.
    /// </summary>
    /// <param name="setting">Comma or semicolon separated words.</param>
    /// <returns>The articles without blanks and duplicates.</returns>
    public static IReadOnlyList<string> ParseArticles(string? setting)
    {
        return (setting ?? string.Empty)
            .Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(a => a.Length > 0 && a.IndexOfAny([' ', '\t']) < 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Splits the leading article off a name.
    /// </summary>
    /// <param name="name">Artist name.</param>
    /// <param name="articles">The articles.</param>
    /// <returns>The article as written and the rest, or null when the name does not start with an article followed by more words.</returns>
    public static (string Article, string Remainder)? Split(string? name, IReadOnlyCollection<string> articles)
    {
        ArgumentNullException.ThrowIfNull(articles);
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var trimmed = name.Trim();
        var space = trimmed.IndexOf(' ', StringComparison.Ordinal);
        if (space <= 0)
        {
            return null;
        }

        var first = trimmed[..space];
        var rest = trimmed[(space + 1)..].Trim();
        if (rest.Length == 0 || !articles.Contains(first, StringComparer.OrdinalIgnoreCase))
        {
            return null;
        }

        return (first, rest);
    }

    /// <summary>
    /// The sort name for an artist: the name without the article, or null when no article leads the name.
    /// </summary>
    /// <param name="name">Artist name.</param>
    /// <param name="articles">The articles.</param>
    /// <returns>The sort name or null.</returns>
    public static string? SortName(string? name, IReadOnlyCollection<string> articles)
    {
        return Split(name, articles)?.Remainder;
    }
}
