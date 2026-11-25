-- Security advisor fixes.
-- 1. Fixed search_path on free_trial_credits.
-- 2. Nobody needs to call these without signing in; the trigger function
--    handle_new_user should not be callable through the API at all.
--    (has_role stays executable by signed-in users: RLS policies call it.)

ALTER FUNCTION public.free_trial_credits() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.check_achievements(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_achievements(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_rank(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_streak(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recover_streak(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_practice_streak(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_achievements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_achievements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rank(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_streak(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_streak(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_practice_streak(uuid) TO authenticated;
