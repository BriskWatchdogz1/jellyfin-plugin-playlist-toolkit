using Jellyfin.Plugin.PlaylistToolkit.ArtistNames;
using Xunit;

namespace Jellyfin.Plugin.PlaylistToolkit.Tests;

public class ArticleRuleTests
{
    private static readonly string[] Articles = ["The", "Die"];

    [Theory]
    [InlineData("The Pretty Reckless", "Pretty Reckless")]
    [InlineData("Die \u00c4rzte", "\u00c4rzte")]
    [InlineData("die Antwoord", "Antwoord")]
    [InlineData("THE Who", "Who")]
    [InlineData("  The   Strokes ", "Strokes")]
    public void ALeadingArticleIsTakenOff(string name, string sortName)
    {
        Assert.Equal(sortName, ArticleRule.SortName(name, Articles));
    }

    [Theory]
    [InlineData("Diesel")]
    [InlineData("Theory of a Deadman")]
    [InlineData("The")]
    [InlineData("Die ")]
    [InlineData("Within Temptation")]
    [InlineData("Bands The")]
    [InlineData("")]
    public void OnlyAWholeFirstWordWithMoreWordsCounts(string name)
    {
        Assert.Null(ArticleRule.SortName(name, Articles));
    }

    [Fact]
    public void TheArticleKeepsItsWritingForTheDisplay()
    {
        var split = ArticleRule.Split("The Pretty Reckless", Articles);
        Assert.Equal(("The", "Pretty Reckless"), split);
    }

    [Fact]
    public void TheSettingIsParsedLeniently()
    {
        Assert.Equal(["The", "die", "Les"], ArticleRule.ParseArticles(" The, die ;Les,, the "));
        Assert.Empty(ArticleRule.ParseArticles(null));
        Assert.Empty(ArticleRule.ParseArticles("Der Die"));
    }
}
