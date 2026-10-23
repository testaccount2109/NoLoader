using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoLoader.Installer.Core;

public static class ReleaseCatalogVerifier
{
    public const string ProductId = "NoLoader.Launcher";
    public const int CatalogSchemaVersion = 1;
    public const int MaximumCatalogBytes = 4 * 1024 * 1024;
    public const long MaximumArchiveBytes = 8L * 1024 * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 32
    };

    public static string GetKeyId(string publicKeyPem)
    {
        using var key = ECDsa.Create();
        key.ImportFromPem(publicKeyPem);
        if (key.KeySize != 256) throw new InvalidDataException("The pinned release key must be ECDSA P-256.");
        return Convert.ToHexString(SHA256.HashData(key.ExportSubjectPublicKeyInfo())).ToLowerInvariant();
    }

    public static ReleaseCatalog Verify(ReadOnlySpan<byte> envelopeBytes, string trustedPublicKeyPem, DateTimeOffset? now = null)
    {
        if (envelopeBytes.Length is 0 or > MaximumCatalogBytes)
            throw new InvalidDataException("The signed release catalog has an invalid size.");

        using var envelopeDocument = ParseStrictJson(envelopeBytes, "signed catalog envelope");
        var envelope = Deserialize<Envelope>(envelopeDocument.RootElement, "signed catalog envelope");
        if (envelope.SchemaVersion != CatalogSchemaVersion)
            throw new InvalidDataException($"Signed catalog schema {envelope.SchemaVersion} is not supported.");
        if (string.IsNullOrWhiteSpace(envelope.KeyId) || string.IsNullOrWhiteSpace(envelope.Payload) || string.IsNullOrWhiteSpace(envelope.Signature))
            throw new InvalidDataException("The signed catalog envelope is incomplete.");
        var expectedKeyId = GetKeyId(trustedPublicKeyPem);
        if (!string.Equals(envelope.KeyId, expectedKeyId, StringComparison.Ordinal))
            throw new InvalidDataException("The release catalog was signed by an untrusted key.");

        byte[] payload;
        byte[] signature;
        try
        {
            payload = Convert.FromBase64String(envelope.Payload);
            signature = Convert.FromBase64String(envelope.Signature);
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException("The signed catalog contains malformed base64 data.", exception);
        }
        if (payload.Length is 0 or > MaximumCatalogBytes || signature.Length != 64)
            throw new InvalidDataException("The signed catalog payload or ECDSA signature has an invalid size.");

        using (var key = ECDsa.Create())
        {
            key.ImportFromPem(trustedPublicKeyPem);
            if (!key.VerifyData(payload, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
                throw new InvalidDataException("The release catalog signature is invalid.");
        }

        using var payloadDocument = ParseStrictJson(payload, "signed release catalog");
        var catalog = Deserialize<CatalogPayload>(payloadDocument.RootElement, "signed release catalog");
        var currentTime = now ?? DateTimeOffset.UtcNow;
        if (catalog.SchemaVersion != CatalogSchemaVersion || catalog.ProductId != ProductId)
            throw new InvalidDataException("The signed catalog is for an unsupported schema or product.");
        if (catalog.GeneratedAtUtc > currentTime.AddMinutes(5))
            throw new InvalidDataException("The signed catalog was generated in the future.");
        if (catalog.ExpiresAtUtc <= currentTime || catalog.ExpiresAtUtc <= catalog.GeneratedAtUtc)
            throw new InvalidDataException("The signed catalog has expired or has an invalid validity period.");
        if (catalog.ExpiresAtUtc - catalog.GeneratedAtUtc > TimeSpan.FromDays(30))
            throw new InvalidDataException("The signed catalog validity period exceeds 30 days.");
        if (catalog.Releases is null || catalog.Releases.Count is 0 or > 1000)
            throw new InvalidDataException("The signed catalog must contain between 1 and 1000 releases.");

        var identities = new HashSet<string>(StringComparer.Ordinal);
        var verifiedReleases = new List<VerifiedLauncherRelease>(catalog.Releases.Count);
        foreach (var release in catalog.Releases)
        {
            ValidateRelease(release);
            var identity = $"{release.Version}|{release.Channel}|{release.Platform}|{release.Architecture}";
            if (!identities.Add(identity)) throw new InvalidDataException("The signed catalog contains a duplicate release target.");
            verifiedReleases.Add(new VerifiedLauncherRelease(release));
        }

        return new ReleaseCatalog(catalog.SchemaVersion, catalog.ProductId, catalog.GeneratedAtUtc, catalog.ExpiresAtUtc, verifiedReleases);
    }

    private static JsonDocument ParseStrictJson(ReadOnlySpan<byte> bytes, string description)
    {
        try
        {
            var document = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 32 });
            EnsureNoDuplicateProperties(document.RootElement, description);
            return document;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"The {description} is not valid JSON.", exception);
        }
    }

    private static void EnsureNoDuplicateProperties(JsonElement element, string description)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new InvalidDataException($"The {description} contains a duplicate property.");
                EnsureNoDuplicateProperties(property.Value, description);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray()) EnsureNoDuplicateProperties(item, description);
        }
    }

    private static T Deserialize<T>(JsonElement element, string description)
    {
        try
        {
            return element.Deserialize<T>(JsonOptions) ?? throw new InvalidDataException($"The {description} is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"The {description} has an invalid structure.", exception);
        }
    }

    private static void ValidateRelease(LauncherRelease? release)
    {
        if (release is null || release.Archive is null)
            throw new InvalidDataException("The signed catalog contains an incomplete release.");
        if (string.IsNullOrWhiteSpace(release.Version) || string.IsNullOrWhiteSpace(release.MinimumInstallerVersion) ||
            string.IsNullOrWhiteSpace(release.CoreVersion) || string.IsNullOrWhiteSpace(release.ApiVersion) ||
            !SemanticVersion.TryParse(release.Version, out _) || !SemanticVersion.TryParse(release.MinimumInstallerVersion, out _) ||
            !SemanticVersion.TryParse(release.CoreVersion, out _) || !SemanticVersion.TryParse(release.ApiVersion, out _))
            throw new InvalidDataException("A release contains an invalid semantic version.");
        if (release.Channel is not ("stable" or "beta"))
            throw new InvalidDataException("A release has an unsupported channel.");
        if (release.Platform is not ("windows" or "linux" or "macos") || release.Architecture is not ("x64" or "arm64"))
            throw new InvalidDataException("A release has an unsupported platform or architecture identifier.");
        if (string.IsNullOrWhiteSpace(release.UpstreamCommit) || release.UpstreamCommit.Length is < 7 or > 64 || !release.UpstreamCommit.All(Uri.IsHexDigit))
            throw new InvalidDataException("A release has an invalid upstream commit identifier.");
        if (release.Archive.Format != "zip" || release.Archive.SizeBytes is <= 0 or > MaximumArchiveBytes ||
            string.IsNullOrWhiteSpace(release.Archive.Url) || string.IsNullOrWhiteSpace(release.Archive.Sha256))
            throw new InvalidDataException("A release archive has an unsupported format or size.");
        if (!IsSha256(release.Archive.Sha256)) throw new InvalidDataException("A release archive has an invalid SHA-256 digest.");
        if (!Uri.TryCreate(release.Archive.Url, UriKind.Absolute, out var artifactUri) || artifactUri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(artifactUri.UserInfo) || !string.IsNullOrEmpty(artifactUri.Fragment))
            throw new InvalidDataException("A release archive URL must be an absolute HTTPS URL without credentials or fragments.");
        if (release.Platform == "windows" && !SafeZipExtractor.IsSafeRelativeFilePath(release.LauncherExecutable, requireExe: true))
            throw new InvalidDataException("A Windows release has an unsafe launcher executable path.");
        if (release.Platform != "windows" && !SafeZipExtractor.IsSafeRelativeFilePath(release.LauncherExecutable))
            throw new InvalidDataException("A release has an unsafe launcher executable path.");
    }

    private static bool IsSha256(string value) => value.Length == 64 && value.All(Uri.IsHexDigit);

    private sealed record Envelope(int SchemaVersion, string KeyId, string Payload, string Signature);

    private sealed record CatalogPayload(
        int SchemaVersion,
        string ProductId,
        DateTimeOffset GeneratedAtUtc,
        DateTimeOffset ExpiresAtUtc,
        List<LauncherRelease> Releases);
}
