using ByoGlot.Core;

namespace ByoGlot.App.Services;

public static class ErrorText
{
    public static string ResourceKey(RunnerError error) => error switch
    {
        RunnerError.NoConnection => "Err_NoConnection",
        RunnerError.NoModel => "Err_NoModel",
        RunnerError.KeyMissing => "Err_KeyMissing",
        RunnerError.ConsentNeeded => "Err_ConsentNeeded",
        RunnerError.TooLong => "Err_TooLong",
        RunnerError.Empty => "Err_Empty",
        RunnerError.Backend backend => backend.Error.Kind switch
        {
            ErrorKind.Offline => "Err_Offline",
            ErrorKind.Unauthorized or ErrorKind.ProviderAuth => "Err_ProviderAuth",
            ErrorKind.RateLimit => "Err_RateLimit",
            _ => "Err_Provider"
        },
        _ => "Err_Provider"
    };
    public static string Text(RunnerError error) => error switch
    {
        RunnerError.ConsentNeeded consent => Strings.Format(ResourceKey(error), consent.Origin),
        RunnerError.TooLong length => Strings.Format(ResourceKey(error), length.Limit),
        RunnerError.Backend backend when ResourceKey(error) == "Err_ProviderAuth" => Strings.Format(ResourceKey(error), backend.Error.Status ?? 0),
        RunnerError.Backend backend when ResourceKey(error) == "Err_Provider" => Strings.Format(ResourceKey(error), backend.Error.Status?.ToString() ?? backend.Error.Kind.Wire()),
        _ => Strings.Get(ResourceKey(error))
    };
}
