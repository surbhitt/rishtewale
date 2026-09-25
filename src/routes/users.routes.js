import express from "express";

import pool from "../db/index.js";
import config from "../config/index.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// In development, allow viewing users without a token for convenience. In production, keep the
// endpoint protected since listing every account is sensitive.
const guard = config.isProduction ? authenticateToken : (req, res, next) => next();

// List all accounts. Never returns password_hash. Supports pagination via ?limit= & ?offset=,
// and joins profiles to surface who has completed a profile and their name.
router.get("/", guard, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
        `
        SELECT
            users.id,
            users.email,
            users.created_at,
            profiles.full_name,
            (profiles.id IS NOT NULL) AS has_profile
        FROM users
        LEFT JOIN profiles ON profiles.user_id = users.id
        ORDER BY users.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
    );

    const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS total FROM users");
    const total = countRows[0].total;

    res.json({
        total,
        limit,
        offset,
        count: rows.length,
        users: rows
    });
});

export default router;
