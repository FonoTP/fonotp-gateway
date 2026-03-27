import dotenv from "dotenv";
import { resolve } from "node:path";

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
  controlPlaneBaseUrl: process.env.CONTROL_PLANE_BASE_URL ?? "http://127.0.0.1:3001",
  controlPlaneRuntimeToken: process.env.CONTROL_PLANE_RUNTIME_TOKEN ?? "demo-runtime-secret",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 900),
  allowedServiceOrigins: parseCsvEnv("ALLOWED_SERVICE_ORIGINS"),
  allowedBrowserOrigins: parseCsvEnv("ALLOWED_BROWSER_ORIGINS"),
  iceServers: parseJsonEnv("ICE_SERVERS", [{ urls: "stun:stun.l.google.com:19302" }]),
  recordingsDir: resolve(process.env.RECORDINGS_DIR ?? "recordings"),
  sonioxApiKey: process.env.SONIOX_API_KEY ?? "",
  sonioxRealtimeModel: process.env.SONIOX_REALTIME_MODEL ?? "stt-rt-preview"
};
