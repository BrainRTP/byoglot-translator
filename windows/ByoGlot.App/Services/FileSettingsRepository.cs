using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using ByoGlot.Core;

namespace ByoGlot.App.Services;

public sealed class FileSettingsRepository(string filePath) : ISettingsRepository
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new(StringComparer.OrdinalIgnoreCase);
    private readonly string path = Path.GetFullPath(filePath);
    private SemaphoreSlim Gate => Gates.GetOrAdd(path, _ => new(1, 1));

    public async Task<AppSettings> ReadAsync()
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try { return await ReadFileAsync().ConfigureAwait(false); }
        finally { Gate.Release(); }
    }

    public async Task<AppSettings> UpdateAsync(Func<AppSettings, AppSettings> change)
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var next = change(await ReadFileAsync().ConfigureAwait(false));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            try
            {
                await File.WriteAllTextAsync(path + ".tmp", JsonSerializer.Serialize(next, CoreJson.Options)).ConfigureAwait(false);
                File.Move(path + ".tmp", path, overwrite: true);
            }
            finally { if (File.Exists(path + ".tmp")) File.Delete(path + ".tmp"); }
            return next;
        }
        finally { Gate.Release(); }
    }

    private async Task<AppSettings> ReadFileAsync()
    {
        try
        {
            var value = JsonSerializer.Deserialize<AppSettings>(await File.ReadAllTextAsync(path).ConfigureAwait(false), CoreJson.Options);
            if (value is { Globals: not null, Templates: not null, Connections: not null, ConsentedOrigins: not null, ProfileOverrides: not null, SiteRules: not null }) return value;
        }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
        catch (JsonException) { }
        return AppSettings.Initial(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
    }
}
