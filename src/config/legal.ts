// Business details shown on the legal pages, footer and contact page.
// Fill these in before applying for Razorpay live mode: payment gateways check
// that the legal name, address and contact details are real and consistent.
// Set them as VITE_LEGAL_* variables on Render, or edit the defaults here.

const env = import.meta.env as Record<string, string | undefined>;
const v = (name: string, fallback: string) => env[`VITE_LEGAL_${name}`]?.trim() || fallback;

export const legal = {
  /** Brand name used in copy. */
  brand: "ShastraLab",
  /** Who runs the service: your name as a sole proprietor, or the registered company name. */
  operator: v("OPERATOR", "[Your legal name or company name]"),
  /** Registered or postal address (Razorpay requires a physical address). */
  address: v("ADDRESS", "[Street, City, State PIN, India]"),
  email: v("EMAIL", "support@shastralab.in"),
  phone: v("PHONE", "[+91 phone number]"),
  /** Grievance Officer (DPDP Act s.8(10) contact for privacy questions; IT Rules 2021 grievance officer). */
  grievanceOfficer: v("GRIEVANCE_OFFICER", "[Name of grievance officer]"),
  grievanceEmail: v("GRIEVANCE_EMAIL", "privacy@shastralab.in"),
  /** Courts with jurisdiction for the Terms. */
  jurisdiction: v("JURISDICTION", "Bhopal, Madhya Pradesh"),
  gstin: v("GSTIN", ""),
  /** Working days within which refund requests are answered and refunds reach the source. */
  refundResponseDays: 3,
  refundCreditDays: "5–7",
};

/**
 * Bump these when the text changes in a way users must agree to again: the app
 * then asks every user to accept the new version (see ConsentGate).
 */
export const POLICY_VERSIONS = { terms: "2026-11-25", privacy: "2026-11-25" } as const;
export const POLICY_EFFECTIVE_DATE = "25 November 2026";

/** True while any required business detail is still a placeholder. */
export const legalDetailsIncomplete = [legal.operator, legal.address, legal.phone, legal.grievanceOfficer].some((s) => s.startsWith("["));
