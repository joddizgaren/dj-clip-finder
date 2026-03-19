import { useState, useEffect } from "react";
import { Music2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

interface LoginPageProps {
  onLoginSuccess: () => void;
  /** djclipstudio:// URL received from a password-recovery email link */
  recoveryUrl?: string;
  /** Called after the recovery flow finishes so the parent can clear the URL */
  onRecoveryHandled?: () => void;
}

type Mode = "signin" | "forgot" | "reset";

function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Email or password is incorrect. Please try again.";
  }
  if (lower.includes("banned") || lower.includes("disabled")) {
    return "Account disabled. Contact support.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please check your email inbox and confirm your account first.";
  }
  if (lower.includes("too many requests") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Connection error. Please check your internet and try again.";
  }
  if (lower.includes("same password")) {
    return "Please choose a different password than your current one.";
  }
  return "Something went wrong. Please try again.";
}

/** Parse tokens out of a djclipstudio://auth/callback#… URL */
function parseRecoveryUrl(url: string): { accessToken: string; refreshToken: string } | null {
  try {
    // The hash portion contains access_token=...&refresh_token=...&type=recovery
    const hashIndex = url.indexOf("#");
    if (hashIndex === -1) return null;
    const params = new URLSearchParams(url.slice(hashIndex + 1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if (!accessToken || !refreshToken || type !== "recovery") return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

export default function LoginPage({
  onLoginSuccess,
  recoveryUrl,
  onRecoveryHandled,
}: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // When a recovery URL arrives, switch to reset mode and set the session.
  useEffect(() => {
    if (!recoveryUrl || !supabase) return;

    const tokens = parseRecoveryUrl(recoveryUrl);
    if (!tokens) {
      setError("Invalid or expired recovery link. Please request a new one.");
      setMode("forgot");
      return;
    }

    setMode("reset");
    setError(null);
    setLoading(true);

    supabase.auth
      .setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError("Recovery link has expired. Please request a new one.");
          setMode("forgot");
        }
      })
      .catch(() => {
        setError("Recovery link has expired. Please request a new one.");
        setMode("forgot");
      })
      .finally(() => setLoading(false));
  }, [recoveryUrl]);

  // ── Sign in ────────────────────────────────────────────────────────────────

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) { setError(friendlyError(signInError.message)); return; }

      const { error: userError } = await supabase.auth.getUser();
      if (userError) {
        setError(friendlyError(userError.message));
        await supabase.auth.signOut();
        return;
      }
      onLoginSuccess();
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // ── Forgot password ────────────────────────────────────────────────────────

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: "djclipstudio://auth/callback" }
      );
      if (resetError) { setError(friendlyError(resetError.message)); return; }
      setInfo("Check your email for a recovery link. Click it to set a new password.");
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // ── Reset password ─────────────────────────────────────────────────────────

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(friendlyError(updateError.message)); return; }
      await supabase.auth.signOut();
      onRecoveryHandled?.();
      setMode("signin");
      setPassword("");
      setConfirmPassword("");
      setInfo("Password updated! Sign in with your new password.");
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-lg">
            <Music2 className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              DJ Clip Studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "signin" && "Sign in to continue"}
              {mode === "forgot" && "Reset your password"}
              {mode === "reset" && "Set a new password"}
            </p>
          </div>
        </div>

        {/* Sign In */}
        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                data-testid="input-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                autoComplete="email"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                data-testid="input-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            {info && (
              <div className="flex items-start gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{info}</span>
              </div>
            )}
            {error && (
              <div
                data-testid="login-error"
                className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              data-testid="button-signin"
              type="submit"
              className="w-full"
              disabled={loading || !email || !password}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in…</> : "Sign In"}
            </Button>

            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}
            >
              Forgot your password?
            </button>
          </form>
        )}

        {/* Forgot password */}
        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                data-testid="input-forgot-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                autoComplete="email"
                autoFocus
              />
            </div>

            {info && (
              <div className="flex items-start gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{info}</span>
              </div>
            )}
            {error && (
              <div
                data-testid="forgot-error"
                className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              data-testid="button-send-recovery"
              type="submit"
              className="w-full"
              disabled={loading || !email}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : "Send Recovery Link"}
            </Button>

            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
            >
              Back to sign in
            </button>
          </form>
        )}

        {/* Reset password */}
        {mode === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            {loading && (
              <div className="flex justify-center py-2">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                data-testid="input-new-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                data-testid="input-confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div
                data-testid="reset-error"
                className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              data-testid="button-set-password"
              type="submit"
              className="w-full"
              disabled={loading || !password || !confirmPassword}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating…</> : "Set New Password"}
            </Button>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Don't have an account? Ask the app owner to invite you.
        </p>
      </div>
    </div>
  );
}
