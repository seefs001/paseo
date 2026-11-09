import { useEffect, useState, useSyncExternalStore } from "react";

interface FormModel<S> {
  getState: () => S;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
}

type FormState<M> = M extends FormModel<infer S> ? S : never;

// Opens a form model once per mount, closes it on unmount, and renders its state.
export function useFormModel<M extends FormModel<unknown>>(
  open: () => M,
): { model: M; state: FormState<M> } {
  const [model] = useState(open);
  useEffect(() => () => model.close(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  return { model, state: state as FormState<M> };
}
