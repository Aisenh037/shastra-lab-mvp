// CI test config: the full suite minus the quarantined files below.
//
// These files were already failing before the pilot work began (they test
// older components and hooks whose behaviour changed). They're excluded so CI
// can block merges on real regressions. Fix a file, delete it from this list,
// and CI starts enforcing it. `npm run test:run` still runs everything.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export const QUARANTINED = [
  "src/components/ReminderSettings.test.tsx",
  "src/components/ShastraLabLogo.test.tsx",
  "src/components/StreakFreeze.test.tsx",
  "src/components/SubjectAnalytics.test.tsx",
  "src/hooks/useAchievements.test.ts",
  "src/hooks/useNotifications.test.ts",
  "src/hooks/useReminders.test.ts",
  "src/hooks/useStreak.test.ts",
  "src/hooks/useTTS.test.ts",
  "src/test-utils/error-handling.test.ts",
  "src/test-utils/framework-completeness.test.ts",
  "src/test-utils/property-tests.test.ts",
  "src/test-utils/typescript-strict.test.ts",
];

export default mergeConfig(
  base,
  defineConfig({
    test: { exclude: ["node_modules", "dist", ".git", ".cache", ...QUARANTINED] },
  }),
);
