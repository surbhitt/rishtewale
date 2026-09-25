import pg from "pg";

import config from "../config/index.js";

const { Pool, types } = pg;

// oid 1082 = DATE. pg's default parser turns this into a JS Date at local midnight, which then
// serializes to a shifted UTC day (e.g. "1998-04-12" -> "1998-04-11T18:30:00.000Z") once
// res.json() calls toISOString(). Keep it as the plain "YYYY-MM-DD" string instead.
types.setTypeParser(1082, (value) => value);

// A Pool instead of a single Client: Neon suspends idle compute after 5 minutes and drops the
// connection, which a lone Client never recovers from. The Pool discards dead connections and
// opens a fresh one (waking the database) on the next query. Exposes the same .query() API.
const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: {
        rejectUnauthorized: false
    },
    max: config.dbPoolMax
});

// Idle connections dying (e.g. Neon suspending) surface as an 'error' event on the pool; without
// a listener Node would treat it as unhandled and crash the process.
pool.on("error", (err) => {
    console.error("Idle DB connection error (will reconnect on next query):", err.message);
});

export default pool;
