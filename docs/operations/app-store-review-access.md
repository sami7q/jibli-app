# App Store review access — «App Review Information»

The Apple counterpart of `google-play-review-access.md`. The accounts are the
same three — one review customer with a fixed code, one review shop owner,
one review courier, all created by `pnpm review:provision` — so create them
once and give both stores the same values. Every value here is a placeholder;
the real ones live in the Render dashboard, the two consoles and a password
manager.

Checked against the code on 16 October 2026.

## Before the first upload

1. **App record.** App Store Connect → My Apps → + → New App: platform iOS,
   name «جيبلي Jibli — توصيل طعام» (see `store-submission.md` for the listing
   names), primary language Arabic, bundle id `iq.jibli.app`, SKU of your
   choice (e.g. `jibli-ios-001`), category Food & Drink.
2. **Signing and push.** `cd apps/mobile && eas credentials -p ios` and let EAS
   create the distribution certificate, the provisioning profile and the APNs
   key. A store build writes `aps-environment = production`
   (`expo-notifications` `mode` in `app.config.ts`), so the key must be a
   production APNs key — EAS creates one that covers both.
3. **The API must be awake.** `jibli-api` is on `0.5c-512mb` in `render.yaml`;
   check the dashboard agrees before submitting. On the free plan the first
   request took 23 s on 2026-10-16, past the app's 15 s read timeout.
4. **Content the reviewer will see.** Production must hold no sample shop
   (migration 0024 retires them) and at least the review market. Check the
   home screen in Baghdad from a guest session the day you submit.

## App Review Information — what goes in each field

**Sign-in required:** Yes.

**User name:** `<GOOGLE_PLAY_REVIEW_PHONE>` without `+964` (e.g. `7XXXXXXXXX`)
**Password:** `<GOOGLE_PLAY_REVIEW_OTP_CODE>`

Apple's form has one account; the customer goes there and the owner and the
courier go in the notes.

**Contact information:** a person who answers during the review window, and
a phone number that rings.

**Notes** — paste, then replace the placeholders:

```
Jibli is a delivery app for food, groceries and cosmetics in Iraq. The
interface is Arabic, right-to-left. Orders are physical goods paid in cash on
delivery: there are no in-app purchases and no card entry.

CUSTOMER (the account in the fields above)
The phone number is a dedicated review account. Its verification code is
fixed and no message is sent, so no Iraqi SIM or WhatsApp account is needed.
1. Open the app and tap the first button, "تسجيل الدخول" (Sign in).
2. "+964" is fixed; type the number from the User name field.
3. Tap "إرسال رمز التحقق" (Send code) and enter the code from the Password
   field. The screen says the code was sent over WhatsApp; for this account
   nothing is sent and the code above always works.
4. Choose "ماركت" (Market), open "ماركت المراجعة" (the review market), add
   products with "+", open the basket ("عرض السلة") and continue to address
   and payment. A saved address is already on the account. Please do not
   place the order: the review market is not staffed.
5. "حسابي" (Account, bottom bar) holds the profile, addresses, orders,
   privacy policy, terms, support and "حذف حسابي" (Delete account). Please do
   not delete this review account.

Browsing does not need an account: "تصفح كضيف" (Browse as guest) on the
welcome screen opens the shops; sign-in is asked for at checkout.

STORE OWNER MODE (same app)
Username: <GOOGLE_PLAY_REVIEW_OWNER_USERNAME>
Password: <GOOGLE_PLAY_REVIEW_OWNER_PASSWORD>
On the welcome screen tap "صاحب متجر؟ سجّل متجرك في جيبلي", then
"لديّ حساب متجر" → "الدخول باسم المستخدم", and sign in. (Signed in as the
customer: حسابي → "سجّل متجرك في جيبلي".) Owners manage orders, products,
photos, hours and the shop's location.

COURIER MODE (same app)
Username: <GOOGLE_PLAY_REVIEW_DRIVER_USERNAME>
Password: <GOOGLE_PLAY_REVIEW_DRIVER_PASSWORD>
Same entry as the owner, third card "مندوب توصيل؟" → "دخول المندوبين". With
no live orders the delivery list is empty by design. Courier mode does not
use location; the app has no background location and no tracking.

PERMISSIONS
Location (while using the app only) places the delivery point on the map when
saving an address, and pins a shop's location for owners. Denying it changes
nothing: the address can always be typed. Camera and photos are used only by
store owners to add product and shop pictures; the photo library opens the
system picker.

REVIEWS
After a delivered order a customer can leave a star rating and an optional
comment. Comments are not shown to other customers in the app; they are shown
to the reviewed shop only. They are screened automatically before anyone
reads them, the shop can report a comment or block its author, and our team
handles reports within 24 hours. The terms state a zero-tolerance rule.

SUPPORT
"المساعدة والدعم" in حسابي calls our support number; on an iPad, which cannot
place calls, it opens WhatsApp or the browser instead.

The service operates in Iraq only. Shops are listed per city; the review
accounts are in Baghdad.
Privacy: https://legal-weld-seven.vercel.app/privacy
Terms: https://legal-weld-seven.vercel.app/terms
Account deletion: https://legal-weld-seven.vercel.app/delete-account
```

## The other App Store Connect forms

- **App Privacy** — answer from `data-safety.md`, section «Apple — App
  Privacy». Ten types, all linked, none for tracking.
- **Age rating** — answer every content question «None». For
  «User-Generated Content» answer **Yes** (the review comments), and accept the
  rating Apple's questionnaire computes; describe the moderation as above if
  asked. No web browsing, no messaging, no gambling, no contests.
- **Content rights** — «Does your app contain, show, or access third-party
  content?» **Yes**: product names, prices and photos supplied by the shops,
  which they have the rights to under the partner terms.
- **Export compliance** — answered in the binary
  (`ITSAppUsesNonExemptEncryption: false`); the build is not held for it.
- **Support URL** — the legal site's home page,
  `https://legal-weld-seven.vercel.app/`, once `NEXT_PUBLIC_CONTACT_EMAIL` is
  set on its Vercel project (see `apps/legal/src/app/contact.ts`): Apple
  requires the support URL to lead to a way of contacting you.
- **Privacy Policy URL** — `https://legal-weld-seven.vercel.app/privacy`.
- **Screenshots** — iPhone 6.9-inch (1320 × 2868 or 1290 × 2796) are the
  required set; the smaller sizes are scaled from them. No iPad set:
  `supportsTablet` is false. Show the app in Arabic, as it ships, and do not
  draw another platform's device frame or name.
- **App Review on an iPad.** Apple runs iPhone-only apps on iPads in
  compatibility mode. Calls, which an iPad cannot place, fall back to
  WhatsApp or the browser; nothing else in the app depends on telephony.

## Things that are not in the binary but get apps rejected

- A sign-in that fails. Sign in with the review number and code from a fresh
  install the day you submit, and after any change to the `GOOGLE_PLAY_REVIEW_*`
  variables on Render.
- A support or privacy contact that does not answer. `privacy@jibli.iq` does
  not exist (the domain was unregistered on 2026-10-16); the legal site shows
  it until `NEXT_PUBLIC_CONTACT_EMAIL` is set.
- An empty or fake catalogue. Only the review market should be visible until
  real shops are onboarded; remove it with `pnpm review:provision -- --remove`
  after approval, as the Play document describes.
