import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    PUBLIC_BASE_URL: z.string().url().optional(),
    CORS_ORIGINS: z.string().optional(),
    SESSION_HOURS: z.coerce.number().int().positive().default(12),
    SECURE_COOKIES: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.string().optional(),
    OWNER_SETUP_TOKEN: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USERNAME: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default("mazingira-ops@example.go.ke"),
    AI_ENABLED: z.string().optional(),
    AI_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("llama-3.1-8b-instant"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    DOCUMENT_STORE_DIR: z.string().default("data/objects"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "production") {
      if (!env.PUBLIC_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PUBLIC_BASE_URL is required in production so generated check-in links use the public web application",
          path: ["PUBLIC_BASE_URL"],
        });
      } else if (!env.PUBLIC_BASE_URL.startsWith("https://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PUBLIC_BASE_URL must use HTTPS in production",
          path: ["PUBLIC_BASE_URL"],
        });
      }
      if (env.SECURE_COOKIES === undefined || env.SECURE_COOKIES !== "true") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SECURE_COOKIES must be 'true' in production",
          path: ["SECURE_COOKIES"],
        });
      }
      // Container-local storage is only acceptable for development/test.
      // In production, silently falling back to the local filesystem would
      // lose evidence on redeploy, so require real object storage instead.
      if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in production so evidence is not silently stored on the container filesystem",
          path: ["S3_BUCKET"],
        });
      }
    }
  });

export type Env = z.input<typeof envSchema>;

export interface AppConfig {
  env: string;
  port: number;
  databaseUrl: string;
  publicBaseUrl: string;
  corsOrigins: string[];
  sessionHours: number;
  secureCookies: boolean;
  storage: {
    endpoint?: string;
    region: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
    configured: boolean;
  };
  ownerSetupToken?: string;
  smtp: {
    host?: string;
    port: number;
    username?: string;
    password?: string;
    from: string;
    configured: boolean;
  };
  ai: { enabled: boolean; baseUrl: string; apiKey?: string; model: string };
  maxUploadBytes: number;
  documentStoreDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  const secureCookies = parsed.SECURE_COOKIES === "true" || parsed.SECURE_COOKIES === "1";
  const s3Configured = Boolean(
    parsed.S3_BUCKET && parsed.S3_ACCESS_KEY_ID && parsed.S3_SECRET_ACCESS_KEY,
  );
  const smtpConfigured = Boolean(parsed.SMTP_HOST);

  return {
    env: parsed.APP_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    publicBaseUrl: parsed.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000",
    corsOrigins: (parsed.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionHours: parsed.SESSION_HOURS,
    secureCookies,
    storage: {
      endpoint: parsed.S3_ENDPOINT,
      region: parsed.S3_REGION,
      bucket: parsed.S3_BUCKET,
      accessKeyId: parsed.S3_ACCESS_KEY_ID,
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
      forcePathStyle: parsed.S3_FORCE_PATH_STYLE === "true" || parsed.S3_FORCE_PATH_STYLE === "1",
      configured: s3Configured,
    },
    ownerSetupToken: parsed.OWNER_SETUP_TOKEN,
    smtp: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      username: parsed.SMTP_USERNAME,
      password: parsed.SMTP_PASSWORD,
      from: parsed.SMTP_FROM,
      configured: smtpConfigured,
    },
    ai: {
      enabled: parsed.AI_ENABLED === "true" || parsed.AI_ENABLED === "1",
      baseUrl: parsed.AI_BASE_URL,
      apiKey: parsed.AI_API_KEY,
      model: parsed.AI_MODEL,
    },
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    documentStoreDir: parsed.DOCUMENT_STORE_DIR,
  };
}
