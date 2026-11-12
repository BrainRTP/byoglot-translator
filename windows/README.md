# ByoGlot for Windows

The portable core targets .NET 11 and has no Windows API or NuGet dependencies. It embeds shared contract data and language profiles directly from the repository. Run `dotnet test windows/ByoGlot.Core.Tests` from the repository root.

The toolchain is .NET SDK 11.0.100 and C# 15. Test packages are xunit.v3.mtp-off 4.0.3, xunit.runner.visualstudio 4.0.1 and Microsoft.NET.Test.Sdk 18.12.0, verified against the official registries on 2026-11-12. The VSTest-compatible xUnit package preserves the plan's `dotnet test` command on .NET 11. Windows App SDK 2.6.5 is available; the WinUI app project, packaging and platform services belong to Task 4 of the Windows plan and are not needed to build the portable solution.

`global.json` pins the SDK when commands run inside `windows/`. CI uses this file explicitly. The workflow also supports manual runs on development branches.

Capture integration must allocate a unique `long RequestId` for every trigger, including triggers after dismissal, and carry it from `QuickEvent.Captured` or `Clipboard` into `Finished` or `FailedWith`. Use the ID from the operation that completed, so a queued result cannot replace a newer translation, even when both requests have the same source text.

`CaptureInputs.CopyAndRead` returns `ClipboardRead`; `CaptureResult.Clipboard` preserves private and oversized fallback results. After the 400 ms copy wait, call `ClipboardText.ReadChanged` with the sequence numbers from before and after copying: an unchanged sequence yields `Empty` without reading text. Mark sequence numbers from ByoGlot's Copy button and copy fallback with `DoubleCopyDetector.Ignore` before feeding their notifications to `Observe`.
