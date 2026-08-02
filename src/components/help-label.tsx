import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Label with hover tooltip: short description + usage guide. */
export function HelpLabel({
  htmlFor,
  children,
  title,
  description,
  usage,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  title: string;
  description: string;
  usage: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Label
          htmlFor={htmlFor}
          className={cn(
            "inline-flex w-fit cursor-help items-center gap-1 border-b border-dotted border-muted-fg/50",
            className,
          )}
        >
          {children}
        </Label>
      </TooltipTrigger>
      <TooltipContent side="top" className="space-y-1.5">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-muted-fg">{description}</p>
        <p className="border-t border-border pt-1.5 text-muted-fg">{usage}</p>
      </TooltipContent>
    </Tooltip>
  );
}
