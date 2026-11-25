import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { AuthChangeEvent, User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type Result = { error: Error | null };

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** The last auth event; PASSWORD_RECOVERY means the user arrived from a reset link. */
  lastEvent: AuthChangeEvent | null;
  /** needsConfirmation: account created, but the user must click the emailed link first. */
  signUp: (email: string, password: string, fullName?: string) => Promise<Result & { needsConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<Result>;
  signInWithGoogle: () => Promise<Result>;
  sendPasswordReset: (email: string) => Promise<Result>;
  updatePassword: (password: string) => Promise<Result>;
  resendConfirmation: (email: string) => Promise<Result>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const origin = () => window.location.origin;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastEvent, setLastEvent] = useState<AuthChangeEvent | null>(null);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setLastEvent(event);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp: AuthContextType['signUp'] = async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin()}/dashboard`,
        data: { full_name: fullName },
      },
    });
    return { error: error as Error | null, needsConfirmation: !error && !data.session };
  };

  const signIn: AuthContextType['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signInWithGoogle: AuthContextType['signInWithGoogle'] = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin()}/dashboard`, queryParams: { prompt: 'select_account' } },
    });
    return { error: error as Error | null };
  };

  const sendPasswordReset: AuthContextType['sendPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin()}/reset-password` });
    return { error: error as Error | null };
  };

  const updatePassword: AuthContextType['updatePassword'] = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error as Error | null };
  };

  const resendConfirmation: AuthContextType['resendConfirmation'] = async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${origin()}/dashboard` } });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, lastEvent, signUp, signIn, signInWithGoogle, sendPasswordReset, updatePassword, resendConfirmation, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
