// Indian mobile numbers: 10 digits, starting 6-9, once the country code is stripped.
export const PHONE_RE = /^[6-9]\d{9}$/;

export function normalizePhone(raw) {
    return String(raw)
        .trim()
        .replace(/[\s-]/g, "")
        .replace(/^\+?91/, "");
}
