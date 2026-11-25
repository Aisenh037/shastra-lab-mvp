import { describe, expect, it } from "vitest";
import { authErrorFromUrl, friendlyAuthError, passwordProblem } from "./auth-messages";

describe("passwordProblem", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblem("mains2026answers", "kc@gmail.com")).toBeNull();
  });
  it.each([
    ["short1", "at least 8"],
    ["onlyletters", "letter and one number"],
    ["12345678", "letter and one number"],
    ["password1", "too common"],
  ])("rejects %s", (pw, why) => {
    expect(passwordProblem(pw)).toContain(why);
  });
  it("rejects a password containing the email name", () => {
    expect(passwordProblem("aspirant99", "aspirant@gmail.com")).toContain("email");
  });
});

describe("friendlyAuthError", () => {
  it("maps common Supabase errors to plain language", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe("Wrong email or password.");
    expect(friendlyAuthError("Email not confirmed")).toContain("Confirm your email");
    expect(friendlyAuthError("email rate limit exceeded")).toContain("Too many attempts");
    expect(friendlyAuthError("User already registered")).toContain("Sign in instead");
    expect(friendlyAuthError("Email address not authorized")).toContain("couldn't send");
  });
  it("falls back to the original message", () => {
    expect(friendlyAuthError("Something odd")).toBe("Something odd");
    expect(friendlyAuthError(undefined)).toContain("Something went wrong");
  });
});

describe("authErrorFromUrl", () => {
  it("reads an expired-link error from the hash", () => {
    expect(
      authErrorFromUrl("https://app/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"),
    ).toContain("expired");
  });
  it("reads errors from the query string too", () => {
    expect(authErrorFromUrl("https://app/auth?error=server_error&error_description=Invalid+login+credentials")).toBe("Wrong email or password.");
  });
  it("returns null for a clean URL", () => {
    expect(authErrorFromUrl("https://app/auth")).toBeNull();
    expect(authErrorFromUrl("https://app/dashboard#access_token=abc")).toBeNull();
  });
});
