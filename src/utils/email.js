// Matches the frontend's validation (src/routes/signup.tsx): a basic, pragmatic email shape.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Store and compare emails case-insensitively and trimmed, so "Jane@X.com" and "jane@x.com" are
// the same account.
export function normalizeEmail(raw) {
    return String(raw).trim().toLowerCase();
}

export function isValidEmail(raw) {
    const email = normalizeEmail(raw);
    return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}
