import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { GraduationCap, PenLine, Target, TrendingUp, MailCheck, ArrowLeft } from "lucide-react";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useNavigate } from "react-router-dom";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { authErrorFromUrl, friendlyAuthError, MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/auth-messages";

const emailSchema = z.string().trim().email("Enter a valid email address");

type View = { kind: "tabs" } | { kind: "forgot" } | { kind: "check-email"; email: string; reason: "signup" | "reset" };

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading, signIn, signUp, signInWithGoogle, sendPasswordReset, resendConfirmation } = useAuth();
  const [view, setView] = useState<View>({ kind: "tabs" });
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (user && !loading) navigate("/dashboard");
  }, [user, loading, navigate]);

  // An expired or reused email link lands here with the error in the URL.
  useEffect(() => {
    const problem = authErrorFromUrl(window.location.href);
    if (problem) {
      toast.error(problem);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const validEmail = (email: string) => {
    const r = emailSchema.safeParse(email);
    if (!r.success) toast.error(r.error.errors[0].message);
    return r.success ? r.data : null;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = validEmail(loginEmail);
    if (!email) return;
    if (!loginPassword) return toast.error("Enter your password");

    setIsLoading(true);
    const { error } = await signIn(email, loginPassword);
    setIsLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) setUnconfirmedEmail(email);
      toast.error(friendlyAuthError(error.message));
    } else {
      toast.success("Welcome back!");
      navigate("/dashboard");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = validEmail(signupEmail);
    if (!email) return;
    const problem = passwordProblem(signupPassword, email);
    if (problem) return toast.error(problem);
    if (signupPassword !== confirmPassword) return toast.error("Passwords do not match");
    if (!consented) return toast.error("Please confirm you are 18+ and accept the Terms and Privacy Policy");

    setIsLoading(true);
    const { error, needsConfirmation } = await signUp(email, signupPassword, signupName.trim() || undefined);
    setIsLoading(false);

    if (error) return toast.error(friendlyAuthError(error.message));
    if (needsConfirmation) {
      setView({ kind: "check-email", email, reason: "signup" });
    } else {
      toast.success("Account created. Your first evaluation is free.");
      navigate("/dashboard");
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = validEmail(resetEmail);
    if (!email) return;
    setIsLoading(true);
    const { error } = await sendPasswordReset(email);
    setIsLoading(false);
    // Same screen whether or not the account exists, so the form can't be used to probe emails.
    if (error && /rate limit|too many/i.test(error.message)) return toast.error(friendlyAuthError(error.message));
    setView({ kind: "check-email", email, reason: "reset" });
  };

  const handleResend = async (email: string) => {
    setIsLoading(true);
    const { error } = await resendConfirmation(email);
    setIsLoading(false);
    if (error) toast.error(friendlyAuthError(error.message));
    else toast.success("Sent. Check your inbox and spam folder.");
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast.error(
        error.message.toLowerCase().includes("provider is not enabled")
          ? "Google sign-in isn't available yet. Use email for now."
          : "Couldn't connect to Google. Please try again.",
      );
      setIsGoogleLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const googleButton = (label: string) => (
    <>
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or</span>
        </div>
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={isGoogleLoading}>
        <GoogleIcon />
        {isGoogleLoading ? "Connecting..." : label}
      </Button>
      <p className="text-xs text-muted-foreground text-center mt-3">
        By continuing you agree to our <Link to="/terms" className="underline">Terms</Link> and{" "}
        <Link to="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-hero items-center justify-center p-12">
        <div className="max-w-md text-primary-foreground animate-fade-in">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-primary-foreground/10 rounded-xl">
              <GraduationCap className="h-10 w-10" />
            </div>
            <h1 className="text-3xl font-display font-bold">ShastraLab</h1>
          </div>

          <h2 className="text-4xl font-display font-bold mb-6 leading-tight">Write better UPSC Mains answers, every day</h2>

          <p className="text-lg text-primary-foreground/80 mb-10">
            Examiner-style marks and feedback in minutes, checked against what each question actually demands.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-primary-foreground/10 rounded-lg">
              <PenLine className="h-6 w-6 flex-shrink-0" />
              <span>Type your answer or upload a photo of your handwritten sheet</span>
            </div>
            <div className="flex items-center gap-4 p-4 bg-primary-foreground/10 rounded-lg">
              <Target className="h-6 w-6 flex-shrink-0" />
              <span>See which points you covered and which you missed</span>
            </div>
            <div className="flex items-center gap-4 p-4 bg-primary-foreground/10 rounded-lg">
              <TrendingUp className="h-6 w-6 flex-shrink-0" />
              <span>Track your recurring weak spots across answers</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Auth Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Card className="w-full max-w-md border-0 shadow-lg animate-scale-in">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4 lg:hidden">
              <GraduationCap className="h-8 w-8 text-primary" />
              <span className="text-xl font-display font-bold">ShastraLab</span>
            </div>
            {view.kind === "tabs" && (
              <>
                <CardTitle className="text-2xl font-display">Welcome</CardTitle>
                <CardDescription>Sign in, or create an account. Your first evaluation is free.</CardDescription>
              </>
            )}
            {view.kind === "forgot" && (
              <>
                <CardTitle className="text-2xl font-display">Reset your password</CardTitle>
                <CardDescription>We'll email you a link to set a new one.</CardDescription>
              </>
            )}
            {view.kind === "check-email" && (
              <>
                <MailCheck className="mx-auto mb-2 h-10 w-10 text-primary" />
                <CardTitle className="text-2xl font-display">Check your inbox</CardTitle>
                <CardDescription>
                  {view.reason === "signup" ? (
                    <>We sent a confirmation link to <strong>{view.email}</strong>. Click it to start practising.</>
                  ) : (
                    <>If an account exists for <strong>{view.email}</strong>, a reset link is on its way. It works once and expires in an hour.</>
                  )}
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent>
            {view.kind === "check-email" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Not there after a minute? Check spam or promotions.</p>
                {view.reason === "signup" && (
                  <Button variant="outline" className="w-full" disabled={isLoading} onClick={() => handleResend(view.email)}>
                    {isLoading ? "Sending..." : "Send the link again"}
                  </Button>
                )}
                <Button variant="ghost" className="w-full" onClick={() => setView({ kind: "tabs" })}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                </Button>
              </div>
            )}

            {view.kind === "forgot" && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" autoComplete="email" placeholder="you@gmail.com" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Sending..." : "Email me a reset link"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setView({ kind: "tabs" })}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                </Button>
              </form>
            )}

            {view.kind === "tabs" && (
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Sign In</TabsTrigger>
                  <TabsTrigger value="signup">Sign Up</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input id="login-email" type="email" autoComplete="email" placeholder="you@gmail.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="login-password">Password</Label>
                        <button
                          type="button"
                          className="text-xs text-primary underline-offset-4 hover:underline"
                          onClick={() => {
                            setResetEmail(loginEmail);
                            setView({ kind: "forgot" });
                          }}
                        >
                          Forgot password?
                        </button>
                      </div>
                      <Input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                    </div>
                    {unconfirmedEmail && (
                      <Button type="button" variant="secondary" className="w-full" disabled={isLoading} onClick={() => handleResend(unconfirmedEmail)}>
                        Resend confirmation email
                      </Button>
                    )}
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? "Signing in..." : "Sign In"}
                    </Button>
                    {googleButton("Continue with Google")}
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name</Label>
                      <Input id="signup-name" type="text" autoComplete="name" placeholder="Your name" value={signupName} onChange={(e) => setSignupName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input id="signup-email" type="email" autoComplete="email" placeholder="you@gmail.com" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <Input id="signup-password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirm Password</Label>
                      <Input id="confirm-password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                    </div>
                    <label className="flex items-start gap-3 text-sm">
                      <Checkbox checked={consented} onCheckedChange={(v) => setConsented(v === true)} aria-label="I am 18 or older and accept the Terms and Privacy Policy" className="mt-0.5" />
                      <span className="text-muted-foreground">
                        I'm 18 or older and agree to the{" "}
                        <Link to="/terms" target="_blank" className="text-primary underline">Terms</Link> and{" "}
                        <Link to="/privacy" target="_blank" className="text-primary underline">Privacy Policy</Link>, including that my
                        answers are sent to AI providers to be evaluated.
                      </span>
                    </label>
                    <Button type="submit" className="w-full" disabled={isLoading || !consented}>
                      {isLoading ? "Creating account..." : "Create Account"}
                    </Button>
                    {googleButton("Sign up with Google")}
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
        <div className="mt-6 flex justify-center">
          <LegalFooter compact />
        </div>
      </div>
    </div>
  );
}
