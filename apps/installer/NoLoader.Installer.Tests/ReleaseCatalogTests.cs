using System.Security.Cryptography;
using System.Text;
using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

public sealed class ReleaseCatalogTests
{
    [Fact]
    public void AcceptsCatalogSignedByThePinnedEcdsaKey()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var release = InstallerTestFixture.CreateRelease(archive);
        var envelope = InstallerTestFixture.CreateSignedEnvelope(key, release);

        var catalog = ReleaseCatalogVerifier.Verify(envelope, key.ExportSubjectPublicKeyInfoPem());

        Assert.Equal(ReleaseCatalogVerifier.ProductId, catalog.ProductId);
        Assert.Single(catalog.Releases);
        Assert.Equal("1.2.3", catalog.Releases[0].Version);
    }

    [Fact]
    public void RejectsTamperedSignatureAndUnpinnedKey()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        using var otherKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var envelope = InstallerTestFixture.CreateSignedEnvelope(key, InstallerTestFixture.CreateRelease(InstallerTestFixture.CreateArchive()));
        var tampered = envelope.ToArray();
        tampered[^3] ^= 1;

        Assert.Throws<InvalidDataException>(() => ReleaseCatalogVerifier.Verify(tampered, key.ExportSubjectPublicKeyInfoPem()));
        Assert.Throws<InvalidDataException>(() => ReleaseCatalogVerifier.Verify(envelope, otherKey.ExportSubjectPublicKeyInfoPem()));
    }

    [Fact]
    public void RejectsDuplicateJsonPropertiesEvenWhenSignatureIsValid()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var payload = Encoding.UTF8.GetBytes("{\"schemaVersion\":1,\"schemaVersion\":1}");
        var envelope = Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            keyId = ReleaseCatalogVerifier.GetKeyId(key.ExportSubjectPublicKeyInfoPem()),
            payload = Convert.ToBase64String(payload),
            signature = Convert.ToBase64String(key.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
        }, InstallerTestFixture.JsonOptions));

        Assert.Throws<InvalidDataException>(() => ReleaseCatalogVerifier.Verify(envelope, key.ExportSubjectPublicKeyInfoPem()));
    }

    [Fact]
    public void RejectsNonHttpsArtifacts()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var invalidRelease = InstallerTestFixture.CreateRelease(InstallerTestFixture.CreateArchive()) with
        {
            Archive = InstallerTestFixture.CreateRelease(InstallerTestFixture.CreateArchive()) .Archive with { Url = "http://downloads.example.invalid/file.zip" }
        };
        var envelope = InstallerTestFixture.CreateSignedEnvelope(key, invalidRelease);
        Assert.Throws<InvalidDataException>(() => ReleaseCatalogVerifier.Verify(envelope, key.ExportSubjectPublicKeyInfoPem()));
    }

    [Fact]
    public void RejectsExpiredCatalog()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var now = DateTimeOffset.UtcNow;
        var payload = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = 1,
            productId = ReleaseCatalogVerifier.ProductId,
            generatedAtUtc = now.AddDays(-2),
            expiresAtUtc = now.AddDays(-1),
            releases = new[] { InstallerTestFixture.CreateRelease(InstallerTestFixture.CreateArchive()) }
        }, InstallerTestFixture.JsonOptions);
        var envelope = InstallerTestFixture.CreateEnvelope(key, payload);

        Assert.Throws<InvalidDataException>(() => ReleaseCatalogVerifier.Verify(envelope, key.ExportSubjectPublicKeyInfoPem(), now));
    }

    [Fact]
    public void FiltersChannelAndCompatibilityUsingNumericSemanticVersions()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var releases = new[]
        {
            InstallerTestFixture.CreateRelease(archive, "1.10.0"),
            InstallerTestFixture.CreateRelease(archive, "2.0.0-beta.2", "beta"),
            InstallerTestFixture.CreateRelease(archive, "9.0.0", "stable") with { MinimumInstallerVersion = "2.0.0" }
        };
        var catalog = ReleaseCatalogVerifier.Verify(InstallerTestFixture.CreateSignedEnvelope(key, releases), key.ExportSubjectPublicKeyInfoPem());

        Assert.Equal("1.10.0", LauncherInstallCoordinator.SelectRelease(catalog, "stable").Version);
        Assert.Equal("2.0.0-beta.2", LauncherInstallCoordinator.SelectRelease(catalog, "beta").Version);
    }
}
