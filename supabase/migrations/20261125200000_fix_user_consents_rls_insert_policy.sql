-- user_consents had SELECT policy but no INSERT policy.
-- record_consent() is SECURITY INVOKER, so the INSERT was blocked by RLS.
CREATE POLICY "users can insert own consent"
  ON user_consents FOR INSERT
  WITH CHECK (auth.uid() = user_id);
