import { dlopen, FFIType, ptr, read } from "bun:ffi";

/**
 * The process's REAL command-line arguments on Windows, via
 * GetCommandLineW + CommandLineToArgvW.
 *
 * Needed because Electrobun's bootstrap (Resources/main.js) runs the
 * supervisor bundle as a Bun Worker — and a Worker's process.argv does not
 * carry the process's CLI args. The command line itself is process-global,
 * so reading it natively works from any thread. Falls back to process.argv
 * off-Windows or on FFI failure.
 */
export function getProcessCommandLineArgs(): string[] {
  if (process.platform !== "win32") return [...process.argv];
  try {
    const kernel32 = dlopen("kernel32.dll", {
      GetCommandLineW: { args: [], returns: FFIType.ptr },
    });
    const shell32 = dlopen("shell32.dll", {
      CommandLineToArgvW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    const cmdline = kernel32.symbols.GetCommandLineW();
    if (!cmdline) return [...process.argv];
    const argcBuf = new Int32Array(1);
    const argvPtr = shell32.symbols.CommandLineToArgvW(cmdline, ptr(argcBuf));
    if (!argvPtr) return [...process.argv];
    const argc = argcBuf[0]!;
    const args: string[] = [];
    for (let i = 0; i < argc; i++) {
      const strPtr = read.ptr(argvPtr, i * 8);
      if (!strPtr) continue;
      let arg = "";
      // Read UTF-16 code units until the terminator (hard cap: sane arg size).
      for (let offset = 0; offset < 65536; offset += 2) {
        const code = read.u16(strPtr as unknown as Parameters<typeof read.u16>[0], offset);
        if (code === 0) break;
        arg += String.fromCharCode(code);
      }
      args.push(arg);
    }
    return args;
  } catch {
    return [...process.argv];
  }
}
