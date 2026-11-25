import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const auth = { session: null as unknown, loading: false, updatePassword: vi.fn() };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

import ResetPassword from "./ResetPassword";
import { toast } from "sonner";

const view = () => render(<MemoryRouter><ResetPassword /></MemoryRouter>);

beforeEach(() => {
  navigate.mockReset();
  auth.updatePassword.mockReset();
  auth.session = null;
  window.history.replaceState(null, "", "/reset-password");
});

describe("ResetPassword", () => {
  it("without a recovery session, explains the link expired and offers a new one", () => {
    view();
    expect(screen.getByText("Link expired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request a new link" }));
    expect(navigate).toHaveBeenCalledWith("/auth");
  });

  it("rejects a weak password without calling Supabase", () => {
    auth.session = { user: { email: "kc@gmail.com" } };
    view();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("at least 8"));
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });

  it("saves a valid password and goes to the dashboard", async () => {
    auth.session = { user: { email: "kc@gmail.com" } };
    auth.updatePassword.mockResolvedValue({ error: null });
    view();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "mains2026answers" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "mains2026answers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/dashboard"));
    expect(auth.updatePassword).toHaveBeenCalledWith("mains2026answers");
  });
});
