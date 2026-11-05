const client = require("../db");
const { normalizePhone } = require("../utils/phone");

// Must run after authenticateToken. Only accounts whose phone number is listed in the
// ADMIN_PHONES env var (comma separated) may use the data-entry endpoints, because they expose
// every family's personal details. If ADMIN_PHONES is unset nobody is allowed in.
async function requireAdmin(req, res, next) {
    const allowed = (process.env.ADMIN_PHONES || "")
        .split(",")
        .map((p) => normalizePhone(p))
        .filter(Boolean);

    try {
        const result = await client.query("SELECT phone FROM users WHERE id = $1", [req.userId]);

        if (result.rows.length === 0 || !allowed.includes(result.rows[0].phone)) {
            return res.status(403).json({ error: "Not allowed to use data entry" });
        }

        next();
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to check permissions" });
    }
}

module.exports = requireAdmin;
