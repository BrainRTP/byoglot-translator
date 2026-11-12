namespace ByoGlot.App.Tests;

public sealed class DpapiSecretStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private string PathName => Path.Combine(folder, "secrets.json");
    [Fact] public async Task RoundTrip()
    {
        await new DpapiSecretStore(PathName).SetAsync("private-key", "c", "https://example.com");
        Assert.Equal("private-key", await new DpapiSecretStore(PathName).GetAsync("c", "https://example.com"));
    }
    [Fact] public async Task AnotherOriginIsRefused()
    {
        var store = new DpapiSecretStore(PathName);
        await store.SetAsync("key", "c", "https://example.com");
        await Assert.ThrowsAsync<OriginMismatchException>(() => store.GetAsync("c", "https://other.example"));
    }
    [Fact] public async Task MissingSecretIsNull() => Assert.Null(await new DpapiSecretStore(PathName).GetAsync("c", "https://example.com"));
    [Fact] public async Task DeleteRemovesIt()
    {
        var store = new DpapiSecretStore(PathName);
        await store.SetAsync("key", "c", "https://example.com");
        await store.DeleteAsync("c");
        Assert.False(await store.HasAsync("c"));
    }
    [Fact] public async Task ARecordThatCannotBeUnprotectedIsNull()
    {
        Directory.CreateDirectory(folder);
        await File.WriteAllTextAsync(PathName, "{\"c\":{\"origin\":\"https://example.com\",\"data\":\"AQIDBA==\"}}", TestContext.Current.CancellationToken);
        Assert.Null(await new DpapiSecretStore(PathName).GetAsync("c", "https://example.com"));
    }
    [Fact] public async Task TheFileHoldsNoPlainSecret()
    {
        await new DpapiSecretStore(PathName).SetAsync("private-key", "c", "https://example.com");
        Assert.DoesNotContain("private-key", await File.ReadAllTextAsync(PathName, TestContext.Current.CancellationToken));
    }
    public void Dispose() { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
}
