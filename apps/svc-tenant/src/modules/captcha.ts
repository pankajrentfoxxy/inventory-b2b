/** Captcha verification for the public application form. `none` accepts everything (dev/test). */
export interface CaptchaVerifier {
  verify(token: string | undefined, ip: string | null): Promise<{ ok: boolean; score: number | null }>;
}

export const noCaptcha: CaptchaVerifier = { verify: async () => ({ ok: true, score: null }) };

/** Cloudflare Turnstile siteverify. */
export function turnstileCaptcha(secret: string, fetchImpl: typeof fetch = fetch): CaptchaVerifier {
  return {
    async verify(token, ip) {
      if (!token) return { ok: false, score: null };
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }),
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await res.json()) as { success: boolean };
      return { ok: Boolean(body.success), score: body.success ? 1 : 0 };
    },
  };
}
