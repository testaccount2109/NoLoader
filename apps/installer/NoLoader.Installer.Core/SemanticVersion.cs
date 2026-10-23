using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;

namespace NoLoader.Installer.Core;

public sealed class SemanticVersion : IComparable<SemanticVersion>
{
    private static readonly Regex Pattern = new(
        "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private SemanticVersion(BigInteger major, BigInteger minor, BigInteger patch, string[] prerelease)
    {
        Major = major;
        Minor = minor;
        Patch = patch;
        Prerelease = prerelease;
    }

    public BigInteger Major { get; }
    public BigInteger Minor { get; }
    public BigInteger Patch { get; }
    public IReadOnlyList<string> Prerelease { get; }

    public static SemanticVersion Parse(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var match = Pattern.Match(value);
        if (!match.Success)
        {
            throw new FormatException($"'{value}' is not a valid semantic version.");
        }

        var prerelease = match.Groups[4].Success ? match.Groups[4].Value.Split('.') : [];
        if (prerelease.Any(part => IsNumeric(part) && part.Length > 1 && part[0] == '0'))
        {
            throw new FormatException($"'{value}' contains a numeric prerelease identifier with a leading zero.");
        }

        return new SemanticVersion(
            BigInteger.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
            BigInteger.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
            BigInteger.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture),
            prerelease);
    }

    public static bool TryParse(string? value, out SemanticVersion? version)
    {
        try
        {
            version = value is null ? null : Parse(value);
            return version is not null;
        }
        catch (FormatException)
        {
            version = null;
            return false;
        }
    }

    public int CompareTo(SemanticVersion? other)
    {
        if (other is null) return 1;
        var result = Major.CompareTo(other.Major);
        if (result != 0) return result;
        result = Minor.CompareTo(other.Minor);
        if (result != 0) return result;
        result = Patch.CompareTo(other.Patch);
        if (result != 0) return result;

        if (Prerelease.Count == 0) return other.Prerelease.Count == 0 ? 0 : 1;
        if (other.Prerelease.Count == 0) return -1;

        for (var index = 0; index < Math.Min(Prerelease.Count, other.Prerelease.Count); index++)
        {
            var left = Prerelease[index];
            var right = other.Prerelease[index];
            var leftNumeric = IsNumeric(left);
            var rightNumeric = IsNumeric(right);
            if (leftNumeric && rightNumeric)
            {
                result = BigInteger.Parse(left, CultureInfo.InvariantCulture)
                    .CompareTo(BigInteger.Parse(right, CultureInfo.InvariantCulture));
            }
            else if (leftNumeric != rightNumeric)
            {
                result = leftNumeric ? -1 : 1;
            }
            else
            {
                result = string.CompareOrdinal(left, right);
            }

            if (result != 0) return result;
        }

        return Prerelease.Count.CompareTo(other.Prerelease.Count);
    }

    private static bool IsNumeric(string value) => value.All(char.IsAsciiDigit);
}
