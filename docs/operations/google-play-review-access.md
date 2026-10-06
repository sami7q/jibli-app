# Google Play review access — «Sign in details / App access»

How a Google Play reviewer signs into every restricted part of Jibli without an
Iraqi SIM, a WhatsApp account or any help from us — and how it is switched off
again after approval.

Nothing in this document is a secret. Every value is a placeholder in angle
brackets; the real ones live in the Render dashboard and in the Play Console,
and nowhere else.

## What the reviewer gets

Jibli is one Android binary with three doors, and the reviewer gets a key to
each:

| Door                    | Who uses it in real life                | How it signs in                                  | Review account                                         |
| ----------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Customer                | anyone ordering                         | Iraqi phone number + one-time code over WhatsApp | one number whose code is fixed while review mode is on |
| Store owner («متجري»)   | the owner of a market or cosmetics shop | username + password                              | one review market with products                        |
| Courier («وضع المندوب») | a driver hired by a shop                | username + password                              | one courier attached to the review market              |

Customers never have a password. The only customer credential is the phone
number, proved by a code — that is the product, and review mode does not change
it. Review mode changes one thing: for exactly one number, the code is fixed in
configuration and no message is sent.

## How review mode works, and what it does not do

Three environment variables on the API (`packages/config/src/env.ts`):

```
GOOGLE_PLAY_REVIEW_ENABLED=true
GOOGLE_PLAY_REVIEW_PHONE=<GOOGLE_PLAY_REVIEW_PHONE>      # +9647XXXXXXXXX
GOOGLE_PLAY_REVIEW_OTP_CODE=<GOOGLE_PLAY_REVIEW_OTP_CODE> # OTP_LENGTH digits
```

While the switch is on, a code requested for that one number is the configured
one, and nothing is sent. Everything else about the sign-in is the ordinary
sign-in (`apps/api/src/services/otp-service.ts`):

- the challenge is stored, hashed with the pepper and salted by its own id
- it expires after `OTP_TTL_SECONDS` and allows `OTP_MAX_VERIFY_ATTEMPTS` guesses
- verification and session issuance are the same code path as every customer's
- the per-IP rate limit still applies; the per-number cooldown and caps do
  not, because they protect a message budget this number never spends, and
  the only thing they could do is lock the reviewer out
- wrong guesses on the review number are counted across challenges, and
  after `GOOGLE_PLAY_REVIEW_MAX_FAILURES` of them in a day (default 10) the
  number is refused new codes until the day passes — a fixed code must not
  be guessable by asking for a fresh challenge every five attempts; the
  reviewer, typing the right code, never spends any of this

What it deliberately does not do:

- it does not touch any other number — every other customer gets a random code
  through the real gateway, exactly as before
- it does not return the code in the API response, in any environment, and it
  does not log it; the only log line says that a review challenge was issued,
  with the number masked
- it does not open a mock mode: the review code is a wrong guess for every
  other number's challenge, because those carry their own hashed codes
- it does not grant any role: the review customer is a customer, the review
  owner has the owner role on the review shop only, the review courier has the
  courier role on the review shop only

The API refuses to start with the switch on and either value missing, with a
code that is not `OTP_LENGTH` digits, with a single repeated digit (`0000`,
`7777`), or with a code equal to `OTP_MOCK_CODE`. Switched off, the two other
values are inert.

This is separate from `OTP_TEST_PHONES`, which opens whatever is listed and is
refused under `APP_ENV=production`. Review mode is allowed in production on
purpose: the review runs against production.

Tests: `apps/api/src/services/otp-review.test.ts` and
`packages/config/src/review-env.test.ts`.

## Before submitting

### 1. Choose the values

- **Phone:** any Iraqi mobile number that is _not_ a real customer's, a staff
  member's or a shop owner's — the provisioning script refuses a number that
  belongs to an account with a username, platform roles or a shop membership.
  A number nobody uses is fine; no message is ever sent to it.
- **Code:** `OTP_LENGTH` digits (4 by default), not a single repeated digit.
- **Owner and courier:** two different usernames (lowercase letters, digits,
  `.`, `_`, `-`), each with a password that passes the portal policy (at least
  12 characters with letters and digits, not containing the username).

Write them down in a password manager. They are typed into the Play Console
once and into the Render dashboard once.

### 2. Create the accounts

From the repo root, against the production database:

```
DATABASE_URL=<production pooled url> \
DATABASE_SSL=true \
GOOGLE_PLAY_REVIEW_PHONE=<GOOGLE_PLAY_REVIEW_PHONE> \
GOOGLE_PLAY_REVIEW_OWNER_USERNAME=<GOOGLE_PLAY_REVIEW_OWNER_USERNAME> \
GOOGLE_PLAY_REVIEW_OWNER_PASSWORD=<GOOGLE_PLAY_REVIEW_OWNER_PASSWORD> \
GOOGLE_PLAY_REVIEW_DRIVER_USERNAME=<GOOGLE_PLAY_REVIEW_DRIVER_USERNAME> \
GOOGLE_PLAY_REVIEW_DRIVER_PASSWORD=<GOOGLE_PLAY_REVIEW_DRIVER_PASSWORD> \
pnpm review:provision
```

Add `-- --dry-run` to see what it would do first. `GOOGLE_PLAY_REVIEW_CITY_CODE`
picks the city (default `IQ-BG-BAGHDAD`); it must be enabled for ordering, and
the script stops with instructions if it is not.

What it writes (`packages/db/src/scripts/provision-review-accounts.ts`),
idempotently — run it again before every submission and it refreshes rather
than duplicates:

- **Customer** on the review number: `ACTIVE`, phone verified, profile
  complete, named «مراجع Google Play», in the chosen city, with one saved
  address («المنزل»). No password, no roles. No orders.
- **Shop** «ماركت المراجعة» (partner code `REVIEW-GP-1`): an `ACTIVE` market in
  the same city, open around the clock, eight products in three aisles, with a
  commission config so checkout can quote. Its owner account has the username
  and password above, no forced password change and no MFA.
- **Courier**: an `ACTIVE` driver account with the username and password above,
  hired by the review shop. No phone, no plate, no location.

Nothing financial is written. The script prints usernames and a masked number;
it never prints a password or the code.

### 3. Switch the fixed code on

In the Render dashboard, on `jibli-api` (not in `render.yaml`, which is
committed), set the three `GOOGLE_PLAY_REVIEW_*` values and redeploy. The boot
log shows no code; `/health/ready` is unchanged. If the API does not come up,
the schema's message names which of the three is wrong.

### 4. Check it

From a phone with the production build: welcome → «تسجيل الدخول» → the review
number → «إرسال رمز التحقق» → the review code → home. Then «حسابي» shows
«مراجع Google Play» and the saved address. Sign out, and sign in with the owner
and the courier as described below.

### 5. Keep the API awake

Render's free plan sleeps after fifteen minutes and wakes in about a minute. A
reviewer who opens the app cold sees a spinner, which reads as broken. Move
`jibli-api` to a paid instance for the review window.

## Text for the Play Console

Paste into **App content → App access → "All or some functionality is
restricted" → Add new instructions**. Replace the placeholders; keep the rest.

```
JIBLI is a food, grocery and cosmetics delivery app for Iraq. The interface is
Arabic, right-to-left. Payment is cash on delivery only — no card entry, no
in-app purchases. The three accounts below are dedicated review accounts and
contain no real customer, merchant or courier data. You do not need an Iraqi
phone, a WhatsApp account or SMS: the verification code for the review
customer is fixed and no message is sent.

────────────────────────────────────────
CUSTOMER
────────────────────────────────────────
Access type: Phone number + one-time verification code
Phone: <GOOGLE_PLAY_REVIEW_PHONE>
Verification code: <GOOGLE_PLAY_REVIEW_OTP_CODE>

1. Open Jibli. On the welcome screen tap the first button, "تسجيل الدخول"
   (Sign in).
2. The "+964" prefix is fixed; type the number WITHOUT the leading +964
   (e.g. 7XXXXXXXXX).
3. Tap "إرسال رمز التحقق" (Send verification code).
4. Enter the verification code above. It is fixed for this account only;
   the app says it was sent over WhatsApp, but for this review account
   nothing is sent and the code above always works.
5. You land on the home screen. Sections: "طعام" (food), "ماركت"
   (market), "كوزمتك" (cosmetics). Open "ماركت المراجعة" (the review
   market), add products to the basket ("أضف"), open the basket (bottom
   bar), and continue to checkout ("إتمام الطلب"). A saved delivery
   address ("المنزل") is already on the account; you may also pick a
   location on the map or type an address. Location permission is
   optional — denying it does not block anything. Cash on delivery is the
   only payment method.
6. Account: tab "حسابي" (bottom bar, far left). It shows the profile,
   saved addresses ("عناويني"), order history ("طلباتي"), favorites,
   notifications, privacy policy, terms, and "حذف حسابي" (delete
   account). Please do not delete this review account.

────────────────────────────────────────
STORE OWNER MODE (same app)
────────────────────────────────────────
Access type: Username + password (no verification code)
Username: <GOOGLE_PLAY_REVIEW_OWNER_USERNAME>
Password: <GOOGLE_PLAY_REVIEW_OWNER_PASSWORD>

1. On the welcome screen tap the link at the bottom, "صاحب متجر؟ سجّل متجرك
   في جيبلي" (Shop owner?). If you are already signed in as the customer,
   go to "حسابي" and tap "سجّل متجرك في جيبلي" instead.
2. Tap the second card, "لديّ حساب متجر" → "الدخول باسم المستخدم" (I have
   a shop account → sign in with username).
3. Enter the username and password above and tap "دخول".
4. You land on "متجري" (My shop): live orders, today's numbers, products
   ("المنتجات"), categories ("الأقسام"), shop settings ("تعديل المتجر" —
   name, photo, hours "أوقات العمل", location), and "عرض المتجر كما يراه
   الزبون" (view as customer). "تصفّح التطبيق كزبون" returns to the
   customer app while keeping the shop signed in.

────────────────────────────────────────
COURIER MODE (same app)
────────────────────────────────────────
Access type: Username + password (no verification code)
Username: <GOOGLE_PLAY_REVIEW_DRIVER_USERNAME>
Password: <GOOGLE_PLAY_REVIEW_DRIVER_PASSWORD>

1. On the welcome screen tap "صاحب متجر؟ سجّل متجرك في جيبلي". If you are
   signed in as the customer, go to "حسابي" and tap "سجّل متجرك في جيبلي"
   instead; the same cards appear.
2. Tap the third card, "مندوب توصيل؟" → "دخول المندوبين" (Courier? → courier
   sign-in).
3. Enter the username and password above and tap "دخول".
4. You land on the delivery screen ("التوصيل"): assigned deliveries, the
   "استلمت" (picked up) and "سلّمت" (delivered) actions, and cash collected.
   With no live orders the list is empty by design. Location is used only
   while this screen is open, to show the delivery point; there is no
   background location and no live tracking.

Notes
- The service operates in Iraq only. Restaurants and shops are listed per
  city; the review accounts are set up in Baghdad, where content exists.
- No account on this list has administrative rights.
- Account deletion is available in-app under "حسابي" → "حذف حسابي", and
  described at https://legal-weld-seven.vercel.app/delete-account
- Privacy policy: https://legal-weld-seven.vercel.app/privacy
- Terms: https://legal-weld-seven.vercel.app/terms
```

## After approval

1. In the Render dashboard, delete `GOOGLE_PLAY_REVIEW_ENABLED`,
   `GOOGLE_PLAY_REVIEW_PHONE` and `GOOGLE_PLAY_REVIEW_OTP_CODE` from
   `jibli-api` and redeploy. The fixed code stops working the moment the new
   instance is up; the number becomes an ordinary number again.
2. Switch the accounts off:

   ```
   DATABASE_URL=<production pooled url> DATABASE_SSL=true \
   GOOGLE_PLAY_REVIEW_PHONE=<GOOGLE_PLAY_REVIEW_PHONE> \
   GOOGLE_PLAY_REVIEW_OWNER_USERNAME=<GOOGLE_PLAY_REVIEW_OWNER_USERNAME> \
   GOOGLE_PLAY_REVIEW_DRIVER_USERNAME=<GOOGLE_PLAY_REVIEW_DRIVER_USERNAME> \
   pnpm review:provision -- --remove
   ```

   The three accounts are deactivated and their sessions revoked; the review
   shop is suspended and leaves the storefront. Rows are kept, so the next
   review runs the same command without `--remove` and everything comes back.

3. Update the Console's sign-in details before the next submission if any value
   changed.

Google keeps the credentials on file for future reviews of updates; if the
switch is off when an update is reviewed, the customer sign-in fails and the
update is rejected. Turn it on before each submission and off after each
approval, rather than leaving it on: the code is fixed, so every day it stays
on is another day's worth of guesses against the same four digits. Ten a day
is nothing over a review window and something over a year.

## If the reviewer is locked out

The wrong-guess budget is the one way the review number can refuse the
reviewer: somebody who knows the number can spend it on purpose, or a
reviewer can mistype ten times. The API log then shows
`otp.review_locked`, and the app says the number must wait. To clear it
before the day passes, delete the counter on the API's Redis:

```
redis-cli -u "$REDIS_URL" DEL otp:review:failures
```

(On Render, the `jibli-cache` Key Value instance; its connection string is
on the service's environment page.) Keep the review number out of anything
public — it is a credential, like the code — and nobody but Google has a
reason to type it.

## Security notes, for whoever audits this

- No "review" button, screen or string exists in the app. The reviewer uses the
  same screens as everyone.
- The code is in the server environment only; the mobile bundle has no
  knowledge of it. `git log -p -S GOOGLE_PLAY_REVIEW_OTP_CODE` shows only the
  variable name, never a value.
- The review number cannot be used to reach any other account, and the review
  code cannot be used on any other number.
- The customer-facing password paths (`/auth/register`, `/auth/password/*`,
  the «حساب جديد» tab, «نسيت كلمة السر») were removed as part of this work:
  customers sign in with a code and nothing else, which is also what the
  Console text describes.
