namespace ByoGlot.App.Tests;

public sealed class FileSettingsRepositoryTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    private string PathName => Path.Combine(folder, "settings.json");
    [Fact] public async Task CreatesInitialSettings() => Assert.Equal(1, (await new FileSettingsRepository(PathName).ReadAsync()).SchemaVersion);
    [Fact] public async Task UpdatePersistsAcrossInstances()
    {
        await new FileSettingsRepository(PathName).UpdateAsync(s => s with { ActiveConnectionId = "a" });
        Assert.Equal("a", (await new FileSettingsRepository(PathName).ReadAsync()).ActiveConnectionId);
    }
    [Fact] public async Task ACorruptFileIsReplaced()
    {
        Directory.CreateDirectory(folder);
        await File.WriteAllTextAsync(PathName, "{", TestContext.Current.CancellationToken);
        var repository = new FileSettingsRepository(PathName);
        Assert.Single((await repository.ReadAsync()).Templates);
        await repository.UpdateAsync(s => s with { ActiveConnectionId = "b" });
        Assert.Equal("b", (await new FileSettingsRepository(PathName).ReadAsync()).ActiveConnectionId);
    }
    [Fact] public async Task TwoRepositoriesOnOneFileDoNotLoseUpdates()
    {
        var a = new FileSettingsRepository(PathName);
        var b = new FileSettingsRepository(PathName);
        await Task.WhenAll(Enumerable.Range(0, 40).Select(i => (i % 2 == 0 ? a : b).UpdateAsync(s => s with { SchemaVersion = s.SchemaVersion + 1 })));
        Assert.Equal(41, (await a.ReadAsync()).SchemaVersion);
    }
    public void Dispose() { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
}
