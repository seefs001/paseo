/** J and K step through items while the detail is open; native has no hardware keys to read. */
export function useDetailKeys(_input: {
  enabled: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
}): void {}
