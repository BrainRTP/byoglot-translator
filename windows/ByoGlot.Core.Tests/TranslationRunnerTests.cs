using System.Text.Json.Nodes;

namespace ByoGlot.Core.Tests;

public class TranslationRunnerTests
{
    internal static AppSettings Configured(string url = "https://api.deepseek.com", ProviderPreset preset = ProviderPreset.Deepseek, bool consent = true)
    {
        var model = new ModelRef(preset.ToString().ToLowerInvariant(), "deepseek-flash", "high", "c");
        return AppSettings.Initial("ru") with { Connections = [new("c", preset, "Provider", url, model, model)], ActiveConnectionId = "c", ConsentedOrigins = consent ? [Origins.OriginOf(url)!] : [] };
    }

    private static async Task<TranslationRunner> Runner(AppSettings state, RecordingTransport transport, string origin = "https://api.deepseek.com")
    {
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("test-key", "c", origin);
        return new(new InMemorySettingsRepository(state), secrets, transport);
    }

    [Fact]
    public async Task TranslatesAndSendsBearerKey()
    {
        var transport = new RecordingTransport();
        var runner = await Runner(Configured(), transport);
        var output = await runner.TranslateAsync(new(" hello ", InputLimits.Editor), CancellationToken.None);
        Assert.Equal("translated", output.Text);
        Assert.Equal("ru", output.TargetLang);
        Assert.Equal("Bearer test-key", Assert.Single(transport.Calls).Request.Headers["authorization"]);
        await runner.TranslateAsync(new(" hello ", InputLimits.Editor), CancellationToken.None);
        Assert.Single(transport.Calls);
    }

    [Fact]
    public async Task NoConnection()
    {
        var runner = await Runner(AppSettings.Initial("en"), new());
        Assert.IsType<RunnerError.NoConnection>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hello", 5000), CancellationToken.None))).Error);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("\uFEFF", false)]
    [InlineData(" \n ", false)]
    [InlineData("123456", true)]
    public async Task InputErrorsPrecedeNetwork(string text, bool tooLong)
    {
        var transport = new RecordingTransport();
        var runner = await Runner(AppSettings.Initial("en"), transport);
        var error = (await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new(text, 5), CancellationToken.None))).Error;
        if (tooLong) Assert.Equal(new RunnerError.TooLong(5), error);
        else Assert.IsType<RunnerError.Empty>(error);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task RemoteOriginNeedsConsent()
    {
        var transport = new RecordingTransport();
        var runner = await Runner(Configured(consent: false), transport);
        Assert.Equal(new RunnerError.ConsentNeeded("https://api.deepseek.com"), (await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hi", 5000), CancellationToken.None))).Error);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task LocalNetworkNeedsNoConsentWithAStoredCustomKey()
    {
        var transport = new RecordingTransport();
        var secrets = new InMemorySecretStore();
        await secrets.SetAsync("lan-key", "c", "http://192.168.1.5:11434");
        var runner = new TranslationRunner(new InMemorySettingsRepository(Configured("http://192.168.1.5:11434/v1", ProviderPreset.Custom, false)), secrets, transport);
        Assert.Equal("translated", (await runner.TranslateAsync(new("hi", 5000), CancellationToken.None)).Text);
        Assert.Equal("Bearer lan-key", Assert.Single(transport.Calls).Request.Headers["authorization"]);
    }

    [Fact]
    public async Task ChangedOriginGivesKeyMissing()
    {
        var transport = new RecordingTransport();
        var runner = await Runner(Configured("https://other.example"), transport);
        Assert.IsType<RunnerError.KeyMissing>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hi", 5000), CancellationToken.None))).Error);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task MissingModelAndMissingRequiredKeyAreReported()
    {
        var state = Configured();
        var repository = new InMemorySettingsRepository(state with { Connections = [state.Connections[0] with { SelectionModel = null }] });
        var transport = new RecordingTransport();
        var runner = new TranslationRunner(repository, new InMemorySecretStore(), transport);
        Assert.IsType<RunnerError.NoModel>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hi", 5000), CancellationToken.None))).Error);
        await repository.UpdateAsync(_ => state);
        Assert.IsType<RunnerError.KeyMissing>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hi", 5000), CancellationToken.None))).Error);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task RateLimitIsBackendError()
    {
        var runner = await Runner(Configured(), new(RecordingTransport.JsonResponse("{}", 429)));
        var error = Assert.IsType<RunnerError.Backend>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("hi", 5000), CancellationToken.None))).Error);
        Assert.Equal(ErrorKind.RateLimit, error.Error.Kind);
    }

    [Fact]
    public async Task TemplateOverridesLanguageAndInstructions()
    {
        var state = Configured();
        var template = new Template("study", "Study", false, new(PrePrompt: "Use simple words.", TargetLang: "de"));
        state = state with { Templates = [.. state.Templates, template] };
        var transport = new RecordingTransport();
        var runner = await Runner(state, transport);
        var output = await runner.TranslateAsync(new("hello", 5000, TemplateId: "study"), CancellationToken.None);
        Assert.Equal("de", output.TargetLang);
        var body = JsonNode.Parse(Assert.Single(transport.Calls).Request.Body!)!;
        var prompt = body["messages"]![0]!["content"]!.GetValue<string>();
        Assert.Contains("to German.", prompt);
        Assert.Contains("USER INSTRUCTIONS:\nUse simple words.", prompt);
        Assert.Equal("fr", (await runner.TranslateAsync(new("hello", 5000, TemplateId: "study", TargetLang: "fr"), CancellationToken.None)).TargetLang);
    }
    [Fact]
    public async Task ConsentedPublicCleartextStillFailsBeforeTransport()
    {
        var transport = new RecordingTransport();
        var runner = await Runner(Configured("http://models.example.com/v1", ProviderPreset.Ollama), transport);
        var error = Assert.IsType<RunnerError.Backend>((await Assert.ThrowsAsync<RunnerException>(() => runner.TranslateAsync(new("private text", 5000), CancellationToken.None))).Error);
        Assert.Equal(ErrorKind.Offline, error.Error.Kind);
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task NextLineControlIsTextRatherThanJavaScriptWhitespace()
    {
        var transport = new RecordingTransport();
        var runner = await Runner(Configured(), transport);
        await runner.TranslateAsync(new("\u0085", 5000), CancellationToken.None);
        var prompt = JsonNode.Parse(Assert.Single(transport.Calls).Request.Body!)!["messages"]![0]!["content"]!.GetValue<string>();
        Assert.EndsWith("TEXT:\n\u0085", prompt);
    }

}
