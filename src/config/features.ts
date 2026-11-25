// Features switched off for the paid pilot: they don't change whether someone pays.
// Turn one back on with VITE_FEATURE_<NAME>=true (e.g. VITE_FEATURE_LEADERBOARD=true).

const env = import.meta.env as Record<string, string | undefined>;
const flag = (name: string, fallback: boolean) => {
  const v = env[`VITE_FEATURE_${name}`];
  return v === undefined ? fallback : v === "true";
};

export const features = {
  videoFeedback: flag("VIDEO_FEEDBACK", false),
  audioFeedback: flag("AUDIO_FEEDBACK", false),
  leaderboard: flag("LEADERBOARD", false),
  streakFreeze: flag("STREAK_FREEZE", false),
} as const;

/**
 * Razorpay payment links for the pricing test (create them in the Razorpay
 * dashboard; set the URLs in .env). Packs without a link are hidden.
 */
export const creditPacks = [
  { id: "starter", credits: 5, price: 99, url: env.VITE_PAYMENT_LINK_5 },
  { id: "standard", credits: 10, price: 199, url: env.VITE_PAYMENT_LINK_10 },
  { id: "serious", credits: 30, price: 499, url: env.VITE_PAYMENT_LINK_30 },
].filter((p) => !!p.url);

/** Shown in the buy dialog: how fast credits land after payment. */
export const creditTopUpPromise = env.VITE_CREDIT_TOPUP_PROMISE ?? "within 2 hours (8am-11pm)";
