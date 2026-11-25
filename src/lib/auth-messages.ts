// Password rules and plain-language auth errors, shared by the sign-in,
// sign-up and reset-password screens.

export const MIN_PASSWORD_LENGTH = 8;

const COMMON = new Set(["password", "password1", "12345678", "123456789", "qwerty123", "iloveyou", "upsc2026", "upsc2027", "india123"]);

/** Returns what's wrong with a new password, or null if it's acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Use at least one letter and one number.";
  if (COMMON.has(password.toLowerCase())) return "That password is too common. Pick another.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Don't use your email in your password.";
  return null;
}

/** Map Supabase Auth errors to messages a student can act on. */
export function friendlyAuthError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("email not confirmed")) return "Confirm your email first. We can send the link again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "This email already has an account. Sign in instead.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("over_email_send_rate_limit"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("email address not authorized")) return "We couldn't send the email right now. Please try again later.";
  if (m.includes("same password") || m.includes("different from the old")) return "Pick a password different from your old one.";
  if (m.includes("weak") || m.includes("password should")) return "That password is too weak. Use at least 8 characters with letters and numbers.";
  if (m.includes("expired") || m.includes("invalid") && m.includes("link")) return "This link has expired. Request a new one.";
  if (m.includes("fetch") || m.includes("network")) return "No connection. Check your internet and try again.";
  return message || "Something went wrong. Please try again.";
}

/** Supabase puts link errors in the URL hash or query (e.g. an expired reset link). */
export function authErrorFromUrl(href: string): string | null {
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  url.searchParams.forEach((v, k) => params.set(k, v));
  const code = params.get("error_code");
  const desc = params.get("error_description");
  if (!code && !desc) return null;
  if (code === "otp_expired") return "This link has expired or was already used. Request a new one.";
  return friendlyAuthError(desc?.replace(/\+/g, " ") ?? code);
}
