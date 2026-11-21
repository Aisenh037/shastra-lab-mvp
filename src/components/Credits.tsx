import { useState } from "react";
import { Coins, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { creditPacks, creditTopUpPromise } from "@/config/features";

export function BuyCreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get more evaluations</DialogTitle>
          <DialogDescription>
            Pay with UPI or card through Razorpay. Enter <strong>{user?.email}</strong> as your email at checkout so we
            can match the payment. Evaluations are added {creditTopUpPromise}.
          </DialogDescription>
        </DialogHeader>
        {creditPacks.length === 0 ? (
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
