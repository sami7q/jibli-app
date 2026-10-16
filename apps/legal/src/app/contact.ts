/**
 * How a person reaches Jibli from these pages, in one place.
 *
 * Both values come from the Vercel project's environment, so a mailbox or a
 * number changes with a redeploy from the dashboard rather than a commit — and
 * a push to `main` here also rebuilds the API, which is the expensive part.
 *
 *   NEXT_PUBLIC_CONTACT_EMAIL   the address that answers privacy and deletion
 *                               requests. It must receive mail: this is the
 *                               only route the deletion page offers someone who
 *                               has lost the phone their account is on, and
 *                               Play reads it as the developer's contact.
 *   NEXT_PUBLIC_SUPPORT_PHONE   optional; the app's own support number,
 *                               +964 form, shown beside the address when set.
 *
 * The fallback is the address these pages have always shown. `jibli.iq` had no
 * DNS at all on 2026-10-16 (NXDOMAIN), so until the variable is set, mail to
 * it bounces — set NEXT_PUBLIC_CONTACT_EMAIL before either store submission.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'privacy@jibli.iq';

export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || null;
