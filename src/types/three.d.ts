// The `electrobun` package's TypeScript source imports `three`, which ships no
// type declarations. Without this ambient shim, `tsc` fails with TS7016 on a
// transitive import this app never uses itself. Load-bearing — do not remove.
declare module "three";
