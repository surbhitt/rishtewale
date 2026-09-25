import jwt from "jsonwebtoken";

import config from "../config/index.js";

export default function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: "Missing authorization token" });
    }

    jwt.verify(token, config.jwtSecret, (err, payload) => {
        if (err) {
            return res.status(403).json({ error: "Invalid or expired token" });
        }

        req.userId = payload.userId;
        next();
    });
}
