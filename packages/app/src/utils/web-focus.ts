interface FocusWithRetriesOptions {
  focus: () => void;
  isFocused: () => boolean;
  shouldFocus?: () => boolean;
  deferInitialAttempt?: boolean;
  timeoutMs?: number;
  onSuccess?: () => void;
  onTimeout?: () => void;
}

export function focusWithRetries({
  focus,
  isFocused,
  shouldFocus,
  deferInitialAttempt = false,
  timeoutMs = 1500,
  onSuccess,
  onTimeout,
}: FocusWithRetriesOptions): () => void {
  let cancelled = false;
  const deadlineMs = Date.now() + timeoutMs;

  const tick = () => {
    if (cancelled || shouldFocus?.() === false) return;

    try {
      focus();
    } catch {
      // ignore
    }

    if (isFocused()) {
      onSuccess?.();
      return;
    }

    if (Date.now() >= deadlineMs) {
      onTimeout?.();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(tick);
    });
  };

  if (deferInitialAttempt) {
    requestAnimationFrame(tick);
  } else {
    tick();
  }

  return () => {
    cancelled = true;
  };
}
