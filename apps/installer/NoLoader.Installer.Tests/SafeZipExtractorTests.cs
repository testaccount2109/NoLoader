using System.IO.Compression;
using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

public sealed class SafeZipExtractorTests
{
    [Fact]
    public void ExtractsNormalFilesInsideTheDestination()
    {
        using var archive = CreateArchive(("bin/Noloader.exe", [1, 2, 3]), ("resources/app.json", [4, 5]));
        var destination = TemporaryDirectory();
        try
        {
            var files = SafeZipExtractor.Extract(archive, destination, TestContext.Current.CancellationToken);
            Assert.Contains("bin/Noloader.exe", files);
            Assert.Equal([1, 2, 3], File.ReadAllBytes(Path.Combine(destination, "bin", "Noloader.exe")));
            Assert.Equal([4, 5], File.ReadAllBytes(Path.Combine(destination, "resources", "app.json")));
        }
        finally { Directory.Delete(destination, recursive: true); }
    }

    [Theory]
    [InlineData("../outside.txt")]
    [InlineData("C:/outside.txt")]
    [InlineData("folder/../../outside.txt")]
    [InlineData("folder\\outside.txt")]
    [InlineData("CON.txt")]
    [InlineData("bad-name. ")]
    [InlineData("NUL")]
    [InlineData(".noloader-install.json")]
    public void RejectsUnsafeArchivePaths(string entryName)
    {
        using var archive = CreateArchive((entryName, [1]));
        var destination = TemporaryDirectory();
        try { Assert.Throws<InvalidDataException>(() => SafeZipExtractor.Extract(archive, destination, TestContext.Current.CancellationToken)); }
        finally { Directory.Delete(destination, recursive: true); }
    }

    [Fact]
    public void RejectsCaseInsensitiveFileCollisions()
    {
        using var archive = CreateArchive(("Bin/NoLoader.exe", [1]), ("bin/noloader.exe", [2]));
        var destination = TemporaryDirectory();
        try { Assert.Throws<InvalidDataException>(() => SafeZipExtractor.Extract(archive, destination, TestContext.Current.CancellationToken)); }
        finally { Directory.Delete(destination, recursive: true); }
    }

    [Fact]
    public void RejectsSymbolicLinkEntries()
    {
        using var archive = new MemoryStream();
        using (var zip = new ZipArchive(archive, ZipArchiveMode.Create, leaveOpen: true))
        {
            var link = zip.CreateEntry("link");
            link.ExternalAttributes = unchecked((short)0xA000) << 16;
            using var content = link.Open();
            content.WriteByte(0);
        }
        archive.Position = 0;
        var destination = TemporaryDirectory();
        try { Assert.Throws<InvalidDataException>(() => SafeZipExtractor.Extract(archive, destination, TestContext.Current.CancellationToken)); }
        finally { Directory.Delete(destination, recursive: true); }
    }

    private static MemoryStream CreateArchive(params (string Name, byte[] Content)[] files)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, bytes) in files)
            {
                using var output = archive.CreateEntry(name).Open();
                output.Write(bytes);
            }
        }
        stream.Position = 0;
        return stream;
    }

    private static string TemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "noloader-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }
}
