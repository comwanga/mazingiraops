import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config";

const PROD_S3 = {
  S3_BUCKET: "ward-ops-evidence",
  S3_ACCESS_KEY_ID: "test-key",
  S3_SECRET_ACCESS_KEY: "test-secret",
};
const PROD_BASE = { PUBLIC_BASE_URL: "https://mazingira.example.go.ke" };

describe("loadConfig", () => {
  it("loads a valid development configuration with defaults", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      APP_ENV: "development",
    });
    expect(config.port).toBe(4000);
    expect(config.sessionHours).toBe(12);
    expect(config.storage.configured).toBe(false);
    expect(config.smtp.configured).toBe(false);
    expect(config.ai.enabled).toBe(false);
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ APP_ENV: "development" })).toThrow();
  });

  it("requires SECURE_COOKIES in production", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: "production",
        ...PROD_BASE,
        ...PROD_S3,
      }),
    ).toThrow();
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: "production",
        SECURE_COOKIES: "true",
        ...PROD_BASE,
        ...PROD_S3,
      }),
    ).not.toThrow();
  });

  it("refuses to run production without real object storage configured", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: "production",
        SECURE_COOKIES: "true",
        ...PROD_BASE,
      }),
    ).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in production/);
  });

  it("allows container-local storage in development and test", () => {
    for (const env of ["development", "test"]) {
      const config = loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: env,
      });
      expect(config.env).toBe(env);
      expect(config.storage.configured).toBe(false);
    }
  });

  it("accepts production configuration with full object storage", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      APP_ENV: "production",
      SECURE_COOKIES: "true",
      ...PROD_BASE,
      ...PROD_S3,
    });
    expect(config.storage.configured).toBe(true);
    expect(config.storage.bucket).toBe("ward-ops-evidence");
  });

  it("requires an HTTPS public web URL in production", () => {
    const base = {
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      APP_ENV: "production",
      SECURE_COOKIES: "true",
      ...PROD_S3,
    };
    expect(() => loadConfig(base)).toThrow(/PUBLIC_BASE_URL is required in production/);
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: "http://example.test" })).toThrow(
      /PUBLIC_BASE_URL must use HTTPS in production/,
    );
  });
});
