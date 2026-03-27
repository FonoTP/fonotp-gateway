import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { ControlPlaneClient } from "./control-plane-client.js";
import { GatewaySessionStore } from "./gateway-session-store.js";
import { WebRtcGateway } from "./webrtc-gateway.js";
import { registerRoutes } from "./routes.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, "..", "public");

const app = Fastify({
  logger: {
    level: config.logLevel
  }
});

await app.register(websocket);
await app.register(cors, {
  origin(origin, callback) {
    if (!origin || config.allowedBrowserOrigins.length === 0 || config.allowedBrowserOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed"), false);
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
await app.register(fastifyStatic, {
  root: publicDirectory
});

const controlPlane = new ControlPlaneClient({
  baseUrl: config.controlPlaneBaseUrl,
  runtimeToken: config.controlPlaneRuntimeToken
});
const sessionStore = new GatewaySessionStore();
const gateway = new WebRtcGateway({
  config,
  controlPlane,
  logger: app.log,
  sessionStore
});

await registerRoutes(app, { controlPlane, gateway, config });

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error, "Failed to start WebRTC gateway");
  process.exitCode = 1;
}
