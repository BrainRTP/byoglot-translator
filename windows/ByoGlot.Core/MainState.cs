using System.Text.Json;

namespace ByoGlot.Core;

public abstract record TranslatePhase
{
    public sealed record Idle : TranslatePhase;
    public sealed record Working : TranslatePhase;
    public sealed record Done(RunnerOutput Output) : TranslatePhase;
    public sealed record Failed(RunnerError Error) : TranslatePhase;
}

public sealed class MainState(TranslationRunner runner, ISettingsRepository settings)
{
    private CancellationTokenSource? pending;
    private long generation;
    public TranslatePhase Phase { get; private set; } = new TranslatePhase.Idle();
    public event Action? Changed;

    public async Task TranslateAsync(string text, string? templateId)
    {
        Cancel();
        var request = ++generation;
        using var cancellation = new CancellationTokenSource();
        pending = cancellation;
        Set(new TranslatePhase.Working());
        try
        {
            var result = await runner.TranslateAsync(new(text, InputLimits.Editor, TemplateId: templateId), cancellation.Token);
            if (request == generation) Set(new TranslatePhase.Done(result));
        }
        catch (OperationCanceledException) { if (request == generation) Set(new TranslatePhase.Idle()); }
        catch (RunnerException error) { if (request == generation) Set(new TranslatePhase.Failed(error.Error)); }
        finally { if (request == generation) pending = null; }
    }

    public void Cancel()
    {
        generation++;
        pending?.Cancel();
        pending = null;
        Set(new TranslatePhase.Idle());
    }

    public async Task DeleteTemplateAsync(string id)
    {
        if (id == Contracts.BuiltinTemplate.Id || (await settings.ReadAsync()).Templates.Any(t => t.Id == id && t.Builtin)) throw new InvalidOperationException();
        await settings.UpdateAsync(s => s with
        {
            Templates = s.Templates.Where(t => t.Id != id).ToArray(),
            Globals = s.Globals.DefaultTemplateId == id ? s.Globals with { DefaultTemplateId = Contracts.BuiltinTemplate.Id } : s.Globals
        });
    }
    public async Task<string> ExportAsync(DateTimeOffset now) => JsonSerializer.Serialize(SettingsLogic.Export(await settings.ReadAsync(), now), CoreJson.Options);
    public Task ImportAsync(string json) => settings.UpdateAsync(s => SettingsLogic.Merge(ExportFile.Decode(json), s));
    private void Set(TranslatePhase phase) { Phase = phase; Changed?.Invoke(); }
}
