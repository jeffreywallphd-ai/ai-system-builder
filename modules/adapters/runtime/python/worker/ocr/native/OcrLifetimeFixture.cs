// Synthetic qualification fixture only. Never built or selected as a product resource.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class OcrLifetimeFixture
{
    private static int Main()
    {
        var input = Console.OpenStandardInput();
        int mode = input.ReadByte();
        if (mode == 'B') return 23; // Early receiver exit while the parent still writes.
        byte[] buffer = new byte[65536];
        while (input.Read(buffer, 0, buffer.Length) > 0) { }
        if (mode == 'N') return 23;
        if (mode == 'H') { Thread.Sleep(300000); return 97; }
        if (mode == 'M')
        {
            var blocks = new List<byte[]>();
            try { while (true) { var block = new byte[16 * 1024 * 1024]; block[0] = 1; blocks.Add(block); } }
            catch (OutOfMemoryException) { return 0; } // Limit notification must still deny success.
        }
        if (mode == 'C')
        {
            try { Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName)
                { UseShellExecute = false, CreateNoWindow = true }); }
            catch (Exception) { return 0; } // Active-member limit notification must deny success.
            return 99;
        }
        if (mode == 'V' && (Environment.GetEnvironmentVariable("ASB_OCR_TEST_SECRET") != null ||
                            Environment.GetEnvironmentVariable("HF_TOKEN") != null)) return 41;
        if (mode == 'E' || mode == 'O')
        {
            var stream = mode == 'E' ? Console.OpenStandardError() : Console.OpenStandardOutput();
            for (int i = 0; i < 40; i++) stream.Write(buffer, 0, buffer.Length);
            Thread.Sleep(300000); return 97;
        }
        if (mode == 'X') Console.Error.Write("synthetic-private-diagnostic");
        Console.OpenStandardOutput().Write(new byte[] { 2, 0, 0, 0, 79, 75 }, 0, 6);
        return 0;
    }
}
