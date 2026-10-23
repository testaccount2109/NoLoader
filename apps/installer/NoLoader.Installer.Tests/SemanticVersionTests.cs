using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

public sealed class SemanticVersionTests
{
    [Fact]
    public void ComparesNumericPartsAndPrereleaseIdentifiersBySemverRules()
    {
        Assert.True(SemanticVersion.Parse("2.10.0").CompareTo(SemanticVersion.Parse("2.9.0")) > 0);
        Assert.True(SemanticVersion.Parse("1.0.0-alpha.10").CompareTo(SemanticVersion.Parse("1.0.0-alpha.2")) > 0);
        Assert.True(SemanticVersion.Parse("1.0.0-beta").CompareTo(SemanticVersion.Parse("1.0.0-beta.1")) < 0);
        Assert.True(SemanticVersion.Parse("1.0.0").CompareTo(SemanticVersion.Parse("1.0.0-rc.1")) > 0);
        Assert.Equal(0, SemanticVersion.Parse("1.0.0+build.9").CompareTo(SemanticVersion.Parse("1.0.0+build.1")));
    }

    [Theory]
    [InlineData("01.2.3")]
    [InlineData("1.2")]
    [InlineData("1.2.3-01")]
    [InlineData("1.2.3/../../x")]
    public void RejectsInvalidSemanticVersions(string value)
    {
        Assert.False(SemanticVersion.TryParse(value, out _));
    }
}
