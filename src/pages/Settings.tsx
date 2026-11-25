// Account settings: name, and the DPDP data rights (download, delete).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Download, Trash2, UserRound, ShieldCheck } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import AppLayout from "@/components/layouts/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { legal } from "@/config/legal";

async function errorMessage(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    try {
      return ((await (error.context as Response).clone().json()) as { error?: string }).error ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle().then(({ data }) => setName(data?.full_name ?? ""));
  }, [user]);

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() || null }).eq("id", user.id);
    setSavingName(false);
    if (error) toast.error("Couldn't save your name.");
    else toast.success("Saved.");
  };

  const exportData = async () => {
    setExporting(true);
    const { data, error } = await supabase.functions.invoke("export-my-data", { body: {} });
    setExporting(false);
    if (error) return toast.error(await errorMessage(error, "Couldn't prepare your data. Try again."));
    downloadJson(data, `shastralab-my-data-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const { error } = await supabase.functions.invoke("delete-account", { body: { confirmEmail } });
    setDeleting(false);
    if (error) return toast.error(await errorMessage(error, "Couldn't delete your account. Try again."));
    await signOut().catch(() => {});
    toast.success("Your account and data have been deleted.");
    navigate("/");
  };

  const emailMatches = confirmEmail.trim().toLowerCase() === (user?.email ?? "").toLowerCase() && confirmEmail.length > 0;

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Settings</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" /> Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="full-name">Name</Label>
              <Input id="full-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <Button onClick={saveName} disabled={savingName}>{savingName ? "Saving..." : "Save"}</Button>
            <p className="text-sm text-muted-foreground">
              To change your email or correct anything else, write to <a className="underline" href={`mailto:${legal.email}`}>{legal.email}</a>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Your data</CardTitle>
            <CardDescription>
              Your rights under India's DPDP Act. See the <Link to="/privacy" className="underline">Privacy Policy</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="font-medium">Download my data</div>
              <p className="text-sm text-muted-foreground">
                Everything we hold about you (account, answers, scores, payments, consents) as a JSON file.
              </p>
              <Button variant="outline" onClick={exportData} disabled={exporting}>
                <Download className="h-4 w-4 mr-2" /> {exporting ? "Preparing..." : "Download"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-6">
              <div className="font-medium text-destructive">Delete my account</div>
              <p className="text-sm text-muted-foreground">
                Permanently deletes your account, answers, photos, scores and unused credits. This can't be undone.
                Payment records are kept for tax law without your name or email. Want a refund for unused credits?{" "}
                <Link to="/refunds" className="underline">Ask first</Link>.
              </p>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setConfirmEmail(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes everything. Type <strong>{user?.email}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Confirm your email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user?.email ?? ""} autoComplete="off" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={!emailMatches || deleting} onClick={deleteAccount}>
              {deleting ? "Deleting..." : "Delete forever"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
