import dotenv from "dotenv";

dotenv.config();

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error.message}`);
  }
}

function parseCsvEnv(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? "info",
  databaseUrl: process.env.DATABASE_URL,
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 900),
  authBearerPrefix: process.env.AUTH_BEARER_PREFIX ?? "Bearer",
  allowedServiceOrigins: parseCsvEnv("ALLOWED_SERVICE_ORIGINS"),
  iceServers: parseJsonEnv("ICE_SERVERS", [{ urls: "stun:stun.l.google.com:19302" }]),
  demoDefaultToken: process.env.DEMO_DEFAULT_TOKEN ?? "demo-user-token"
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
