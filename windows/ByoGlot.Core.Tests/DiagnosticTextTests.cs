using ByoGlot.Core.Capture;

namespace ByoGlot.Core.Tests;

public class DiagnosticTextTests
{
    [Fact]
    public void DiagnosticStringsDoNotIncludeTextOrKeys()
    {
        const string sensitive = "private text or key";
        var model = new ModelRef("custom", "model");
        var output = new RunnerOutput(sensitive, "en", "ru", model);
        object[] values =
        [
            new ConnectionDraft(null, ProviderPreset.Custom, "test", "http://localhost", sensitive),
            new RunnerInput(sensitive, InputLimits.Quick, sensitive, sensitive), output,
            new TextPromptInput(sensitive, sensitive, "en", "ru", sensitive, sensitive, sensitive),
            new TextRequest(sensitive, sensitive, sensitive, "en", "ru", sensitive, sensitive, model),
            new TemplateSettings(PrePrompt: sensitive), new ProfileOverride(sensitive, sensitive, 0),
            new CaptureInputs(false, sensitive, false, () => Task.FromResult<ClipboardRead>(new ClipboardRead.Empty())),
            new CaptureResult.Text(sensitive, SelectionSource.Automation), new ClipboardRead.Text(sensitive),
            new QuickState.Translating(sensitive, 1), new QuickState.Done(sensitive, output),
            new QuickEvent.Clipboard(new ClipboardRead.Text(sensitive), 1), new QuickEvent.Finished(output, 1)
        ];
        foreach (var value in values) Assert.DoesNotContain(sensitive, value.ToString());
    }
}
