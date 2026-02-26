/**
 * Dialog - Simple modal dialog component
 */

import { X } from "lucide-react";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => onOpenChange(false)}
    >
      {/* Backdrop - increased opacity for better distinction */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Dialog Content - enhanced shadow and border with card background for better contrast */}
      <div
        className="relative z-10 bg-card rounded-lg shadow-2xl border-2 border-border max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
  return <div className={className || "overflow-auto max-h-[90vh]"}>{children}</div>;
}

interface DialogHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export function DialogHeader({ children, onClose, className }: DialogHeaderProps) {
  return (
    <div className={className || "sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between z-10"}>
      {children}
      {onClose && (
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogTitle({ children, className }: DialogTitleProps) {
  return <h2 className={className || "text-lg font-semibold"}>{children}</h2>;
}
