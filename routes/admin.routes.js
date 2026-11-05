const express = require("express");

const client = require("../db");
const authenticateToken = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");
const findOrCreateUser = require("../utils/ensureUser");
const upsertProfile = require("../utils/upsertProfile");
const { validateProfileFields } = require("../utils/profileFields");
const { PHONE_RE, normalizePhone } = require("../utils/phone");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// users LEFT JOIN profiles so accounts with no (or a half-empty) profile still show up.
// `users.id AS user_id` comes last on purpose: it wins over profiles.user_id (NULL when there is
// no profile row) in the resulting row object.
const SELECT_ENTRY = `
    SELECT profiles.*, users.id AS user_id, users.phone, users.created_at AS account_created_at,
           DATE_PART('year', AGE(profiles.date_of_birth)) AS age
    FROM users
    LEFT JOIN profiles ON profiles.user_id = users.id
`;

async function fetchEntry(userId) {
    const result = await client.query(`${SELECT_ENTRY} WHERE users.id = $1`, [userId]);
    return result.rows[0];
}

// Distinct values already in the database, used to feed the autocomplete cells.
const SUGGESTION_COLUMNS = [
    "place_of_birth", "current_city", "caste", "mother_gotra", "maternal_grandmother_gotra",
    "highest_qualification", "field_of_study", "additional_qualifications", "job_title", "industry",
    "father_occupation", "mother_occupation", "own_property", "preferred_education"
];

router.get("/suggestions", async (req, res) => {
    try {
        const selects = SUGGESTION_COLUMNS.map(
            (col) => `(SELECT '${col}' AS field, ${col} AS value FROM profiles WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY COUNT(*) DESC LIMIT 300)`
        );
        selects.push(
            "(SELECT 'preferred_cities' AS field, city AS value FROM profiles, UNNEST(preferred_cities) AS city WHERE city <> '' GROUP BY city ORDER BY COUNT(*) DESC LIMIT 300)"
        );
        const result = await client.query(selects.join(" UNION ALL "));

        const suggestions = {};
        for (const row of result.rows) {
            (suggestions[row.field] ||= []).push(row.value);
        }
        res.json(suggestions);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to load suggestions" });
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await client.query(
            `${SELECT_ENTRY} ORDER BY COALESCE(profiles.updated_at, users.created_at) DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to fetch entries" });
    }
});

router.get("/:userId", async (req, res) => {
    if (!/^\d+$/.test(req.params.userId)) {
        return res.status(400).json({ error: "Invalid id" });
    }

    try {
        const entry = await fetchEntry(req.params.userId);
        if (!entry) {
            return res.status(404).json({ error: "Entry not found" });
        }
        res.json(entry);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to fetch entry" });
    }
});

// New entry. Only the phone number is mandatory (it identifies the account); every other field
// may be left out and filled in later with PATCH. Passwords for newly created accounts are
// random and not returned - the family can set one through the normal flow later.
router.post("/", async (req, res) => {
    const phone = normalizePhone(req.body.phone ?? "");

    if (!PHONE_RE.test(phone)) {
        return res.status(400).json({ errors: ["phone must be a valid 10-digit Indian mobile number"] });
    }

    const { errors, values } = validateProfileFields(req.body, { partial: true });
    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    try {
        const existing = await client.query(
            "SELECT users.id, profiles.id IS NOT NULL AS has_profile FROM users LEFT JOIN profiles ON profiles.user_id = users.id WHERE users.phone = $1",
            [phone]
        );

        if (existing.rows[0]?.has_profile) {
            return res.status(409).json({
                error: "An entry with this phone number already exists",
                userId: existing.rows[0].id
            });
        }

        const { userId } = await findOrCreateUser(phone);
        await upsertProfile(userId, values);
        res.status(201).json(await fetchEntry(userId));
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to save entry" });
    }
});

// Partial edit: only the fields sent are touched; null / "" clears a field.
router.patch("/:userId", async (req, res) => {
    if (!/^\d+$/.test(req.params.userId)) {
        return res.status(400).json({ error: "Invalid id" });
    }

    const userId = Number(req.params.userId);
    const { errors, values } = validateProfileFields(req.body, { partial: true });

    let phone = null;
    if (req.body.phone !== undefined) {
        phone = normalizePhone(req.body.phone ?? "");
        if (!PHONE_RE.test(phone)) {
            errors.push("phone must be a valid 10-digit Indian mobile number");
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    if (phone === null && Object.keys(values).length === 0) {
        return res.status(400).json({ error: "No fields provided to update" });
    }

    try {
        const user = await client.query("SELECT id FROM users WHERE id = $1", [userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: "Entry not found" });
        }

        if (phone !== null) {
            try {
                await client.query("UPDATE users SET phone = $1 WHERE id = $2", [phone, userId]);
            } catch (error) {
                if (error.code === "23505") {
                    return res.status(409).json({ error: "Another account already uses this phone number" });
                }
                throw error;
            }
        }

        await upsertProfile(userId, values);
        res.json(await fetchEntry(userId));
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to update entry" });
    }
});

module.exports = router;
