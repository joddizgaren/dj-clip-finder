import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import LoginPage from "@/pages/LoginPage";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Music2, Loader2, RefreshCw, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase, isElectron } from "@/lib/supabase";
import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthState = "checking" | "authenticated" | "unauthenticated" | "disabled";

// ─── App shell with update banner ─────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

interface AppShellProps {
  onSignOut: () => void;
}

function AppShell({ onSignOut }: AppShellProps) {
  const [updateState, setUpdateState] = useState<"idle" | "downloading" | "ready">("idle");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    const unsubAvail    = window.electronAPI!.onUpdateAvailable(() => setUpdateState("downloading"));
    const unsubDownload = window.electronAPI!.onUpdateDownloaded(() => setUpdateState("ready"));
    return () => { unsubAvail(); unsubDownload(); };
  }, []);

  const showBanner = updateState !== "idle" && !bannerDismissed;

  return (
    <div className={showBanner ? "pt-9" : undefined}>
      {showBanner && (
        <div
          data-testid="update-banner"
          className="fixed inset-x-0 top-0 z-[60] flex h-9 items-center justify-between gap-3 bg-primary px-4 text-sm text-primary-foreground"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 shrink-0 ${updateState === "downloading" ? "animate-spin" : ""}`} />
            <span>{updateState === "ready" ? "A new version is ready." : "Downloading update…"}</span>
          </div>
          <div className="flex items-center gap-2">
            {updateState === "ready" && (
              <Button
                data-testid="button-restart-update"
                size="sm"
                variant="secondary"
                className="h-6 text-xs"
                onClick={() => window.electronAPI!.installUpdate()}
              >
                Restart to install
              </Button>
            )}
            <button
              data-testid="button-dismiss-update"
              onClick={() => setBannerDismissed(true)}
              className="opacity-70 transition-opacity hover:opacity-100"
              aria-label="Dismiss update notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary">
            <Music2 className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-foreground">DJ Clip Studio</span>
          <span className="text-xs text-muted-foreground/60">v1.0.4</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isElectron() && (
            <Button
              data-testid="button-signout"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={onSignOut}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="text-xs">Sign out</span>
            </Button>
          )}
        </div>
      </header>

      <Router />
      <Toaster />
    </div>
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

function isBannedError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("banned") || lower.includes("disabled");
}

function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>(
    isElectron() ? "checking" : "authenticated"
  );
  // Holds a djclipstudio:// deep-link URL when the app is opened via one
  // (e.g. a Supabase password-recovery email link).
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isElectron() || !supabase) {
      setAuthState("authenticated");
      return;
    }

    supabase.auth.getUser().then(({ data, error }) => {
      if (data.user && !error) {
        setAuthState("authenticated");
      } else if (error && isBannedError(error.message)) {
        supabase!.auth.signOut().finally(() => setAuthState("disabled"));
      } else {
        supabase!.auth.signOut().finally(() => setAuthState("unauthenticated"));
      }
    });
  }, []);

  // Listen for deep links from the main process (password recovery flow).
  useEffect(() => {
    if (!isElectron() || !window.electronAPI?.onDeepLink) return;
    const unsub = window.electronAPI.onDeepLink((url) => {
      // Any deep link takes us to the login page in recovery mode.
      setAuthState("unauthenticated");
      setRecoveryUrl(url);
    });
    return unsub;
  }, []);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthState("unauthenticated");
  }

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Starting…</span>
        </div>
      </div>
    );
  }

  if (authState === "disabled") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <Music2 className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Account disabled</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Account disabled. Contact support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <LoginPage
        onLoginSuccess={() => {
          setRecoveryUrl(null);
          setAuthState("authenticated");
        }}
        recoveryUrl={recoveryUrl ?? undefined}
        onRecoveryHandled={() => setRecoveryUrl(null)}
      />
    );
  }

  return <AppShell onSignOut={handleSignOut} />;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
