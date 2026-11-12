# ByoGlot for Windows

The portable core targets .NET 11 and has no Windows API or NuGet dependencies. It embeds shared contract data and language profiles directly from the repository. Run `dotnet test windows/ByoGlot.Core.Tests` from the repository root.

The toolchain is .NET SDK 11.0.100 and C# 15. Test packages are xunit.v3.mtp-off 4.0.3, xunit.runner.visualstudio 4.0.1 and Microsoft.NET.Test.Sdk 18.12.0, verified against the official registries on 2026-11-12. The VSTest-compatible xUnit package preserves the plan's `dotnet test` command on .NET 11. Windows App SDK 2.6.5 is available; the WinUI app project, packaging and platform services belong to Task 4 of the Windows plan and are not needed to build the portable solution.

`global.json` pins the SDK when commands run inside `windows/`. CI uses this file explicitly. The workflow also supports manual runs on development branches.
