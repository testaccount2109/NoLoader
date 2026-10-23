using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

internal static class InstallerTestFixture
{
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static LauncherRelease CreateRelease(
        byte[] archiveBytes,
        string version = "1.2.3",
        string channel = "stable",
        string launcherExecutable = "bin/NoLoader.exe") => new(
        version,
        channel,
        new string('a', 40),
        "1.0.0",
        "1.0.0",
        "windows",
        "x64",
        "1.0.0",
        launcherExecutable,
        new ReleaseArchive("zip", $"https://downloads.example.invalid/{version}.zip", Convert.ToHexString(SHA256.HashData(archiveBytes)), archiveBytes.Length));

    public static byte[] CreateSignedEnvelope(ECDsa key, params LauncherRelease[] releases)
    {
        var now = DateTimeOffset.UtcNow;
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = 1,
            productId = ReleaseCatalogVerifier.ProductId,
            generatedAtUtc = now,
            expiresAtUtc = now.AddDays(1),
            releases
        }, JsonOptions);
        return CreateEnvelope(key, payload);
    }

    public static byte[] CreateEnvelope(ECDsa key, byte[] payload)
    {
        var envelope = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = 1,
            keyId = ReleaseCatalogVerifier.GetKeyId(key.ExportSubjectPublicKeyInfoPem()),
            payload = Convert.ToBase64String(payload),
            signature = Convert.ToBase64String(key.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
        }, JsonOptions);
        return envelope;
    }

    public static byte[] CreateArchive(string executableText = "launcher", string launcherExecutable = "bin/NoLoader.exe")
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using (var executable = archive.CreateEntry(launcherExecutable).Open())
            {
                var bytes = System.Text.Encoding.UTF8.GetBytes(executableText);
                executable.Write(bytes);
            }
            using (var resource = archive.CreateEntry("assets/config.json").Open())
            {
                var bytes = System.Text.Encoding.UTF8.GetBytes("{\"config\":true}");
                resource.Write(bytes);
            }
        }
        return stream.ToArray();
    }

    public static SignedReleaseProvider CreateProvider(
        ECDsa key,
        IReadOnlyList<(LauncherRelease Release, byte[] Archive)> releases,
        IReadOnlyDictionary<string, byte[]>? archiveOverrides = null)
    {
        var envelope = CreateSignedEnvelope(key, releases.Select(pair => pair.Release).ToArray());
        var archives = releases.ToDictionary(
            pair => new Uri(pair.Release.Archive.Url).AbsolutePath,
            pair => archiveOverrides is not null && archiveOverrides.TryGetValue(new Uri(pair.Release.Archive.Url).AbsolutePath, out var replacement) ? replacement : pair.Archive,
            StringComparer.Ordinal);
        var handler = new DelegateHttpHandler((request, _) =>
        {
            var uri = request.RequestUri!;
            if (uri.AbsolutePath == "/catalog")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(envelope) });
            if (archives.TryGetValue(uri.AbsolutePath, out var archive))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(archive) });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        });
        var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        return new SignedReleaseProvider(new Uri("https://downloads.example.invalid/catalog"), key.ExportSubjectPublicKeyInfoPem(), client);
    }

    public static string TemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "noloader-installer-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    internal sealed class DelegateHttpHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken);
    }
}
