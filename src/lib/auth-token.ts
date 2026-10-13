/** Cookie value for the optional TIMU_PASSWORD gate: SHA-256 of the password (works in Edge and Node). */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`timu:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const AUTH_COOKIE = "timu_session";
