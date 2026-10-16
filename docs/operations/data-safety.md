# Store privacy answers — Google Play Data safety and Apple App Privacy

The two forms describe the same binary, so they are answered from one list.
Every row below is something the code actually stores; the source is named so
the answer can be re-checked when the code changes. Keep this file, the
privacy policy (`apps/legal/src/app/privacy/page.tsx`) and
`ios.privacyManifests` in `apps/mobile/app.config.ts` saying the same thing —
a mismatch between the form and observed behaviour is a rejection.

Last checked against the code: 16 October 2026.

## Who uses the binary

One app, three kinds of account:

- **Customer** — signs in with a phone number and a code (or a password set
  later). Orders, reviews, favourites.
- **Shop owner** — an account issued by Jibli (username + password). Manages
  the shop, its products and photos, and reads reviews.
- **Driver** — an account issued by Jibli or the shop. Sees assigned orders
  and marks them delivered. **No location is collected from drivers**, in the
  foreground or the background (ADR-0005).

The forms ask about the app, not the role, so the answers below are the union.

## What is collected

| Data                         | Who        | Required?                     | Source                                              | Why                                             |
| ---------------------------- | ---------- | ----------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Name                         | all        | yes                           | `users.full_name`                                   | the shop and driver know whom the order is for  |
| Phone number                 | all        | yes                           | `users.phone_e164`, order snapshot                  | sign-in, the driver calls on arrival            |
| Delivery address (text)      | customer   | yes, to order                 | `user_addresses`, order snapshot                    | delivery                                        |
| Precise location             | customer   | **optional** (map pin)        | `user_addresses.latitude/longitude`                 | delivery; the app works without it              |
| Approximate location         | customer   | optional                      | `ACCESS_COARSE_LOCATION` is declared alongside fine | same pin, when the user grants only approximate |
| Purchase history             | customer   | yes                           | `orders`, `order_items`                             | the order itself, receipts, support             |
| Photos                       | shop owner | optional                      | product and shop images, uploaded to storage        | shown to customers on purpose                   |
| Other user content (reviews) | customer   | optional                      | `order_reviews`, `review_reports`, `user_blocks`    | ratings, comments, reports and blocks           |
| Device push token            | all        | optional                      | `user_devices`                                      | order notifications                             |
| Email address                | customer   | only with Google sign-in      | `users.email`                                       | recognise the Google account next time          |
| Crash logs                   | all        | only when a Sentry DSN is set | Sentry                                              | fix crashes                                     |

**Email and crash logs are conditional on the build.** Neither
`EXPO_PUBLIC_GOOGLE_*` nor `EXPO_PUBLIC_SENTRY_DSN` is set in `eas.json`
today, so the current production build collects neither, and the privacy
manifest leaves both out (it adds them when those variables are set). If a
build ships with either one, add the row to both forms **before** that
build is submitted.

**Not collected:** payment card or bank data (cash on delivery only),
contacts, SMS, call logs, calendar, health, audio, files, browsing history,
advertising ID, installed apps, background location.

## Google Play — Data safety form

**Overview questions**

- Does the app collect or share any of the required user data types? **Yes.**
- Is all user data encrypted in transit? **Yes** (the app talks to the API
  and storage over HTTPS only).
- Do you provide a way for users to request that their data be deleted?
  **Yes** — in the app (حسابي ← حذف الحساب) and on the web at
  `https://legal-weld-seven.vercel.app/delete-account`.

**Data types** — collected: yes, shared: **no** for every row, processed
ephemerally: no.

| Play category       | Data type                    | Required / optional | Purposes                               |
| ------------------- | ---------------------------- | ------------------- | -------------------------------------- |
| Personal info       | Name                         | required            | App functionality, Account management  |
| Personal info       | Phone number                 | required            | App functionality, Account management  |
| Personal info       | Address                      | required            | App functionality                      |
| Location            | Precise location             | optional            | App functionality                      |
| Location            | Approximate location         | optional            | App functionality                      |
| Financial info      | Purchase history             | required            | App functionality                      |
| Photos and videos   | Photos                       | optional            | App functionality                      |
| App activity        | Other user-generated content | optional            | App functionality                      |
| Device or other IDs | Device or other IDs          | optional            | App functionality (push notifications) |

Add only when the build has them: Personal info → Email address (optional,
App functionality, Account management); App info and performance → Crash
logs (optional, Analytics).

**Why "shared: no".** Play does not count as sharing a transfer the user
starts and expects — placing an order sends the name, phone and address to
the shop and its driver because the user asked for that delivery — nor a
transfer to a service provider processing on Jibli's behalf (hosting, the
WhatsApp code sender, push delivery). Nothing goes to an advertiser, a data
broker or an analytics company. This is a judgement call on Play's
definitions; if a reviewer disagrees, the change is to mark Name, Phone and
Address as shared for "App functionality", not to change the app.

## Apple — App Privacy (App Store Connect)

- **Do you or your third-party partners collect data from this app?** Yes.
- **Tracking:** no data type is used for tracking. `NSPrivacyTracking` is
  `false` and App Tracking Transparency does not apply; do not add
  `NSUserTrackingUsageDescription`.
- Every type below is **linked to the user**, purpose **App Functionality**
  only.

| Apple category | Data type          |
| -------------- | ------------------ |
| Contact Info   | Name               |
| Contact Info   | Phone Number       |
| Contact Info   | Physical Address   |
| Location       | Precise Location   |
| Location       | Coarse Location    |
| Purchases      | Purchase History   |
| User Content   | Photos or Videos   |
| User Content   | Other User Content |

Conditional, as for Play: Contact Info → Email Address (Google sign-in);
Diagnostics → Crash Data, **not linked**, App Functionality (Sentry).

Apple does not count a push token as "Device ID" (that category means
advertising and vendor identifiers), so it is not declared.

## User-generated content (both stores)

Reviews are text one user writes and another reads (the shop, and anyone
reading the shop's reviews through the API), which brings Google Play's UGC
policy and App Store Guideline 1.2 into play. What answers them:

- **Terms accepted before posting.** A comment cannot be submitted without
  ticking «أوافق على قواعد المحتوى»; the time is stored in
  `order_reviews.terms_accepted_at`. The rules are in the terms page.
- **Filtering.** `screenComment` (`packages/domain/src/reviews`) holds a
  comment with insults, a phone number, an email or a link before anyone
  reads it; it waits in the moderation queue.
- **Reporting.** `POST /api/v1/reviews/:id/report` — the shop portal's
  «إبلاغ». Every report reaches the queue. Three independent reporters —
  people who have received an order and are not, and never were, on the
  reviewed shop's staff — hide the review at once; the shop's own reports
  never hide anything by themselves.
- **Blocking.** `POST /api/v1/reviews/:id/block-author` — the shop portal's
  «حظر الكاتب». Personal: only the blocker stops seeing that author.
- **Someone who acts on reports.** Admin → التقييمات → «طابور المراجعة»,
  publish or hide with a recorded reason (audit `review.reports.resolve`).
  The terms promise a decision within about 24 hours — someone must actually
  watch the queue.
- **Deletion.** Deleting an account deletes its reviews, the reports it
  filed, its blocks and the admin bell entries that quoted its comments, and
  recomputes each shop's rating (`deleteUserContent`).

For App Review notes: "Reviews are moderated: comments are screened
automatically, readers can report a review and block its author, and reports
are handled by our team from an admin queue."
