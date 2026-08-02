import { Link } from "@tanstack/react-router";
import { Crown, HardDrive, LogIn, LogOut, User } from "lucide-react";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useI18n } from "@/lib/i18n";
import type { Entitlements } from "@/lib/billing/plans";
import { isLocalMode } from "@/lib/local-mode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AccountMenu({
  entitlements,
  onUpgrade,
  isGod,
  viewAs,
  dense = false,
}: {
  entitlements?: Entitlements;
  onUpgrade?: () => void;
  isGod?: boolean;
  viewAs?: string;
  dense?: boolean;
}) {
  const { t, lang } = useI18n();
  const { user, isPending } = useCurrentUserState();
  const localMode = isLocalMode();

  if (localMode) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-teal/35 bg-teal/10 text-teal"
        title={
          lang === "es"
            ? "Modo local · alertas y datos en este dispositivo"
            : "Local mode · alerts & data on this device"
        }
      >
        <HardDrive className="size-3" />
        {lang === "es" ? "Local · Pro" : "Local · Pro"}
      </Badge>
    );
  }

  if (!authEnabled) {
    return (
      <Badge variant="outline" className="text-muted-fg">
        {t.accountGuest}
      </Badge>
    );
  }

  if (isPending) {
    return (
      <span className="text-xs text-muted-fg animate-pulse">
        {t.accountLoading}
      </span>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        {onUpgrade && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden gap-1 text-xs sm:inline-flex"
            onClick={onUpgrade}
          >
            <Crown className="size-3.5 text-rank1" />
            Trial
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/login" search={{}}>
            <LogIn className="size-3.5" />
            {t.accountSignIn}
          </Link>
        </Button>
      </div>
    );
  }

  const label = user.displayName ?? user.primaryEmail ?? t.accountTitle;
  const plan = entitlements?.plan ?? "free";
  let planLabel =
    plan === "pro"
      ? "Pro"
      : plan === "trial"
        ? lang === "es"
          ? `Trial ${entitlements?.trialDaysLeft ?? ""}d`
          : `Trial ${entitlements?.trialDaysLeft ?? ""}d`
        : "Free";
  let planClass =
    plan === "pro"
      ? "bg-rank1/20 text-rank1 border-rank1/30"
      : plan === "trial"
        ? "bg-teal/15 text-teal border-teal/30"
        : "bg-muted text-muted-fg border-border";
  if (isGod) {
    if (viewAs === "god") {
      planLabel = "GOD";
      planClass = "bg-rank1/25 text-rank1 border-rank1/40";
    } else if (viewAs === "pro") {
      planLabel = "Pro";
      planClass = "bg-primary/20 text-primary border-primary/30";
    } else if (viewAs === "free") {
      planLabel = "Free QA";
      planClass = "bg-muted text-muted-fg border-border";
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 sm:gap-2",
        dense ? "w-full max-w-none" : "max-w-[min(100%,20rem)]",
      )}
    >
      <button
        type="button"
        onClick={onUpgrade}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-xl border border-border/80 bg-card/90 text-left transition-colors hover:border-teal/40",
          dense ? "flex-1 px-2.5 py-2" : "px-1.5 py-1 sm:px-2",
        )}
        title={label}
      >
        {user.profileImageUrl ? (
          <img
            src={user.profileImageUrl}
            alt=""
            className={cn(
              "shrink-0 rounded-full object-cover",
              dense ? "size-9" : "size-7",
            )}
          />
        ) : (
          <span
            className={cn(
              "grid shrink-0 place-items-center rounded-full bg-teal/15 font-semibold text-teal",
              dense ? "size-9 text-sm" : "size-7 text-xs",
            )}
          >
            {(label.trim()[0] || "U").toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "font-semibold leading-tight text-foreground",
              dense
                ? "max-w-none truncate text-sm sm:text-sm"
                : "max-w-[9rem] truncate text-[11px] sm:max-w-[10rem] sm:text-xs sm:font-medium",
            )}
          >
            {label}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge
              className={cn(
                "h-4 border px-1.5 text-[9px] font-semibold",
                planClass,
              )}
            >
              {planLabel}
            </Badge>
            {user.primaryEmail && dense && (
              <span className="truncate text-[10px] text-muted-fg">
                {user.primaryEmail}
              </span>
            )}
          </div>
        </div>
        {!dense && <User className="hidden size-3.5 shrink-0 text-muted-fg sm:block" />}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "shrink-0 gap-1 text-xs text-muted-fg",
          dense ? "h-10 px-3" : "px-2",
        )}
        onClick={() => void signOut()}
        title={t.accountSignOut}
      >
        <LogOut className="size-3.5" />
        <span className={dense ? "inline" : "sr-only sm:not-sr-only sm:inline"}>
          {t.accountSignOut}
        </span>
      </Button>
    </div>
  );
}
