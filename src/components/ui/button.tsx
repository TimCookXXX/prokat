import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Brackets } from "@/components/brand/Brackets";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // Главное действие экрана — единственная оранжевая кнопка.
        cta: "bg-cta text-cta-foreground hover:bg-cta/90",
        outline: "border border-border-strong bg-card hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-11 px-4 py-2 min-w-11",
        sm: "h-9 px-3 min-w-9",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  // pending: показать spinner перед children и задизаблить кнопку. Универсальный
  // visual-feedback для async-операций (signOut, publish, form submit). Не
  // совместим с asChild (Slot ожидает ровно одного child'а).
  pending?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, pending = false, disabled, children, ...props }, ref) => {
    // asChild → Radix Slot ждёт ровно одного React-child'а, поэтому spinner туда
    // не вкладываем (asChild используется для <Link>-обёрток, где pending обычно
    // не нужен — навигация ловится глобальным NextTopLoader'ом).
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || pending}
        {...props}
      >
        {pending && <Brackets size={14} running className="mr-2 text-current" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
