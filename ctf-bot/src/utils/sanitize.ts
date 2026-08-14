/**
 * Strips Discord markdown/mention control sequences that could be abused to
 * ping @everyone, mask links, or break embed formatting when echoing
 * user-supplied input (challenge name, description, prize, etc.) back into
 * an embed.
 */
export function sanitizeText(input: string, maxLength = 300): string {
  return input
    .replace(/@(everyone|here)/g, "@\u200b$1") // neutralize mass pings
    .replace(/<@&?\d+>/g, "") // strip raw mention/role syntax
    .replace(/```/g, "'''") // prevent breaking out of code blocks in embeds
    .trim()
    .slice(0, maxLength);
}

/** Validates that a URL looks like a plausible http(s) link. */
export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
