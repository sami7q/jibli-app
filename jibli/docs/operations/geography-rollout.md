# Runbook — opening a new city

Plan §124. Follow the order; it exists because each step depends on the last.

## Sequence

1. **Confirm the city exists in master data.**
   Admin → المناطق والتغطية → المحافظات → عرض المدن.
   It should already be there — the seed contains every canonical Iraqi city.
   If it is missing, that is a master-data change (a reviewed migration), not
   an Admin action.

2. **Enable restaurant onboarding, leaving ordering off.**
   Toggle `انضمام المطاعم` on the city. Enable the parent governorate first if
   it is off, or the city toggle has no effect.

3. **Recruit and approve restaurants.** Applications appear under
   `طلبات الانضمام`. Approval creates the restaurant, its branch, the owner
   membership and a commission config — the restaurant is APPROVED but still
   `operational_status = PENDING`.

4. **Create drivers.** Each restaurant adds its own drivers by Iraqi phone
   number; the driver activates by OTP in the Jibli app.

5. **Complete menus and pass the readiness checklist.**
   Admin → restaurant → readiness shows what is missing. Blocking checks must
   pass before the restaurant goes ACTIVE.

6. **Run test orders.** With ordering still disabled for the city, enable it for
   a short window outside business hours, place a real order end to end, and
   confirm: the alert sounds on the restaurant's actual device, the driver
   receives the assignment, the PIN completes the order, and commission accrues.

7. **Enable customer signup** if you want customers registering before launch.

8. **Enable ordering.** The city is live.

9. **Monitor** order success rate, restaurant acceptance rate and time, driver
   completion, and support volume for the first week.

10. **If something goes wrong, disable ordering only.** Leave signup and
    onboarding on. No data is deleted, active orders finish, and drivers can
    complete deliveries already in flight.

## What disabling actually does

Disabling `ordering` for a city:

- blocks new checkout in that city
- stops new marketplace orders reaching its restaurants
- **lets existing active orders continue** — food and cash are never stranded
- lets drivers finish assigned deliveries
- keeps historical order and finance screens working
- keeps the Restaurant Portal fully accessible
- keeps customer saved addresses stored, marked unavailable for ordering

It deletes nothing. The Admin UI states this before you confirm, and requires a
written reason that is recorded in the audit log.

## Common mistakes

**Enabling a city while its governorate is off.** The city will show
"معطّل بالمحافظة". Enable the governorate for that capability first.

**Enabling ordering before any restaurant is ACTIVE.** Customers see an empty
city, which reads as a broken app. Check the coverage matrix column
`مطاعم نشطة` before step 8.

**Approving an application after the city closed.** Approval is blocked by
default. A Super Admin can override with a reason, but the restaurant still
cannot take orders while ordering is disabled — eligibility is evaluated
independently at checkout.
