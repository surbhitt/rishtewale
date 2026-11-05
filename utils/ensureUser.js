const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const client = require("../db");

// Finds the account for a (normalized) phone number, or creates one with a random password.
// The password is only returned when a new account was created, since there is no other way
// yet to deliver it to that person.
async function findOrCreateUser(phone) {
    const existing = await client.query("SELECT id FROM users WHERE phone = $1", [phone]);

    if (existing.rows.length > 0) {
        return { userId: existing.rows[0].id, created: false };
    }

    const temporaryPassword = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const created = await client.query(
        "INSERT INTO users(phone, password_hash) VALUES($1, $2) RETURNING id",
        [phone, passwordHash]
    );

    return { userId: created.rows[0].id, created: true, temporaryPassword };
}

module.exports = findOrCreateUser;
