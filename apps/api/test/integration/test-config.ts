import type { AppConfig } from "../../dist/config/config";

export function testConfig(databaseUrl: string): AppConfig {
  return {
    env: "test",
    port: 0,
    databaseUrl,
    redis: { configured: false, connectTimeoutMs: 2_000, dashboardTtlSeconds: 120 },
    publicBaseUrl: "http://localhost:3000",
    sessionHours: 12,
    secureCookies: false,
    storage: {
      region: "us-east-1",
      forcePathStyle: false,
      configured: false,
    },
    ownerSetupToken: "test-setup-token",
    smtp: {
      port: 587,
      from: "mazingira-ops@example.go.ke",
      configured: false,
    },
    ai: {
      enabled: false,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.1-8b-instant",
    },
    maxUploadBytes: 5 * 1024 * 1024,
    documentStoreDir: "data/documents",
  };
}
