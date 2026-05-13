import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerPublicRoutes } from "../publicRoutes";
import { registerAdminRoutes } from "../adminRoutes";
import { registerAdminStripeConnectRoutes } from "../adminStripeConnect";
import { registerLegalRoutes } from "../legalRoutes";
import { registerStripeRoutes } from "../stripeRoutes";
import { registerStripeConnectRoutes } from "../stripeConnectRoutes";
import { registerClientRoutes } from "../clientRoutes";
import { startRenewalNotificationCron } from "../renewalNotificationCron";
import { startAppointmentReminderCron } from "../appointmentReminderCron";
import { startReferralExpiryCron } from "../referralExpiryCron";
import { startRequestExpiryCron } from "../requestExpiryCron";
import { startClientReminderCron } from "../clientReminderCron";
import { startAccountDeletionCron } from "../accountDeletionCron";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Preserve raw body for Stripe webhook signature verification
  // The webhook handler needs the raw Buffer, not the parsed JSON object
  app.use(
    express.json({
      limit: "50mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // Register Stripe payment routes (must be before json middleware for webhook raw body)
  registerStripeRoutes(app);
  registerStripeConnectRoutes(app);

  // Register admin dashboard
  registerAdminRoutes(app);
  registerAdminStripeConnectRoutes(app);

  // Register legal pages (privacy, terms, eula, data deletion)
  registerLegalRoutes(app);

  // Register public web pages (booking, review, gift card)
  registerPublicRoutes(app);
  registerClientRoutes(app);

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);

// Start background crons
startRenewalNotificationCron();
startAppointmentReminderCron();
startReferralExpiryCron();
startRequestExpiryCron();
startClientReminderCron();
startAccountDeletionCron();
