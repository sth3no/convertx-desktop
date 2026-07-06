import { createHash } from "node:crypto";

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256OfFile(path: string): Promise<string> {
  return sha256OfBytes(new Uint8Array(await Bun.file(path).arrayBuffer()));
}
