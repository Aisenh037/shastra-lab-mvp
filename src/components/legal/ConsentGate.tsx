// Asks for consent when the user hasn't accepted the current Terms and Privacy
// Policy: Google sign-ups (no checkbox on Google's screen) and anyone after a
// policy version bump. Email sign-ups accept on the sign-up form.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { POLICY_VERSIONS } from "@/config/legal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function hasCurrentConsent(rows: Array<{ terms_version: string; privacy_version: string }>): boolean {
  return rows.some((r) => r.terms_version === POLICY_VERSIONS.terms && r.privacy_version === POLICY_VERSIONS.privacy);
}

export function ConsentGate() {
  const { user, signOut } = useAuth();
  const [needed, setNeeded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("user_consents")
      .select("terms_version, privacy_version")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        // If the check itself fails, don't lock the user out.
        if (!cancelled && !error) setNeeded(!hasCurrentConsent(data ?? []));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const accept = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("record_consent", {
      p_terms_version: POLICY_VERSIONS.terms,
      p_privacy_version: POLICY_VERSIONS.privacy,
      p_age_confirmed: adult,
    });
    setSaving(false);
    if (error) return toast.error("Couldn't save that. Please try again.");
    setNeeded(false);
  };

  return (
    <Dialog open={needed}>
      <DialogContent className="[&>button]:hidden" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
          <DialogDescription>
            Please review and accept how ShastraLab works and how we handle your answers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-3">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} aria-label="I agree to the Terms and Privacy Policy" />
            <span>
              I agree to the{" "}
              <Link to="/terms" target="_blank" className="text-primary underline">Terms of Service</Link> and{" "}
              <Link to="/privacy" target="_blank" className="text-primary underline">Privacy Policy</Link>, including that my answers
              are sent to AI providers to be evaluated.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Checkbox checked={adult} onCheckedChange={(v) => setAdult(v === true)} aria-label="I am 18 or older" />
            <span>I am 18 years or older.</span>
          </label>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
          <Button disabled={!agreed || !adult || saving} onClick={accept}>{saving ? "Saving..." : "Accept and continue"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
