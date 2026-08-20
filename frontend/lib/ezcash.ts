export function validatePhone(raw: string): { valid: boolean; normalized: string; error?: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("07") && digits.length === 10) {
    return { valid: true, normalized: "+94" + digits.slice(1) };
  }
  if (digits.startsWith("947") && digits.length >= 11) {
    return { valid: true, normalized: "+94" + digits.slice(2) };
  }
  if (digits.startsWith("7") && digits.length === 9) {
    return { valid: true, normalized: "+94" + digits };
  }
  return { valid: false, normalized: "", error: "Use 07XXXXXXXX or +947XXXXXXXX" };
}
