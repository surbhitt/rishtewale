import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import bulkUploadRoutes from "./routes/bulkUpload.routes.js";
import legacyUploadRoutes from "./routes/legacyUpload.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import usersRoutes from "./routes/users.routes.js";
import { notFound, errorHandler } from "./middleware/error.js";

// Builds the Express application without starting a listener, so it can be imported by the server
// bootstrap (server.js) and, in the future, by supertest-style tests.
export default function createApp() {
    const app = express();

    // Behind Render's proxy: trust it so req.ip / secure cookies work correctly.
    app.set("trust proxy", 1);

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Liveness/root text (kept for backwards compatibility).
    app.get("/", (req, res) => {
        res.send("access /api/upload");
    });

    // Health check for load balancers / uptime monitors.
    app.get("/health", (req, res) => {
        res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
    });

    app.use("/api/auth", authRoutes);
    app.use("/api/users", usersRoutes);
    app.use("/api/profile", profileRoutes);
    app.use("/api/profile", bulkUploadRoutes);
    app.use("/api/payments", paymentRoutes);
    app.use("/api", legacyUploadRoutes); // legacy POST /api/upload

    // 404 + centralized error handling (must be registered last).
    app.use(notFound);
    app.use(errorHandler);

    return app;
}
