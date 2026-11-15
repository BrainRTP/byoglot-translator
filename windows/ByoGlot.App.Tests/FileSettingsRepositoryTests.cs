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
    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("{}")]
    public async Task ACorruptFileIsPreservedAndBlocksLaterWrites(string content)
    {
        Directory.CreateDirectory(folder);
        await File.WriteAllTextAsync(PathName, content, TestContext.Current.CancellationToken);
        var repository = new FileSettingsRepository(PathName);
        await Assert.ThrowsAsync<InvalidDataException>(() => repository.ReadAsync());
        await Assert.ThrowsAsync<InvalidDataException>(() => repository.UpdateAsync(s => s with { ActiveConnectionId = "b" }));
        await Assert.ThrowsAsync<InvalidDataException>(() => new FileSettingsRepository(PathName).UpdateAsync(s => s));
        Assert.Equal(content, await File.ReadAllTextAsync(PathName + ".bad", TestContext.Current.CancellationToken));
        Assert.False(File.Exists(PathName));
        Assert.False(File.Exists(PathName + ".tmp"));
    }
    [Fact] public async Task AnUnsupportedSchemaIsNeverOverwritten()
    {
        Directory.CreateDirectory(folder);
        var content = System.Text.Json.JsonSerializer.Serialize(AppSettings.Initial("en") with { SchemaVersion = 2 }, CoreJson.Options);
        await File.WriteAllTextAsync(PathName, content, TestContext.Current.CancellationToken);
        var repository = new FileSettingsRepository(PathName);
        await Assert.ThrowsAsync<InvalidDataException>(() => repository.ReadAsync());
        await Assert.ThrowsAsync<InvalidDataException>(() => repository.UpdateAsync(s => s));
        Assert.Equal(content, await File.ReadAllTextAsync(PathName, TestContext.Current.CancellationToken));
        Assert.False(File.Exists(PathName + ".bad"));
    }
    [Fact] public async Task TwoRepositoriesOnOneFileDoNotLoseUpdates()
    {
        var a = new FileSettingsRepository(PathName);
        var b = new FileSettingsRepository(PathName);
        await Task.WhenAll(Enumerable.Range(0, 40).Select(i => (i % 2 == 0 ? a : b).UpdateAsync(s => s with { SiteRules = [.. s.SiteRules, new(i.ToString(System.Globalization.CultureInfo.InvariantCulture), "example.com", Contracts.BuiltinTemplate.Id)] })));
        Assert.Equal(40, (await a.ReadAsync()).SiteRules.Count);
    }
    public void Dispose() { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
}
