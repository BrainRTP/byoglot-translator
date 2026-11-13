namespace ByoGlot.Core.Tests;

public sealed class MainStateTests
{
    private static MainState State(RecordingTransport transport, ISettingsRepository? repository = null) => new(new(repository ?? new InMemorySettingsRepository(TranslationRunnerTests.Configured("http://localhost:11434/v1", ProviderPreset.Custom)), new InMemorySecretStore(), transport), repository ?? new InMemorySettingsRepository(TranslationRunnerTests.Configured()));

    [Fact] public async Task TranslateMovesThroughWorkingToDone()
    {
        var completion = new TaskCompletionSource<HttpResponseData>();
        var state = State(new RecordingTransport { Handler = (_, _) => completion.Task });
        var phases = new List<TranslatePhase>();
        state.Changed += () => phases.Add(state.Phase);
        var pending = state.TranslateAsync("hello", null);
        Assert.IsType<TranslatePhase.Working>(state.Phase);
        completion.SetResult(RecordingTransport.JsonResponse("{\"choices\":[{\"message\":{\"content\":\"result\"}}]}"));
        await pending;
        Assert.Equal("result", Assert.IsType<TranslatePhase.Done>(state.Phase).Output.Text);
        Assert.Contains(phases, p => p is TranslatePhase.Working);
    }
    [Fact] public async Task ASecondTranslateCancelsTheFirstAndIgnoresItsLateResult()
    {
        var first = new TaskCompletionSource<HttpResponseData>();
        CancellationToken firstToken = default;
        var calls = 0;
        var transport = new RecordingTransport { Handler = (_, ct) => { if (++calls == 1) { firstToken = ct; return first.Task; } return Task.FromResult(RecordingTransport.JsonResponse("{\"choices\":[{\"message\":{\"content\":\"second\"}}]}")); } };
        var state = State(transport);
        var pending = state.TranslateAsync("first", null);
        await state.TranslateAsync("second", null);
        Assert.True(firstToken.IsCancellationRequested);
        first.SetResult(RecordingTransport.JsonResponse("{\"choices\":[{\"message\":{\"content\":\"late\"}}]}"));
        await pending;
        Assert.Equal("second", Assert.IsType<TranslatePhase.Done>(state.Phase).Output.Text);
    }
    [Fact] public async Task CancelReturnsToIdle()
    {
        var completion = new TaskCompletionSource<HttpResponseData>();
        var state = State(new RecordingTransport { Handler = (_, _) => completion.Task });
        var pending = state.TranslateAsync("hello", null);
        state.Cancel();
        Assert.IsType<TranslatePhase.Idle>(state.Phase);
        completion.SetCanceled(TestContext.Current.CancellationToken);
        await pending;
        Assert.IsType<TranslatePhase.Idle>(state.Phase);
    }
    [Fact] public async Task TheBuiltinTemplateCannotBeDeleted() => await Assert.ThrowsAsync<InvalidOperationException>(() => State(new()).DeleteTemplateAsync(Contracts.BuiltinTemplate.Id));
    [Fact] public async Task ThePickerTargetWinsAfterChoosingATemplate()
    {
        var template = new Template("german", "German", false, new(TargetLang: "de"));
        var selection = new EditorSelection("ru");
        selection.ChooseTemplate(template);
        Assert.Equal("de", selection.TargetLang);
        selection.ChooseTarget("fr");
        var settings = TranslationRunnerTests.Configured("http://localhost:11434/v1", ProviderPreset.Custom) with { Templates = [Contracts.BuiltinTemplate, template] };
        var repository = new InMemorySettingsRepository(settings);
        var transport = new RecordingTransport { Handler = (_, _) => Task.FromResult(RecordingTransport.JsonResponse("{\"choices\":[{\"message\":{\"content\":\"bonjour\"}}]}")) };
        var state = State(transport, repository);
        await state.TranslateAsync("hello", selection.TemplateId, selection.TargetLang);
        Assert.Equal("fr", Assert.IsType<TranslatePhase.Done>(state.Phase).Output.TargetLang);
        selection.ChooseTemplate(Contracts.BuiltinTemplate);
        Assert.Equal("fr", selection.TargetLang);
    }
    [Theory]
    [InlineData(ErrorKind.Unauthorized, true)]
    [InlineData(ErrorKind.ProviderAuth, true)]
    [InlineData(ErrorKind.Offline, false)]
    public void AuthenticationErrorsOpenConnectionSettings(ErrorKind kind, bool expected)
        => Assert.Equal(expected, ErrorActions.OpensConnections(new RunnerError.Backend(new BackendException(kind))));
    [Fact] public async Task ExportThenImportPreservesPortableSettings()
    {
        var repository = new InMemorySettingsRepository(TranslationRunnerTests.Configured());
        var original = State(new(), repository);
        var freshRepository = new InMemorySettingsRepository(AppSettings.Initial("ru"));
        var fresh = State(new(), freshRepository);
        await fresh.ImportAsync(await original.ExportAsync(DateTimeOffset.UnixEpoch));
        Assert.Equal(await original.ExportAsync(DateTimeOffset.UnixEpoch), await fresh.ExportAsync(DateTimeOffset.UnixEpoch));
    }
}
