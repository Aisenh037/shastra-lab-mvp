import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) },
}));

import { hasCurrentConsent } from "./ConsentGate";
import { POLICY_VERSIONS } from "@/config/legal";
import Privacy from "@/pages/legal/Privacy";
import Terms from "@/pages/legal/Terms";
import Refunds from "@/pages/legal/Refunds";
import Delivery from "@/pages/legal/Delivery";
import Contact from "@/pages/legal/Contact";
import About from "@/pages/legal/About";

const page = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("hasCurrentConsent", () => {
  it("needs both current versions", () => {
    expect(hasCurrentConsent([])).toBe(false);
    expect(hasCurrentConsent([{ terms_version: "2020-01-01", privacy_version: POLICY_VERSIONS.privacy }])).toBe(false);
    expect(hasCurrentConsent([{ terms_version: POLICY_VERSIONS.terms, privacy_version: POLICY_VERSIONS.privacy }])).toBe(true);
  });
});

describe("legal pages (what Razorpay and the DPDP Act look for)", () => {
  it("privacy policy names processors, rights, grievance officer and the Board", () => {
    page(<Privacy />);
    const text = document.body.textContent ?? "";
    for (const must of ["Supabase", "Razorpay", "AI model providers", "Grievance Officer", "Data Protection Board of India", "18", "Erasure", "Nomination"]) {
      expect(text).toContain(must);
    }
  });

  it("terms disclaim UPSC affiliation and guarantee of results", () => {
    page(<Terms />);
    expect(screen.getByText(/not affiliated with, endorsed by or connected to/i)).toBeTruthy();
    expect(document.body.textContent).toContain("don't guarantee any exam score");
  });

  it("refund policy states timelines", () => {
    page(<Refunds />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/within 7 days/);
    expect(text).toMatch(/working days/);
  });

  it("delivery, contact and about pages render", () => {
    page(<Delivery />);
    expect(document.body.textContent).toContain("Nothing is shipped");
    page(<Contact />);
    expect(document.body.textContent).toContain("Grievance Officer");
    page(<About />);
    expect(document.body.textContent).toContain("₹199");
  });

  it("shows a draft banner while business details are placeholders", () => {
    page(<Contact />);
    expect(screen.getAllByRole("note")[0].textContent).toMatch(/placeholders/);
  });
});
