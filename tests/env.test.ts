import { describe, it, expect } from "vitest";
import { parseEnv } from "../src/lib/env";

describe("env validation", () => {
  it("accepts a complete dev env", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://app:pwd@localhost:5432/app",
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() => parseEnv({
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    } as never)).toThrow();
  });

  it("rejects short NEXTAUTH_SECRET", () => {
    expect(() => parseEnv({
      DATABASE_URL: "postgres://x:y@z/db",
      NEXTAUTH_SECRET: "short",
      NEXTAUTH_URL: "http://x",
      NODE_ENV: "development",
    })).toThrow(/NEXTAUTH_SECRET/);
  });

  it("keeps the P2P flow off unless FEATURE_P2P=true", () => {
    const base = {
      DATABASE_URL: "postgres://x:y@z/db",
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://x",
      NODE_ENV: "development",
    } as const;
    expect(parseEnv(base).FEATURE_P2P).toBe(false);
    expect(parseEnv({ ...base, FEATURE_P2P: "" }).FEATURE_P2P).toBe(false);
    expect(parseEnv({ ...base, FEATURE_P2P: "false" }).FEATURE_P2P).toBe(false);
    expect(parseEnv({ ...base, FEATURE_P2P: "true" }).FEATURE_P2P).toBe(true);
    expect(() => parseEnv({ ...base, FEATURE_P2P: "yes" })).toThrow(/FEATURE_P2P/);
  });
});
