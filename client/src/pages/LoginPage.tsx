import { useState } from "react";
import { Music2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

interface LoginPageProps {
  onLoginSuccess: () => void;
  initialError?: string;
}

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
  return "Something went wrong. Please try again.";
}

export default function LoginPage({ onLoginSuccess, initialError }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(friendlyError(signInError.message));
        return;
      }

      // Confirm the user is not banned by re-fetching from the server
      const { error: userError } = await supabase.auth.getUser();
      if (userError) {
        setError(friendlyError(userError.message));
        await supabase.auth.signOut();
        return;
      }

      onLoginSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(friendlyError(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-lg">
            <Music2 className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              DJ Clip Studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to continue
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Don't have an account? Ask the app owner to invite you.
        </p>
      </div>
    </div>
  );
}
