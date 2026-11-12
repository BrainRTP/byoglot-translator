using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ByoGlot.Core;

namespace ByoGlot.App.Services;

public sealed class DpapiSecretStore(string filePath) : ISecretStore
{
    private sealed record Entry(string Origin, string Data);
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new(StringComparer.OrdinalIgnoreCase);
    private readonly string path = Path.GetFullPath(filePath);
    private SemaphoreSlim Gate => Gates.GetOrAdd(path, _ => new(1, 1));

    public async Task SetAsync(string secret, string connectionId, string origin)
    {
        var bytes = Encoding.UTF8.GetBytes(secret);
        try
        {
            var encrypted = ProtectedData.Protect(bytes, Encoding.UTF8.GetBytes(origin), DataProtectionScope.CurrentUser);
            await ChangeAsync(values => values[connectionId] = new(origin, Convert.ToBase64String(encrypted))).ConfigureAwait(false);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public async Task<string?> GetAsync(string connectionId, string origin)
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var values = await ReadAsync().ConfigureAwait(false);
            if (!values.TryGetValue(connectionId, out var entry)) return null;
            if (entry.Origin != origin) throw new OriginMismatchException();
            try
            {
                var bytes = ProtectedData.Unprotect(Convert.FromBase64String(entry.Data), Encoding.UTF8.GetBytes(origin), DataProtectionScope.CurrentUser);
                try { return Encoding.UTF8.GetString(bytes); }
                finally { CryptographicOperations.ZeroMemory(bytes); }
            }
            catch (CryptographicException) { return null; }
            catch (FormatException) { return null; }
        }
        finally { Gate.Release(); }
    }

    public async Task<bool> HasAsync(string connectionId)
    {
        string? origin;
        await Gate.WaitAsync().ConfigureAwait(false);
        try { origin = (await ReadAsync().ConfigureAwait(false)).GetValueOrDefault(connectionId)?.Origin; }
        finally { Gate.Release(); }
        return origin is not null && await GetAsync(connectionId, origin).ConfigureAwait(false) is not null;
    }

    public Task DeleteAsync(string connectionId) => ChangeAsync(values => values.Remove(connectionId));

    private async Task ChangeAsync(Action<Dictionary<string, Entry>> change)
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var values = await ReadAsync().ConfigureAwait(false);
            change(values);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            try
            {
                await File.WriteAllTextAsync(path + ".tmp", JsonSerializer.Serialize(values, CoreJson.Options)).ConfigureAwait(false);
                File.Move(path + ".tmp", path, overwrite: true);
            }
            finally { if (File.Exists(path + ".tmp")) File.Delete(path + ".tmp"); }
        }
        finally { Gate.Release(); }
    }

    private async Task<Dictionary<string, Entry>> ReadAsync()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, Entry>>(await File.ReadAllTextAsync(path).ConfigureAwait(false), CoreJson.Options) ?? []; }
        catch (FileNotFoundException) { return []; }
        catch (DirectoryNotFoundException) { return []; }
        catch (JsonException) { return []; }
    }
}
