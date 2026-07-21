const { Client, types } = require("pg");

// oid 1082 = DATE. pg's default parser turns this into a JS Date at local midnight, which
// then serializes to a shifted UTC day (e.g. "1998-04-12" -> "1998-04-11T18:30:00.000Z") once
// res.json() calls toISOString(). Keep it as the plain "YYYY-MM-DD" string instead.
types.setTypeParser(1082, (value) => value);

const client = new Client({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

module.exports = client;
