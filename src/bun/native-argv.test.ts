import { expect, test } from "bun:test";
import { getProcessCommandLineArgs } from "./native-argv";

test("returns this test process's real command line", () => {
  const args = getProcessCommandLineArgs();
  // The test process is `bun test <files...>` — the native command line must
  // name the executable and carry at least one further argument.
  expect(args.length).toBeGreaterThanOrEqual(2);
  expect(args[0]!.toLowerCase()).toContain("bun");
  expect(args.join(" ").toLowerCase()).toContain("test");
});
