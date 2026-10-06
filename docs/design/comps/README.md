# The design comps

Ten HTML mockups of the customer app, as delivered. Kept unmodified — including
the seven different oranges and the four font stacks — because they are the
record of what was asked for, and a comp quietly edited to match the build is no
longer evidence of anything.

Renamed and renumbered in journey order: the folder now reads in the sequence a
customer moves through the app, rather than in the order the files happened to
be drawn. What each one became is in
[`../mobile-design-system.md`](../mobile-design-system.md).

| File                     | Screen         | Was         | Route                      |
| ------------------------ | -------------- | ----------- | -------------------------- |
| `01-welcome.html`        | شاشة البداية   | `1.html`    | `(auth)/welcome`           |
| `02-phone.html`          | تسجيل الدخول   | `2.html`    | `(auth)/phone`             |
| `03-otp.html`            | التحقق         | `3.html`    | `(auth)/otp`               |
| `04-profile.html`        | إكمال البيانات | `code.html` | `(auth)/profile`           |
| `05-home.html`           | الرئيسية       | `main.html` | `(tabs)/index`             |
| `06-restaurant.html`     | تفاصيل المطعم  | `6.html`    | `restaurant/[id]`          |
| `07-cart.html`           | سلة المشتريات  | `5.html`    | `cart`                     |
| `08-order-detail.html`   | تفاصيل الطلب   | `7.html`    | `order/[id]`               |
| `09-order-tracking.html` | تتبع الطلب     | `8.html`    | `order/[id]` — same screen |
| `10-account.html`        | الملف الشخصي   | `9.html`    | `(tabs)/account`           |

There was no `4.html`; nothing referenced it and the journey is complete without
it.

**To view one:** open the file in a browser. They pull Tailwind and Google Fonts
from CDNs, so they need a connection, and the food photography comes from
Google-hosted URLs that may expire — the layout survives that, the pictures may
not.

**Three places the build deliberately departs from these files**, each argued in
the design document:

1. `01-welcome.html` is a splash with no controls. Shipped as drawn it would
   leave a signed-out customer routed straight to "enter your phone number",
   which is the App Store 5.1.1(ii) rejection. Its art and type became the
   welcome screen, with the two entry choices where the tagline sat.
2. `02-phone.html` offers Google and Apple sign-in. Neither was built: there is
   no identity provider behind them, and adding one pulls in guideline 4.8.
3. `08-` and `09-` are one screen. They are the same order in two states, and
   two routes reading one order would disagree the moment a status changed.
