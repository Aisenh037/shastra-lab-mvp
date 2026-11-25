// Landing page for the emailed reset link. Supabase signs the user in with a
// short-lived recovery session (event PASSWORD_RECOVERY); they set a new password here.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GraduationCap, KeyRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authErrorFromUrl, friendlyAuthError, MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/auth-messages";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { session, loading, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError] = useState(() => authErrorFromUrl(window.location.href));

  useEffect(() => {
    if (linkError) window.history.replaceState(null, "", window.location.pathname);
  }, [linkError]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, session?.user.email);
    if (problem) return toast.error(problem);
    if (password !== confirm) return toast.error("Passwords do not match");
    setSaving(true);
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    toast.success("Password updated. You're signed in.");
    navigate("/dashboard");
  };

  const expired = !loading && (linkError || !session);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <GraduationCap className="h-8 w-8 text-primary" />
            <span className="text-xl font-display font-bold">ShastraLab</span>
          </div>
          <KeyRound className="mx-auto mb-2 h-8 w-8 text-primary" />
          <CardTitle className="text-2xl font-display">{expired ? "Link expired" : "Set a new password"}</CardTitle>
          <CardDescription>
            {expired
              ? linkError ?? "This reset link has expired or was already used. Request a new one."
              : session?.user.email
                ? <>For <strong>{session.user.email}</strong></>
                : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground animate-pulse">Checking your link…</p>
          ) : expired ? (
            <Button className="w-full" onClick={() => navigate("/auth")}>Request a new link</Button>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirm new password</Label>
                <Input id="confirm-new-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving..." : "Save new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
