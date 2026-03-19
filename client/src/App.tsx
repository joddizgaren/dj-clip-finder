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

type AuthState = "checking" | "authenticated" | "unauthenticated";

// ─── Update banner ─────────────────────────────────────────────────────────────

function UpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    const api = (window as any).electronAPI;
    api.onUpdateDownloaded(() => setUpdateReady(true));
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div
      data-testid="update-banner"
      className="flex items-center justify-between gap-3 bg-primary text-primary-foreground px-4 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 shrink-0" />
        <span>A new version is ready.</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          data-testid="button-restart-update"
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => (window as any).electronAPI.installUpdate()}
        >
          Restart to install
        </Button>
        <button
          data-testid="button-dismiss-update"
          onClick={() => setDismissed(true)}
          className="opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss update notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

interface AppShellProps {
  onSignOut?: () => void;
}

function AppShell({ onSignOut }: AppShellProps) {
  return (
    <>
      <UpdateBanner />
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <Music2 className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-foreground">DJ Clip Studio</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isElectron() && onSignOut && (
            <Button
              data-testid="button-signout"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={onSignOut}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="text-xs">Sign out</span>
            </Button>
          )}
        </div>
      </header>
      <Router />
      <Toaster />
    </>
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>(
    isElectron() ? "checking" : "authenticated"
  );

  useEffect(() => {
    if (!isElectron() || !supabase) {
      setAuthState("authenticated");
      return;
    }

    // Validate existing session against Supabase on every launch
    supabase.auth.getUser().then(({ data, error }) => {
      if (data?.user && !error) {
        setAuthState("authenticated");
      } else {
        // Clear any stale local session
        supabase!.auth.signOut().finally(() => setAuthState("unauthenticated"));
      }
    });
  }, []);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthState("unauthenticated");
  }

  if (authState === "checking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm">Starting…</span>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return <LoginPage onLoginSuccess={() => setAuthState("authenticated")} />;
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
