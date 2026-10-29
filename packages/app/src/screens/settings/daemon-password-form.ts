export function passwordDraftError(password: string, confirm: string): "empty" | "mismatch" | null {
  if (password.length === 0) return "empty";
  if (password !== confirm) return "mismatch";
  return null;
}
