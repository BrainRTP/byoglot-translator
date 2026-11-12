namespace ByoGlot.Core.Capture;

public readonly record struct Rect(int Left, int Top, int Width, int Height);

public static class PanelPlacement
{
    public static Rect Frame(int cursorX, int cursorY, int width, int height, Rect workArea)
    {
        width = Math.Clamp(width, 0, Math.Max(0, workArea.Width - 16));
        height = Math.Clamp(height, 0, Math.Max(0, workArea.Height - 16));
        var left = Math.Clamp(cursorX + 12, workArea.Left + 8, workArea.Left + workArea.Width - 8 - width);
        var top = cursorY + 12;
        if (top + height > workArea.Top + workArea.Height - 8) top = cursorY - 12 - height;
        top = Math.Clamp(top, workArea.Top + 8, workArea.Top + workArea.Height - 8 - height);
        return new(left, top, width, height);
    }
}
