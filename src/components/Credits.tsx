import { useEffect, useState } from "react";
import { Coins, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { publishCredits, useCredits } from "@/hooks/useCredits";
import { creditPacks, creditTopUpPromise } from "@/config/features";
import { buyPack, loadPacks, type Pack, PaymentError } from "@/lib/payments";

const rupees = (paise: number) => `₹${Math.round(paise / 100)}`;

export function BuyCreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { refresh } = useCredits();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linksOnly, setLinksOnly] = useState(false);

  useEffect(() => {
    if (open && packs === null) loadPacks().then(setPacks);
  }, [open, packs]);

  const buy = async (pack: Pack) => {
    setBusy(pack.id);
    try {
      const r = await buyPack(pack.id);
      publishCredits(r.creditsRemaining);
      toast.success(`${r.creditsAdded ?? pack.credits} evaluations added.`);
      onOpenChange(false);
    } catch (e) {
      const err = e instanceof PaymentError ? e : new PaymentError("Payment failed. Try again.", "UNKNOWN");
      if (err.code === "PAYMENTS_NOT_CONFIGURED") setLinksOnly(true);
      else if (err.code === "CANCELLED") {
        /* user closed the window */
      } else if (err.code === "PENDING") {
        toast.info(err.message);
        onOpenChange(false);
        setTimeout(refresh, 15_000);
        setTimeout(refresh, 60_000);
      } else toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  // Fallback while Razorpay keys aren't configured: the old payment links, credited by hand.
  const legacy = linksOnly || (packs !== null && packs.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get more evaluations</DialogTitle>
          <DialogDescription>
            {legacy ? (
              <>
                Pay with UPI or card through Razorpay. Enter <strong>{user?.email}</strong> as your email at checkout so
                we can match the payment. Evaluations are added {creditTopUpPromise}.
              </>
            ) : (
              <>Pay with UPI, card or netbanking. Evaluations are added the moment the payment goes through.</>
            )}
          </DialogDescription>
        </DialogHeader>
        {packs === null && !legacy ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : legacy ? (
          creditPacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Payments aren't set up yet. Contact the ShastraLab team.</p>
          ) : (
            <div className="grid gap-3">
              {creditPacks.map((p) => (
                <a
                  key={p.id}
                  href={`${p.url}${p.url!.includes("?") ? "&" : "?"}email=${encodeURIComponent(user?.email ?? "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent transition-colors"
                >
                  <div>
                    <div className="font-semibold">{p.credits} evaluations</div>
                    <div className="text-sm text-muted-foreground">₹{Math.round(p.price / p.credits)} per answer</div>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    ₹{p.price} <ExternalLink className="h-4 w-4" />
                  </div>
                </a>
              ))}
            </div>
          )
        ) : (
          <div className="grid gap-3">
            {packs!.map((p) => (
              <button
                key={p.id}
                disabled={busy !== null}
                onClick={() => buy(p)}
                className="flex items-center justify-between rounded-lg border p-4 text-left hover:bg-accent transition-colors disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold">{p.credits} evaluations</div>
                  <div className="text-sm text-muted-foreground">{rupees(p.pricePaise / p.credits)} per answer</div>
                </div>
                <div className="flex items-center gap-2 font-semibold">
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : rupees(p.pricePaise)}
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreditsBadge() {
  const { credits, loading } = useCredits();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-4 py-2 text-sm hover:bg-sidebar-accent transition-colors"
        aria-label="Evaluations left. Buy more."
      >
        <span className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {loading || credits === null ? "…" : `${credits} evaluation${credits === 1 ? "" : "s"} left`}
        </span>
        <span className="text-xs font-semibold underline">Buy</span>
      </button>
      <BuyCreditsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function OutOfCreditsNotice() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">You've used all your evaluations.</p>
      <p className="text-muted-foreground mt-1">Your answer is still here. Get a pack and submit again.</p>
      <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
        See packs
      </Button>
      <BuyCreditsDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
