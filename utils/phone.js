// Indian mobile numbers: 10 digits, starting 6-9, once the country code is stripped.
const PHONE_RE = /^[6-9]\d{9}$/;

function normalizePhone(raw) {
    return String(raw)
        .trim()
        .replace(/[\s-]/g, "")
        .replace(/^\+?91/, "");
}

module.exports = { PHONE_RE, normalizePhone };
