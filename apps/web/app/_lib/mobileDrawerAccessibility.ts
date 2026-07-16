type FocusTarget = {
  focus: (options?: FocusOptions) => void;
};

type ContainmentTarget = {
  contains: (target: Node | null) => boolean;
};

type BackgroundTarget = {
  inert?: boolean;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

export function focusMobileDrawer(
  closeButton: FocusTarget | null | undefined,
  panel: FocusTarget | null | undefined
): void {
  const target = closeButton ?? panel;
  target?.focus({ preventScroll: true });
}

export function restoreMobileDrawerTriggerFocus(trigger: FocusTarget | null | undefined): void {
  trigger?.focus({ preventScroll: true });
}

export function shouldRedirectFocusToDrawer(panel: ContainmentTarget | null | undefined, target: unknown): boolean {
  if (!panel || !target) return true;
  return !panel.contains(target as Node);
}

export function isolateMobileDrawerBackground(background: BackgroundTarget | null | undefined): () => void {
  if (!background) return () => {};

  const supportsInert = "inert" in background;
  const previousInert = background.inert === true;
  const hadAriaHidden = background.hasAttribute("aria-hidden");
  const previousAriaHidden = background.getAttribute("aria-hidden");

  if (supportsInert) {
    background.inert = true;
  } else {
    background.setAttribute("aria-hidden", "true");
  }

  return () => {
    if (supportsInert) {
      background.inert = previousInert;
    }

    if (!supportsInert) {
      if (hadAriaHidden && previousAriaHidden !== null) {
        background.setAttribute("aria-hidden", previousAriaHidden);
      } else {
        background.removeAttribute("aria-hidden");
      }
    }
  };
}
