import pool from "../db/index.js";

// Persistence for PayU transactions. The DB row is the server-side source of truth; a payment is
// only considered successful after we verify it and update the status here.

export async function createPayment({ txnid, userId, amount, productinfo, firstname, email, phone }) {
    const result = await pool.query(
        `
        INSERT INTO payments(txnid, user_id, amount, productinfo, firstname, email, phone, status)
        VALUES($1, $2, $3, $4, $5, $6, $7, 'initiated')
        RETURNING *
        `,
        [txnid, userId ?? null, amount, productinfo, firstname ?? null, email ?? null, phone ?? null]
    );
    return result.rows[0];
}

export async function getPaymentByTxnid(txnid) {
    const result = await pool.query("SELECT * FROM payments WHERE txnid = $1", [txnid]);
    return result.rows[0] || null;
}

export async function updatePaymentStatus(txnid, { status, mihpayid, mode, errorMessage }) {
    const result = await pool.query(
        `
        UPDATE payments
        SET status = $2,
            payu_mihpayid = COALESCE($3, payu_mihpayid),
            payu_mode = COALESCE($4, payu_mode),
            error_message = COALESCE($5, error_message),
            updated_at = now()
        WHERE txnid = $1
        RETURNING *
        `,
        [txnid, status, mihpayid ?? null, mode ?? null, errorMessage ?? null]
    );
    return result.rows[0] || null;
}

export async function listPaymentsByUser(userId) {
    const result = await pool.query(
        "SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC",
        [userId]
    );
    return result.rows;
}

// Returns the user's successful payment if one exists (used to prevent paying twice).
export async function getSuccessfulPaymentByUser(userId) {
    if (userId == null) return null;
    const result = await pool.query(
        "SELECT * FROM payments WHERE user_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 1",
        [userId]
    );
    return result.rows[0] || null;
}
