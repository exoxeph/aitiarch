// Best effort only: limitations and the mandatory preview are documented in the design.
// Shared with display-only UI; keep the provider's existing redaction unchanged.
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[PRIVATE_KEY]')
    .replace(/\b(authorization\s*:\s*)(?:bearer\s+|basic\s+)?[^\r\n]+/gi, '$1[SECRET]')
    .replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"',;]+/gi, '$1=[SECRET]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,})/g, '[TOKEN]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[CREDENTIALS]@')
    .replace(/[A-Za-z]:\\Users\\[^\s"'<>]+|\/(?:Users|home)\/[^\s"'<>]+/g, '[USER_PATH]');
}
