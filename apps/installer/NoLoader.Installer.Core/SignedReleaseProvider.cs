using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace NoLoader.Installer.Core;

public sealed class SignedReleaseProvider : IDisposable
{
    private const int MaximumRedirects = 5;
    private readonly HttpClient _client;
    private readonly bool _ownsClient;
    private readonly Uri _catalogUri;
    private readonly string _trustedPublicKeyPem;

    public SignedReleaseProvider(Uri catalogUri, string trustedPublicKeyPem, HttpClient? client = null)
    {
        if (catalogUri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(catalogUri.UserInfo) || !string.IsNullOrEmpty(catalogUri.Fragment))
            throw new ArgumentException("The signed catalog URL must use HTTPS and contain no credentials or fragment.", nameof(catalogUri));
        ArgumentException.ThrowIfNullOrWhiteSpace(trustedPublicKeyPem);
        _catalogUri = catalogUri;
        _trustedPublicKeyPem = trustedPublicKeyPem;
        _client = client ?? new HttpClient(new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(20)
        });
        _ownsClient = client is null;
        if (_ownsClient) _client.Timeout = Timeout.InfiniteTimeSpan;
    }

    public async Task<ReleaseCatalog> GetCatalogAsync(CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            using var response = await SendWithoutRedirectsAsync(_catalogUri, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) throw new NoLoaderInstallException($"The release catalog request failed with HTTP {(int)response.StatusCode}.");
            if (response.Content.Headers.ContentLength is > ReleaseCatalogVerifier.MaximumCatalogBytes)
                throw new NoLoaderInstallException("The signed release catalog exceeds the 4 MiB size limit.");
            var bytes = await ReadBoundedAsync(response.Content, ReleaseCatalogVerifier.MaximumCatalogBytes, timeout.Token).ConfigureAwait(false);
            return ReleaseCatalogVerifier.Verify(bytes, _trustedPublicKeyPem);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new NoLoaderInstallException("The release catalog request timed out. Check your connection and retry.", exception);
        }
    }

    public async Task DownloadAndVerifyAsync(
        VerifiedLauncherRelease release,
        string destinationPath,
        IProgress<DownloadProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(release.Archive.Url, UriKind.Absolute, out var initialUri) || initialUri.Scheme != Uri.UriSchemeHttps)
            throw new NoLoaderInstallException("The release artifact URL is not a valid HTTPS URL.");
        if (release.Archive.SizeBytes is <= 0 or > ReleaseCatalogVerifier.MaximumArchiveBytes)
            throw new NoLoaderInstallException("The signed release artifact size is outside the supported limit.");

        var currentUri = initialUri;
        using var visited = new RedirectTracker();
        visited.Add(currentUri);
        HttpResponseMessage response;
        for (var redirects = 0; ; redirects++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            if (!IsRedirect(response.StatusCode)) break;
            var location = response.Headers.Location;
            response.Dispose();
            if (redirects >= MaximumRedirects || location is null)
                throw new NoLoaderInstallException("The release artifact redirected too many times or provided no redirect target.");
            var nextUri = location.IsAbsoluteUri ? location : new Uri(currentUri, location);
            if (nextUri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(nextUri.UserInfo) || !string.IsNullOrEmpty(nextUri.Fragment))
                throw new NoLoaderInstallException("The release artifact redirect did not remain on a safe HTTPS URL.");
            if (!visited.Add(nextUri)) throw new NoLoaderInstallException("The release artifact redirect looped.");
            currentUri = nextUri;
        }

        var completed = false;
        var createdFile = false;
        try
        {
            using (response)
            {
                if (!response.IsSuccessStatusCode)
                    throw new NoLoaderInstallException($"The launcher download failed with HTTP {(int)response.StatusCode}.");
                if (response.Content.Headers.ContentLength is long contentLength && contentLength != release.Archive.SizeBytes)
                    throw new NoLoaderInstallException("The downloaded archive size does not match the signed release metadata.");

                var fullPath = Path.GetFullPath(destinationPath);
                Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
                using var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
                using var output = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                createdFile = true;
                using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var buffer = new byte[128 * 1024];
                long received = 0;
                while (true)
                {
                    using var idleTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    idleTimeout.CancelAfter(TimeSpan.FromSeconds(60));
                    int count;
                    try { count = await input.ReadAsync(buffer, idleTimeout.Token).ConfigureAwait(false); }
                    catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
                    {
                        throw new NoLoaderInstallException("The launcher download stopped receiving data for 60 seconds. Check your connection and retry.", exception);
                    }
                    if (count == 0) break;
                    received = checked(received + count);
                    if (received > release.Archive.SizeBytes || received > ReleaseCatalogVerifier.MaximumArchiveBytes)
                        throw new NoLoaderInstallException("The downloaded archive is larger than the signed size limit.");
                    digest.AppendData(buffer, 0, count);
                    await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
                    progress?.Report(new DownloadProgress(received, release.Archive.SizeBytes));
                }
                await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                output.Flush(flushToDisk: true);

                if (received != release.Archive.SizeBytes)
                    throw new NoLoaderInstallException("The downloaded archive ended before the signed size was reached.");
                var expected = Convert.FromHexString(release.Archive.Sha256);
                var actual = digest.GetHashAndReset();
                if (!CryptographicOperations.FixedTimeEquals(actual, expected))
                    throw new NoLoaderInstallException("The launcher archive failed its signed SHA-256 integrity check.");
                completed = true;
            }
        }
        finally
        {
            if (!completed && createdFile) TryDeletePartialFile(destinationPath);
        }
    }

    private async Task<HttpResponseMessage> SendWithoutRedirectsAsync(Uri uri, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (IsRedirect(response.StatusCode))
        {
            response.Dispose();
            throw new NoLoaderInstallException("The signed release catalog redirected; configure its final HTTPS URL directly.");
        }
        return response;
    }

    private static async Task<byte[]> ReadBoundedAsync(HttpContent content, int limit, CancellationToken cancellationToken)
    {
        using var stream = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var memory = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var count = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0) break;
            if (memory.Length + count > limit) throw new NoLoaderInstallException("The signed release catalog exceeds the 4 MiB size limit.");
            memory.Write(buffer, 0, count);
        }
        return memory.ToArray();
    }

    private static bool IsRedirect(HttpStatusCode code) => code is HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

    private static void TryDeletePartialFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public void Dispose()
    {
        if (_ownsClient) _client.Dispose();
    }

    private sealed class RedirectTracker : IDisposable
    {
        private readonly HashSet<string> _visited = new(StringComparer.Ordinal);
        public bool Add(Uri uri) => _visited.Add(uri.AbsoluteUri);
        public void Dispose() => _visited.Clear();
    }
}
