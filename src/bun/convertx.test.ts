import { expect, test } from "bun:test";
import { delimiter } from "node:path";
import { buildConvertxEnv } from "./convertx";

test("buildConvertxEnv sets the no-login desktop env and prepends converters", () => {
  const env = buildConvertxEnv({
    port: 4321,
    jwtSecret: "secret-abc",
    pathPrepend: ["C:\\conv", "C:\\conv\\imagemagick"],
    baseEnv: { Path: "C:\\Windows", NODE_ENV: "production" },
  });
  expect(env.PORT).toBe("4321");
  expect(env.JWT_SECRET).toBe("secret-abc");
  expect(env.ALLOW_UNAUTHENTICATED).toBe("true");
  expect(env.UNAUTHENTICATED_USER_SHARING).toBe("true");
  expect(env.HTTP_ALLOWED).toBe("true");
  expect(env.NODE_ENV).toBe("production");
  expect(env.Path).toBeUndefined();
  expect(env.PATH).toBe(
    `C:\\conv${delimiter}C:\\conv\\imagemagick${delimiter}C:\\Windows`,
  );
});

test("buildConvertxEnv works when the base env has no PATH at all", () => {
  const env = buildConvertxEnv({
    port: 1,
    jwtSecret: "s",
    pathPrepend: ["X:\\conv"],
    baseEnv: {},
  });
  expect(env.PATH).toBe("X:\\conv");
});
