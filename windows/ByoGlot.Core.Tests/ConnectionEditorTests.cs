namespace ByoGlot.Core.Tests;

public class ConnectionEditorTests
{
    private const string Models = "{\"data\":[{\"id\":\"deepseek-flash\",\"effort\":{\"supported_levels\":[\"high\"]}}]}";
    private static ConnectionDraft Draft(string url = "https://api.deepseek.com", string key = "test-key", string? id = null, ProviderPreset preset = ProviderPreset.Deepseek) => new(id, preset, "Provider", url, key);

    [Theory]
    [InlineData("broken", ProviderPreset.Deepseek, "key", false, DraftProblem.BaseUrl)]
    [InlineData("http://models.example", ProviderPreset.Custom, "key", false, DraftProblem.InsecureRemote)]
    [InlineData("https://api.deepseek.com", ProviderPreset.Deepseek, "", false, DraftProblem.ApiKey)]
    [InlineData("https://api.deepseek.com", ProviderPreset.Deepseek, "", true, null)]
    [InlineData("http://localhost:11434/v1", ProviderPreset.Custom, "", false, null)]
    [InlineData("https://api.deepseek.com", ProviderPreset.Deepseek, "key", false, null)]
    public void ValidateTable(string url, ProviderPreset preset, string key, bool stored, DraftProblem? expected)
    {
        var editor = new ConnectionEditor(new InMemorySettingsRepository(AppSettings.Initial("en")), new InMemorySecretStore(), new RecordingTransport());
        Assert.Equal(expected, editor.Validate(Draft(url, key, preset: preset), stored));
    }

    [Fact]
    public async Task SaveChecksModelsStoresKeyAndActivates()
    {
        var repository = new InMemorySettingsRepository(AppSettings.Initial("en"));
        var secrets = new InMemorySecretStore();
        var transport = new RecordingTransport(RecordingTransport.JsonResponse(Models));
        var editor = new ConnectionEditor(repository, secrets, transport);
        var connection = await editor.SaveAsync(Draft(), true, CancellationToken.None);
        var state = await repository.ReadAsync();
        Assert.Equal(connection.Id, state.ActiveConnectionId);
        Assert.Equal(connection, Assert.Single(state.Connections));
        Assert.Equal("test-key", await secrets.GetAsync(connection.Id, "https://api.deepseek.com"));
        Assert.Equal("high", connection.SelectionModel?.Variant);
        Assert.Equal("https://api.deepseek.com/models", Assert.Single(transport.Calls).Request.Url);
        Assert.Contains("https://api.deepseek.com", state.ConsentedOrigins);
        Assert.True(await editor.KeyStateAsync(connection.Id));
        Assert.Single(await editor.ModelsAsync(connection.Id, CancellationToken.None));
    }

    [Fact]
    public async Task SaveWithoutConsentFails()
    {
        var repository = new InMemorySettingsRepository(AppSettings.Initial("en"));
        var secrets = new InMemorySecretStore();
        var transport = new RecordingTransport();
        var editor = new ConnectionEditor(repository, secrets, transport);
        Assert.IsType<RunnerError.ConsentNeeded>((await Assert.ThrowsAsync<RunnerException>(() => editor.SaveAsync(Draft(), false, CancellationToken.None))).Error);
        Assert.Empty((await repository.ReadAsync()).Connections);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task FailedModelCheckLeavesSettingsAndSecretsUnchanged()
    {
        var initial = TranslationRunnerTests.Configured();
        var repository = new InMemorySettingsRepository(initial);
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("old-key", "c", "https://api.deepseek.com");
        var transport = new RecordingTransport(RecordingTransport.JsonResponse("{}", 401));
        var editor = new ConnectionEditor(repository, secrets, transport);
        await Assert.ThrowsAsync<BackendException>(() => editor.SaveAsync(Draft("https://other.example", "new-key", "c"), true, CancellationToken.None));
        Assert.Same(initial, await repository.ReadAsync());
        Assert.Equal("old-key", await secrets.GetAsync("c", "https://api.deepseek.com"));
    }

    [Fact]
    public async Task EditingToAnotherOriginDropsOldKey()
    {
        var repository = new InMemorySettingsRepository(TranslationRunnerTests.Configured());
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("old-key", "c", "https://api.deepseek.com");
        var transport = new RecordingTransport(RecordingTransport.JsonResponse(Models));
        var editor = new ConnectionEditor(repository, secrets, transport);
        await editor.SaveAsync(Draft("http://localhost:11434/v1", "", "c", ProviderPreset.Custom), false, CancellationToken.None);
        Assert.False(await secrets.HasAsync("c"));
        Assert.False(Assert.Single(transport.Calls).Request.Headers.ContainsKey("authorization"));
    }

    [Fact]
    public async Task RemoveDeletesSecretAndClearsActiveId()
    {
        var repository = new InMemorySettingsRepository(TranslationRunnerTests.Configured());
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("key", "c", "https://api.deepseek.com");
        var editor = new ConnectionEditor(repository, secrets, new RecordingTransport());
        await editor.RemoveAsync("c");
        Assert.Null((await repository.ReadAsync()).ActiveConnectionId);
        Assert.Empty((await repository.ReadAsync()).Connections);
        Assert.False(await secrets.HasAsync("c"));
    }

    [Theory]
    [InlineData("localhost", true)]
    [InlineData("127.99.3.2", true)]
    [InlineData("::1", true)]
    [InlineData("fc00::1", true)]
    [InlineData("fdff::1", true)]
    [InlineData("fe80::1", true)]
    [InlineData("febf::1", true)]
    [InlineData("fec0::1", false)]
    [InlineData("2001:db8::1", false)]
    [InlineData("10.2.3.4", true)]
    [InlineData("172.16.0.1", true)]
    [InlineData("172.31.255.255", true)]
    [InlineData("172.32.0.1", false)]
    [InlineData("192.168.1.1", true)]
    [InlineData("169.254.1.2", true)]
    [InlineData("model.local", true)]
    [InlineData("model.local.example", false)]
    [InlineData("8.8.8.8", false)]
    public void LocalHostBoundaries(string host, bool local) => Assert.Equal(local, Origins.IsLocalHost(host));

    [Fact]
    public void DraftToStringDoesNotExposeKey() => Assert.DoesNotContain("test-key", Draft().ToString());
    [Theory]
    [InlineData(" https://api.deepseek.com/v1 ", "https://api.deepseek.com/v1")]
    [InlineData("https://api.deepseek.com/v1/?a=b#fragment", "https://api.deepseek.com/v1")]
    public async Task SaveNormalizesTheEndpointBeforeCheckingAndStoring(string url, string expected)
    {
        var repository = new InMemorySettingsRepository(AppSettings.Initial("en"));
        var transport = new RecordingTransport(RecordingTransport.JsonResponse(Models));
        var editor = new ConnectionEditor(repository, new InMemorySecretStore(), transport);
        var connection = await editor.SaveAsync(Draft(url), true, CancellationToken.None);
        Assert.Equal(expected, connection.BaseUrl);
        Assert.Equal(expected + "/models", Assert.Single(transport.Calls).Request.Url);
        Assert.Equal(expected, Assert.Single((await repository.ReadAsync()).Connections).BaseUrl);
    }

    [Fact]
    public async Task ModelsRefusesConsentedPublicCleartextBeforeTransport()
    {
        var transport = new RecordingTransport();
        var editor = new ConnectionEditor(new InMemorySettingsRepository(TranslationRunnerTests.Configured("http://models.example.com/v1", ProviderPreset.Ollama)), new InMemorySecretStore(), transport);
        var error = Assert.IsType<RunnerError.Backend>((await Assert.ThrowsAsync<RunnerException>(() => editor.ModelsAsync("c", CancellationToken.None))).Error);
        Assert.Equal(ErrorKind.Offline, error.Error.Kind);
        Assert.Empty(transport.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CancelledModelChecksSurfaceAsOperationCanceled(bool save)
    {
        var initial = TranslationRunnerTests.Configured();
        var repository = new InMemorySettingsRepository(initial);
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("old-key", "c", "https://api.deepseek.com");
        using var cts = new CancellationTokenSource();
        var transport = new RecordingTransport { Handler = (_, ct) => { cts.Cancel(); throw new OperationCanceledException(ct); } };
        var editor = new ConnectionEditor(repository, secrets, transport);
        if (save) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => editor.SaveAsync(Draft(id: "c"), true, cts.Token));
        else await Assert.ThrowsAnyAsync<OperationCanceledException>(() => editor.ModelsAsync("c", cts.Token));
        Assert.Same(initial, await repository.ReadAsync());
        Assert.Equal("old-key", await secrets.GetAsync("c", "https://api.deepseek.com"));
    }

    private sealed class FailingSettings(AppSettings initial) : ISettingsRepository
    {
        public Task<AppSettings> ReadAsync() => Task.FromResult(initial);
        public Task<AppSettings> UpdateAsync(Func<AppSettings, AppSettings> change) => throw new IOException();
    }

    [Fact]
    public async Task SettingsFailureRestoresThePreviousOriginAndKey()
    {
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("old-key", "c", "https://api.deepseek.com");
        var editor = new ConnectionEditor(new FailingSettings(TranslationRunnerTests.Configured()), secrets, new RecordingTransport(RecordingTransport.JsonResponse(Models)));
        await Assert.ThrowsAsync<IOException>(() => editor.SaveAsync(Draft("https://other.example", "new-key", "c"), true, CancellationToken.None));
        Assert.Equal("old-key", await secrets.GetAsync("c", "https://api.deepseek.com"));
    }

    private sealed class FailingSecrets : ISecretStore
    {
        public Task SetAsync(string secret, string connectionId, string origin) => throw new IOException();
        public Task<string?> GetAsync(string connectionId, string origin) => Task.FromResult<string?>("old-key");
        public Task<bool> HasAsync(string connectionId) => Task.FromResult(true);
        public Task DeleteAsync(string connectionId) => throw new InvalidOperationException("Must not delete before replacement");
    }

    [Fact]
    public async Task FailedKeyReplacementDoesNotDeleteThePreviousKey()
    {
        var initial = TranslationRunnerTests.Configured();
        var repository = new InMemorySettingsRepository(initial);
        var editor = new ConnectionEditor(repository, new FailingSecrets(), new RecordingTransport(RecordingTransport.JsonResponse(Models)));
        await Assert.ThrowsAsync<IOException>(() => editor.SaveAsync(Draft("https://other.example", "new-key", "c"), true, CancellationToken.None));
        Assert.Same(initial, await repository.ReadAsync());
    }

}
