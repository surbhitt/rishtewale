const client = require("../db");

// Upserts only the columns present in `values`. On first write for a user this creates the row
// (any column left out stays NULL / falls back to its DB default); on later writes it only
// touches the columns supplied, leaving the rest of the profile as-is.
async function upsertProfile(userId, values) {
    const columns = Object.keys(values);
    const params = columns.map((col) => values[col]);
    const insertColumns = ["user_id", ...columns];
    const placeholders = insertColumns.map((_, i) => `$${i + 1}`);
    const updateAssignments = columns.map((col) => `${col} = EXCLUDED.${col}`);

    const result = await client.query(
        `
        INSERT INTO profiles(${insertColumns.join(", ")})
        VALUES(${placeholders.join(", ")})
        ON CONFLICT (user_id) DO UPDATE SET
            ${updateAssignments.join(", ")},
            updated_at = now()
        RETURNING *, DATE_PART('year', AGE(date_of_birth)) AS age
        `,
        [userId, ...params]
    );

    return result.rows[0];
}

module.exports = upsertProfile;
