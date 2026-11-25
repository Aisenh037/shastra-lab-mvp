import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const listeners = new Set<(n: number) => void>();

/** Push a balance the server just returned (e.g. after an evaluation) to every mounted badge. */
export function publishCredits(balance: number | null | undefined) {
  if (typeof balance === "number") listeners.forEach((l) => l(balance));
}

async function fetchBalance(): Promise<number | null> {
  const { data, error } = await supabase.rpc("my_credit_balance");
  return !error && typeof data === "number" ? data : null;
}

export function useCredits() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchBalance().then((n) => {
      if (cancelled) return;
      if (n !== null) setCredits(n);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    listeners.add(setCredits);
    return () => {
      listeners.delete(setCredits);
    };
  }, []);

  const refresh = useCallback(async () => {
    const n = await fetchBalance();
    if (n !== null) setCredits(n);
  }, []);

  return { credits, loading, refresh };
}
