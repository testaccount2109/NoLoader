using System.Net;
using System.Security.Cryptography;
using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

public sealed class SignedReleaseProviderTests
{
    [Fact]
    public async Task RejectsRedirectsFromHttpsToHttp()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var release = InstallerTestFixture.CreateRelease(archive);
        var catalogBytes = InstallerTestFixture.CreateSignedEnvelope(key, release);
        var handler = new InstallerTestFixture.DelegateHttpHandler((request, _) => Task.FromResult(
            request.RequestUri!.AbsolutePath == "/catalog"
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(catalogBytes) }
                : new HttpResponseMessage(HttpStatusCode.Redirect) { Headers = { Location = new Uri("http://downloads.example.invalid/archive.zip") } }));
        using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        using var provider = new SignedReleaseProvider(new Uri("https://downloads.example.invalid/catalog"), key.ExportSubjectPublicKeyInfoPem(), client);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var destination = Path.Combine(InstallerTestFixture.TemporaryDirectory(), "download.zip");

        try
        {
            await Assert.ThrowsAsync<NoLoaderInstallException>(() => provider.DownloadAndVerifyAsync(
                catalog.Releases[0], destination, cancellationToken: TestContext.Current.CancellationToken));
            Assert.False(File.Exists(destination));
        }
        finally { Directory.Delete(Path.GetDirectoryName(destination)!, recursive: true); }
    }

    [Fact]
    public async Task DoesNotRemoveAFileThatWasAlreadyAtTheDownloadDestination()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var release = InstallerTestFixture.CreateRelease(archive);
        using var provider = InstallerTestFixture.CreateProvider(key, [(release, archive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var destinationDirectory = InstallerTestFixture.TemporaryDirectory();
        var destination = Path.Combine(destinationDirectory, "existing.zip");
        await File.WriteAllTextAsync(destination, "keep", TestContext.Current.CancellationToken);

        try
        {
            await Assert.ThrowsAsync<IOException>(() => provider.DownloadAndVerifyAsync(
                catalog.Releases[0], destination, cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal("keep", await File.ReadAllTextAsync(destination, TestContext.Current.CancellationToken));
        }
        finally { Directory.Delete(destinationDirectory, recursive: true); }
    }
}
