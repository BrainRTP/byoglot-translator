using Windows.Win32;

namespace ByoGlot.App.Shell;

internal static class ClipboardThread
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    public static Task<T> Run<T>(Func<T> operation, T unavailable, CancellationToken cancellation)
    {
        if (!Gate.Wait(0)) return Task.FromResult(unavailable);
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            var result = unavailable;
            var initialized = false;
            try
            {
                initialized = PInvoke.OleInitialize().Succeeded;
                if (initialized && !cancellation.IsCancellationRequested) result = operation();
            }
            catch (Exception) { }
            finally
            {
                try { if (initialized) PInvoke.OleUninitialize(); }
                catch (Exception) { }
                Gate.Release();
            }
            completion.TrySetResult(result);
        }) { IsBackground = true, Name = "ByoGlot clipboard" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }
}
