# Jibli — Complete Production Engineering Plan
## Iraqi Food Delivery Platform
### Customer App + Driver Mode + Restaurant Portal + Admin Portal
### React Native + Next.js + TypeScript + PostgreSQL

**Document language:** English  
**Release 1 product UI language:** Arabic only, fully RTL  
**Primary market:** Iraq  
**Primary category:** Restaurants  
**Payment in Release 1:** Cash on Delivery (COD)  
**Delivery model in Release 1:** Restaurant-owned drivers  
**Default navigation:** Google Maps, with Waze as an alternative  
**Architecture:** Modular monolith with independent worker/realtime responsibilities  
**Security target:** OWASP ASVS 5.0 Level 2-oriented verification, adjusted to the product risk profile  

---

# 1. Executive Summary

Jibli is a production-grade food ordering and restaurant operations platform for Iraq. The first release focuses only on restaurants so the company can launch a focused, reliable product without the operational complexity of multiple marketplace categories. The architecture must nevertheless be ready to support water factories, water tankers, gas providers, grocery, and similar local-commerce categories later without rebuilding identity, geography, ordering, settlement, notification, or delivery foundations.

Release 1 contains four primary experiences. The first is a React Native customer application for Android and iOS. The second is a Driver Mode inside the same React Native application for drivers who belong to restaurants. The third is a Next.js Restaurant Portal used by restaurant owners and staff to manage live orders, menus, inventory, staff, drivers, finance, commissions, and settlements. The fourth is a Next.js Admin Portal used by Jibli staff to control geography, restaurants, customers, platform roles, commissions, settlements, reports, and platform configuration.

The revised product has a strict geography requirement. All Iraqi governorates and all supported cities must exist as master data before launch. Service coverage is not hard-coded into the mobile application and is not determined by a static dropdown shipped with the app. Instead, the Admin Portal centrally controls which governorates and cities are currently enabled for customer onboarding, restaurant onboarding, and ordering. New service areas can therefore be opened without publishing a new mobile version.

The required new-customer flow is:

```text
Iraqi phone number
→ OTP verification
→ full name
→ governorate
→ city
→ profile completion
→ customer home
```

The selected governorate and city become the customer's default profile geography and discovery context. They do not replace delivery addresses. A delivery address is a separate object containing governorate, city, district or neighborhood, street, building, floor when needed, landmark, map coordinates, and delivery notes. A customer can therefore keep multiple delivery addresses and order to a different active city in the future without corrupting profile data.

Restaurant geography follows the same canonical data. A restaurant may be created directly by an authorized Admin or may submit a self-onboarding application through the Restaurant Portal. In both cases, the restaurant selects a governorate and city from the Jibli master registry. A restaurant cannot become visible in the customer marketplace merely because it exists in the database. It must be approved, operationally active, have an eligible active branch, be in an ordering-enabled city, have valid working hours, and accept orders.

Drivers are created by restaurants. Open public driver registration is not part of Release 1. A restaurant owner or authorized manager creates the driver's account using the driver's Iraqi phone number. The driver activates the account using OTP inside the same Jibli mobile application. The backend recognizes the driver's role and displays Driver Mode. Restaurant staff then assign specific orders to specific drivers. The driver accepts the assignment, collects the food, opens Google Maps or Waze for navigation, reaches the customer, and confirms delivery using a Delivery PIN. COD cash is recorded as driver custody until it is handed over to the restaurant.

Financially, Jibli must distinguish customer-facing platform service fees from the percentage commission owed by the restaurant to Jibli. Commission is snapshotted per order so changing a restaurant's commission later cannot change historical orders. Commission statements are generated every half-month or calendar month according to the restaurant contract. Payments, partial payments, credits, debits, reversals, and overdue amounts are auditable. Financial records are append-only in spirit; corrections use adjustment or reversal entries rather than silent edits.

The platform is considered production-ready only when critical invariants are demonstrated: a stale mobile client cannot bypass geography activation, a restaurant cannot access another restaurant's data, an order cannot be duplicated by network retry, inventory cannot be reserved twice, commission cannot be recalculated with a later rate, a settlement cannot include the same order twice, a former driver cannot complete a reassigned delivery, a city disable action cannot destroy historical data, and every sensitive administrative action is traceable in audit logs.

---

# 2. Product Language Policy

Release 1 is **Arabic-only** at the user-interface level. This applies to the customer app, Driver Mode, Restaurant Portal, Admin Portal, push notifications, validation messages, empty states, financial labels, commission statements shown in the product, settings, confirmation dialogs, and support screens.

The engineering plan, database schema names, API fields, source code identifiers, internal logs, runbooks, OpenAPI documentation, and developer documentation may use English. This separation should be intentional: code can contain `commissionRateBps`, while the Arabic user-facing label is `نسبة العمولة`.

RTL must be a first-class layout requirement. Do not implement an LTR interface and simply reverse a few flex directions. The root application direction is RTL. Directional icons are mirrored where semantically appropriate. Phone numbers and order numbers remain readable. Tables are intentionally designed for right-to-left scanning. Arabic and Latin text combinations are tested. Arabic-Indic digits entered into phone and numeric fields are normalized before server validation. Long Arabic restaurant names and product names must be tested on small Android devices and narrow web layouts.

Arabic-only Release 1 does not mean the architecture should hard-code Arabic strings into business logic. UI strings must remain in localization files so adding Kurdish or English later does not require rewriting components or domain logic.

---

# 3. Release 1 Scope

Release 1 includes customer OTP authentication, customer profile completion, centrally managed Iraq geography, restaurant marketplace discovery, restaurant menus, product modifiers, cart, COD checkout, configurable platform service fee, restaurant percentage commission, restaurant-owned delivery drivers, Google Maps and Waze navigation links, Delivery PIN, live order alerts, browser sound, inventory, restaurant expenses, restaurant profit estimates, settlement cycles, driver cash custody, role-based permissions, audit logs, push notifications, realtime updates, reporting, observability, backup, and production deployment controls.

Release 1 intentionally does **not** require live driver GPS shown to customers, a platform-owned driver fleet, online card payment, a multi-restaurant cart, route optimization, AI recommendations, restaurant subscription billing, water ordering, gas ordering, or tax-invoice claims that have not been reviewed by Iraqi legal/accounting professionals. The data model must leave clean extension points for these features, but they must not inflate initial operational risk.

---

# 4. Architectural Principles

## 4.1 Server-side authority

The backend is authoritative for prices, item availability, geography activation, restaurant eligibility, roles, commissions, inventory, order totals, settlement amounts, and delivery assignment. Mobile and web clients are untrusted presentation layers.

## 4.2 Central geography

Governorates and cities are master data. Customer and restaurant selectors read from backend APIs. A new city can be activated by Admin without an app release.

## 4.3 Controlled state machines

Order, delivery assignment, restaurant onboarding, settlement, and payment states have defined transitions. No endpoint accepts arbitrary raw status updates.

## 4.4 Financial immutability

Issued statements, order price snapshots, commission snapshots, ledger entries, and completed cash events are not silently rewritten. Corrections use compensating entries and audit trails.

## 4.5 Tenant isolation

Restaurant A must never read, update, subscribe to, or export Restaurant B data. Authorization is server-side and based on authenticated membership, not on hidden buttons or submitted restaurant IDs.

## 4.6 Idempotency

Network retries are expected. Critical commands are idempotent. Duplicate order placement, delivery completion, settlement generation, payment recording, and driver cash events must not create duplicate financial or operational state.

## 4.7 Soft deletion

Commercial entities and identity records with historical relationships use soft deletion or deactivation. Historical orders, driver assignments, settlements, and audits remain traceable.

## 4.8 UTC storage, Baghdad business time

Timestamps are stored in UTC. Business reports and settlement periods use `Asia/Baghdad`. Working-hour logic is timezone-aware.

---

# 5. Recommended Technology Stack

## 5.1 Mobile

- React Native, current stable version compatible with the New Architecture.
- TypeScript strict mode.
- Expo Development Builds/EAS if all native requirements remain supported; otherwise a standard React Native native-project workflow.
- Expo Router or React Navigation; select one and use it consistently.
- TanStack Query for server state.
- React Hook Form for forms.
- Zod for validation schemas.
- Secure storage backed by iOS Keychain and Android Keystore/secure preferences for session secrets.
- Push notifications using APNs/FCM through a unified abstraction.
- Crash/error monitoring with PII redaction.
- Shared design tokens, but platform-specific component behavior when required.

Authentication tokens must not be stored in ordinary AsyncStorage. React Native's security guidance explicitly treats unencrypted asynchronous storage as unsuitable for token storage. The app must also assume anything compiled into the application bundle can be inspected, so private server credentials never ship inside the client.

## 5.2 Restaurant and Admin web applications

- Next.js App Router.
- Current supported secure Next.js 16.x patch line at implementation time.
- TypeScript strict mode.
- Server Components by default for non-interactive server-rendered content.
- Client Components only for realtime, audio, browser APIs, interactive charts, and rich client forms.
- React Hook Form and Zod.
- TanStack Query for interactive server state where useful.
- Accessible component primitives and consistent design tokens.
- Tailwind CSS or equivalent token-based styling.

The Admin Portal and Restaurant Portal should be separate logical applications or strongly separated route/deployment boundaries. A practical structure is `admin.<domain>`, `partner.<domain>`, and `api.<domain>`.

## 5.3 Backend and data services

- TypeScript backend using Fastify or NestJS with Fastify adapter.
- PostgreSQL.
- Drizzle ORM or another mature ORM that preserves explicit SQL control.
- Redis-compatible service for caching, locks, presence, and selected rate-limit state.
- Queue system such as BullMQ or a managed equivalent.
- Dedicated worker process for notifications, settlements, exports, aggregation, and maintenance jobs.
- Realtime WebSocket gateway or a managed realtime provider.
- S3-compatible object storage for restaurant images and private documents.
- CDN for public optimized image variants.

The recommended application style is a **modular monolith**, not an early microservice explosion. Modules have clear boundaries so they can be extracted later when scale or team ownership makes extraction useful.

---

# 6. Monorepo Structure

```text
jibli/
  apps/
    mobile/
    admin-web/
    restaurant-web/
    api/
    worker/
  packages/
    domain/
    db/
    contracts/
    auth/
    geography/
    money/
    notifications/
    validation/
    logger/
    config/
    ui-web/
    test-utils/
  docs/
    architecture/
    adr/
    api/
    finance/
    security/
    operations/
  infra/
    docker/
    migrations/
    scripts/
```

Business-critical logic belongs in domain/application modules, not React components or Next.js pages. API controllers should authenticate, authorize, validate, invoke use cases, and return structured responses. Commission formulas, settlement boundaries, effective geography rules, and order state transitions must have one canonical implementation.

---

# 7. Environments and Secrets

Required environments are Local, Development, Staging, and Production. A separate Sales Demo environment is optional.

Every environment uses separate database, Redis namespace/service, object storage namespace, OTP configuration, push credentials, session/encryption secrets, analytics/error-monitoring environment, and public URLs. Staging must never accidentally send production OTP traffic to arbitrary real numbers; use a sandbox or allowlist where possible.

Secrets belong in a secret manager or deployment environment, never in Git. Startup validation must reject missing mandatory secrets. Production runtime database users must not be superusers. Migration credentials should be separate from application runtime credentials.

---

# 8. Iraq Geography Master Data

Geography is a dedicated domain module because service coverage affects customer registration, restaurant onboarding, discovery, checkout, reporting, and future category expansion.

## 8.1 Governorates

The canonical master dataset must contain all currently recognized Iraqi governorates. As of this plan, Iraq has 19 governorates, including Halabja, which became the 19th governorate in 2025.

The master list is:

- Baghdad.
- Al Anbar.
- Babil.
- Basra.
- Dhi Qar.
- Al-Qadisiyyah.
- Diyala.
- Duhok.
- Erbil.
- Halabja.
- Karbala.
- Kirkuk.
- Maysan.
- Al Muthanna.
- Najaf.
- Nineveh.
- Salah al-Din.
- Sulaymaniyah.
- Wasit.

The production seed must store canonical Arabic display names. Optional English internal names are allowed for engineering and reporting metadata, but Release 1 interfaces show Arabic only.

## 8.2 Cities

All cities in the approved canonical Iraq city dataset must already exist in the database before public launch. Customers do not create new city strings. Restaurant owners do not create new city strings. Admin day-to-day service activation operates on existing canonical records.

Administrative units can change over time. The geography seed therefore has a source version, canonical codes, stable IDs, and an update process. New official cities are added through a reviewed import/migration; deprecated units are marked accordingly rather than destructively removed when historical references exist.

## 8.3 Governorate schema

```text
governorates
id
code
name_ar
name_en_internal nullable
is_enabled
customer_signup_enabled
restaurant_onboarding_enabled
ordering_enabled
sort_order
source_version
created_at
updated_at
```

## 8.4 City schema

```text
cities
id
governorate_id
code
name_ar
name_en_internal nullable
is_enabled
customer_signup_enabled
restaurant_onboarding_enabled
ordering_enabled
source_version
created_at
updated_at
```

Every city belongs to exactly one governorate record in the active master-data version.

## 8.5 Why separate capabilities are required

A single `is_active` flag is not sufficient for a serious rollout. Jibli may want to recruit restaurants in a city before accepting customer orders. It may temporarily stop ordering in a city while keeping customer accounts active. It may allow existing customers to log in while preventing new profile registration. For this reason, three capabilities are separate:

```text
customer_signup_enabled
restaurant_onboarding_enabled
ordering_enabled
```

The Admin UI may provide a simple master activation control, but the backend still stores explicit capabilities.

## 8.6 Effective capability

A city's capability is never stronger than its parent governorate.

```text
effective_city_ordering =
  governorate.ordering_enabled
  AND city.ordering_enabled
```

The same pattern applies to customer signup and restaurant onboarding. This calculation belongs in one Geography domain service and is reused everywhere.

## 8.7 Disabling behavior

Disabling a city or governorate does not delete customers, addresses, restaurants, menu items, drivers, orders, inventory, commissions, settlements, or audit logs.

Default behavior when ordering is disabled:

- New checkout is blocked.
- New marketplace orders are not sent to restaurants in that city.
- Existing active orders continue so food and cash are not stranded.
- Drivers can finish already assigned deliveries.
- Historical order and finance screens remain accessible.
- Restaurant Portal remains accessible for menu, inventory, finance, staff, and historical data.
- Customer saved addresses remain stored but are marked unavailable for ordering.

## 8.8 Admin geography interface

Arabic-only Admin section: `المناطق والتغطية`.

Tabs:

- `المحافظات`
- `المدن`
- `إعدادات التغطية`
- `سجل التغييرات`

For a governorate, Admin can view active city count, customer-signup state, restaurant-onboarding state, ordering state, and affected restaurant/user statistics. Disabling ordering should show an impact preview before confirmation.

Every geography change requires a named permission and audit entry. High-impact disable actions require a reason.

---

# 9. Geography Seed and Maintenance

The initial dataset should be imported as versioned master data, not typed manually through Admin. The safest launch posture is that all master records exist but all business capabilities default to false until Operations explicitly activates launch areas.

The seed includes:

```text
source_version
canonical_code
name_ar
optional internal aliases
parent governorate code for city rows
```

CI validates the dataset before deployment. Production update logic inserts new canonical units, updates safe descriptive fields, and preserves stable IDs. A city referenced by historical orders is never physically deleted.

Administrative changes must be reviewed periodically using a reliable Iraqi administrative reference. Operations owns activation decisions. Engineering owns the master-data import mechanism. Restaurant users never have permission to add master cities.

---

# 10. Customer OTP Authentication

The customer authenticates using an Iraqi phone number and OTP.

Phone handling requirements:

- Normalize Arabic-Indic digits.
- Normalize to E.164 for storage.
- Show +964 clearly in the Arabic UI.
- Reject malformed values.
- Apply resend cooldown.
- Limit attempts per phone, device context, and IP/risk context.
- Use anti-automation controls when suspicious behavior is detected.
- Do not log OTP values.
- Do not persist OTP values on the device.

Core endpoints:

```text
POST /api/v1/auth/otp/request
POST /api/v1/auth/otp/verify
```

After successful verification, the server returns session information and profile-completion state. If this is the first login or a legacy profile is incomplete, the app immediately enters the mandatory customer information flow.

---

# 11. Customer Profile Completion After OTP

This flow is mandatory.

Arabic UI example:

```text
أكمل معلوماتك
الاسم الكامل
المحافظة
المدينة
متابعة
```

Required fields:

- Full name.
- Governorate.
- City.

Flow:

1. App requests governorates with effective `customer_signup_enabled=true`.
2. Customer selects governorate.
3. App requests enabled cities for that governorate.
4. Customer selects city.
5. App submits full name, governorate ID, and city ID.
6. Backend revalidates current activation and parent relationship.
7. Profile receives `profile_completed_at`.
8. Customer enters Home.

The server does not trust the fact that a city was visible in a dropdown five seconds earlier. An Admin may disable the city between fetch and submit. In that race, profile completion returns a stable error code such as `CITY_NOT_AVAILABLE`, the app refreshes the options, and no invalid profile is saved.

Customer schema fields include:

```text
users
id
phone_e164
phone_verified_at
full_name
profile_governorate_id nullable
profile_city_id nullable
preferred_language = AR
profile_completed_at nullable
status
created_at
updated_at
deleted_at nullable
```

Constraints:

- City must belong to selected governorate.
- Name must be valid Unicode text with reasonable length and control-character restrictions.
- Profile completion requires currently enabled customer-signup geography.
- Historical order records never depend on mutable current profile fields.

---

# 12. Customer Profile Geography vs Delivery Addresses

This distinction is critical.

The profile governorate and city answer: "Where is this customer's default Jibli market/discovery area?"

A delivery address answers: "Where should this specific order be delivered?"

Delivery address schema:

```text
user_addresses
id
user_id
label
governorate_id
city_id
district_text or district_id
street
building
floor nullable
landmark
latitude
longitude
delivery_notes
is_default
created_at
updated_at
```

A customer can have multiple addresses. Changing profile city never rewrites saved addresses or historical orders. A customer may browse another active city and order to an eligible address there if business policy allows.

At checkout, the delivery address—not merely the profile city—drives actual order eligibility.

---

# 13. Address UX for Iraq

The address form should reflect real Iraqi addressing habits instead of forcing a Western postal-code model.

Arabic fields can include:

- `المحافظة`
- `المدينة`
- `المنطقة / الحي`
- `الشارع`
- `رقم الدار أو البناية`
- `الطابق` optional
- `أقرب نقطة دالة`
- `ملاحظات التوصيل`
- Map pin

Precise GPS permission is not required to create an account. For a delivery address, the customer can use a map pin or manually select a point. If foreground location permission is granted, it can assist the user but must not silently overwrite chosen geography.

The backend validates coordinate ranges and geography consistency. If a geocoder suggests a different city than the customer's canonical selection, show a warning or require confirmation rather than letting a third-party geocoder redefine Jibli master data.

---

# 14. Home City Selection and Discovery

A practical selection hierarchy is:

```text
current explicitly selected city
else default delivery-address city
else profile city
```

The Home screen fetches restaurants eligible for the current active ordering geography. If a city has no available restaurants, show a clear Arabic empty state rather than silently mixing in restaurants from another city.

A customer can switch current city only to ordering-enabled cities. The profile city remains the account default until the user explicitly changes it in profile settings.

---

# 15. Restaurant Creation and Onboarding

Jibli supports two restaurant creation channels.

## 15.1 Admin-created restaurant

An authorized Admin can create a restaurant and initial owner account. Required setup includes restaurant name, owner/contact, Iraqi phone, governorate, city, detailed address, map pin, cuisine, working hours, commission, settlement cycle, minimum order, delivery configuration, logo/cover, and operational state.

Only restaurant-onboarding-enabled geography may be selected under normal operations. A Super Admin can configure a future location in a disabled area only through an audited privileged override, and that restaurant still cannot become orderable while ordering is disabled.

## 15.2 Restaurant self-onboarding

The Restaurant Portal supports an Arabic onboarding wizard:

1. `بيانات المطعم`
2. `المحافظة والمدينة`
3. `الموقع والعنوان`
4. `أوقات العمل`
5. `القائمة الأولية`
6. `المراجعة والإرسال`

The owner verifies identity, chooses only onboarding-enabled geography, submits details, and receives an `UNDER_REVIEW` status. The restaurant is not visible to customers until Admin approval.

Admin actions:

- Approve.
- Reject.
- Request more information.

If a city is disabled after application but before approval, approval is blocked by default and Admin receives a coverage warning.

---

# 16. Restaurant and Branch Data Model

Even if the first UI exposes one branch per restaurant, the database should use a branch entity.

```text
providers
id
provider_type
status
created_at

restaurants
id
provider_id
display_name
legal_name nullable
onboarding_status
operational_status
created_at
updated_at

restaurant_branches
id
restaurant_id
name
governorate_id
city_id
address_text
latitude
longitude
phone
is_active
accepts_orders
created_at
updated_at
```

`provider_type` is `RESTAURANT` in Release 1. Future values may include water factory, tanker, gas provider, or grocery. UI remains restaurant-specific now.

Branch city must belong to branch governorate. Historical orders retain branch/location snapshots. A major restaurant relocation requires an approval workflow rather than an unrestricted profile edit.

---

# 17. Restaurant Location Change Workflow

Changing a logo or phone is not the same risk as moving an approved restaurant from one city to another.

For governorate/city relocation:

1. Restaurant owner submits requested new geography and address.
2. Current operational location remains active until decision.
3. Admin reviews whether new geography is enabled.
4. Admin approves or rejects.
5. Effective time is recorded.
6. Marketplace caches invalidate.
7. Audit records old and new locations.

Historical orders remain tied to their original snapshots.

---

# 18. Restaurant Eligibility for Marketplace

A restaurant is customer-visible/orderable only when all required conditions are true:

```text
global checkout enabled
AND governorate ordering enabled
AND city ordering enabled
AND restaurant approved
AND restaurant operational_status = ACTIVE
AND branch active
AND branch accepts_orders
AND working hours allow orders
AND restaurant not temporarily paused
```

Item-level availability, inventory, service zone, and checkout validation are separate layers. The backend should be able to return diagnostic reasons so Support can explain why a restaurant is not orderable.

---

# 19. Menu Domain

Core entities:

```text
menu_categories
menu_items
modifier_groups
modifiers
item_modifier_groups
```

Menu category fields include Arabic name, Arabic description when needed, sort order, active state, and restaurant ID.

Menu item fields include Arabic name, Arabic description, base price in integer IQD, optional cost price, image asset, active state, availability state, optional preparation override, SKU, and inventory linkage.

Restaurant menu changes never mutate historical order snapshots.

---

# 20. Product Modifiers

Modifier groups support examples such as size, extra cheese, sauce, side dish, or drink choice.

Group rules:

```text
min_select
max_select
is_required
```

The backend validates modifier ownership and selection rules. The client cannot send a final trusted price. Price is always recalculated from current menu configuration.

---

# 21. Cart

Release 1 supports one restaurant per cart. If the user attempts to add an item from another restaurant, the Arabic app clearly asks whether to clear the existing cart and begin a new one.

A server-backed cart with local cache is recommended because it improves revalidation and multi-device recovery, but the cart is never treated as a financial record. Checkout always obtains a fresh authoritative quote.

---

# 22. Checkout

Checkout displays:

- Items and modifiers.
- Quantities.
- Subtotal.
- Restaurant-funded and platform-funded discounts.
- Delivery fee if applicable.
- Platform service fee.
- Final total.
- Address.
- COD payment method.
- Customer notes.

Before order placement, the backend verifies current geography, restaurant state, address eligibility, working hours, product state, modifiers, inventory, minimum order, coupons, fees, and prices.

If the city is disabled while the customer is on checkout, the final server call blocks ordering. A stale UI never overrides current Admin configuration.

---

# 23. Platform Service Fee

The fixed customer-facing service fee is separate from restaurant commission. It is Admin-configurable and snapshotted on each order. The mobile application never hard-codes the amount.

Example line in Arabic checkout:

`رسوم الخدمة`

The customer sees every fee before confirming. No hidden fees are added after confirmation.

---

# 24. Restaurant Commission

Every restaurant has an effective-dated commission configuration.

```text
restaurant_commission_configs
id
restaurant_id
commission_rate_bps
settlement_policy
effective_from
effective_to nullable
created_by
created_at
```

Use basis points. For example, 12% = 1200 bps.

At order creation/completion according to final finance design, the applicable rate is snapshotted into the order. A later rate change cannot rewrite historical orders.

Recommended commission base:

```text
items subtotal
- restaurant-funded item discounts
```

Exclude customer platform service fee and other platform-owned amounts. The exact definition must be included in restaurant contracts and finance documentation.

---

# 25. Order Schema

```text
orders
id
public_order_number
user_id
restaurant_id
branch_id
status
payment_method
payment_status
currency
items_subtotal_iqd
delivery_fee_iqd
platform_service_fee_iqd
discount_total_iqd
customer_total_iqd
commission_base_iqd
commission_rate_bps_snapshot
commission_amount_iqd
restaurant_net_snapshot_iqd
customer_name_snapshot
customer_phone_snapshot
delivery_address_snapshot_json
restaurant_location_snapshot_json
placed_at
accepted_at nullable
ready_at nullable
out_for_delivery_at nullable
delivered_at nullable
completed_at nullable
cancelled_at nullable
version
created_at
updated_at
```

Use random/sortable internal IDs such as UUIDv7. Display a shorter human-friendly public order number separately.

---

# 26. Order State Machine

Recommended order states:

```text
PLACED
PENDING_RESTAURANT
ACCEPTED
PREPARING
READY
OUT_FOR_DELIVERY
DELIVERED
COMPLETED
REJECTED
CANCELLED
```

Payment states:

```text
UNPAID
CASH_EXPECTED
PAID_CASH
FAILED
REFUNDED_FUTURE
```

Transitions must be implemented as commands such as `AcceptOrder`, `MarkPreparing`, `MarkReady`, `PickupOrder`, and `ConfirmDelivery`. A generic API that lets a client submit any status string is prohibited.

---

# 27. Place Order Transaction

`PlaceOrder` is one of the most critical use cases.

It must:

1. Validate authenticated customer.
2. Validate profile completeness.
3. Validate effective governorate/city ordering.
4. Validate restaurant and branch.
5. Validate delivery-address geography/service area.
6. Validate menu item and modifiers.
7. Recalculate prices.
8. Calculate discounts.
9. Calculate platform fee.
10. Lock/check inventory.
11. Create order.
12. Create item/modifier snapshots.
13. Reserve inventory.
14. Snapshot commission.
15. Write initial status history.
16. Insert transactional outbox event.
17. Commit.
18. Publish realtime/push asynchronously.

The external notification provider must not be called while the database transaction remains open.

---

# 28. Idempotency

Use idempotency keys for operations where a retry can create duplicate money or state:

- Place order.
- Record settlement payment.
- Delivery completion.
- Driver cash handover.
- Commission adjustment.
- Coupon redemption.
- Settlement generation.

If a customer's network times out after Place Order, the app checks the result using the same idempotency key rather than blindly creating another order.

---

# 29. Restaurant Live Orders

Restaurant Portal must behave like an operations terminal, not only a reporting dashboard.

Arabic order lanes/tabs:

- `طلبات جديدة`
- `مقبول`
- `قيد التحضير`
- `جاهز`
- `قيد التوصيل`
- `مكتمل مؤخراً`

Order cards show order number, age, customer, items, notes, total, payment type, and driver assignment state.

A visible SLA timer highlights orders that have waited too long. Color is supplementary; text communicates the state for accessibility.

---

# 30. Audible New-Order Alert

A new order triggers:

- Immediate realtime insertion.
- Distinct audible alert.
- Browser notification when permission exists.
- Tab/title badge update.
- Repeated/escalated alert if not acknowledged according to policy.

Because browsers block uninitiated autoplay, the Restaurant Portal includes an explicit Arabic action after login: `تفعيل تنبيهات الطلبات`. Clicking it initializes the audio context and may request browser notification permission.

The alert manager deduplicates events. Multiple new orders do not create uncontrolled overlapping loops. Realtime reconnect performs a delta sync. During websocket failure, the portal polls pending orders. Sound is never the only indication of a new order.

---

# 31. Transactional Outbox and Realtime Reliability

Orders are not considered reliably announced merely because a websocket send was attempted.

Use:

```text
order DB transaction
→ outbox_events row in same transaction
→ worker reads outbox
→ realtime publish
→ push/browser notification
→ mark published
```

If realtime is down, the order remains safely stored and unpublished events remain retryable. Client reconnection uses event IDs/order versions and refetches pending data so duplicated events cannot duplicate alerts or state transitions.

---

# 32. Restaurant Accept/Reject

Accept verifies tenant membership, permission, order ownership, current status, expected version, and restaurant operational eligibility. It records actor and timestamp, updates status history, converts inventory reservation according to inventory policy, emits an outbox event, and notifies the customer.

Reject requires a reason such as unavailable item, excessive load, closing, address issue, or other. Rejection releases reservation, creates no sales/commission accrual, notifies customer, and records the reason for restaurant-quality analytics.

---

# 33. Working Hours and Busy Mode

Each branch has weekly hours and optional exceptions. Overnight hours such as 18:00–02:00 must be supported.

Busy modes:

- Normal.
- Busy +15 minutes.
- Very Busy +30 minutes.
- Pause new orders.

Busy mode can auto-expire so staff do not accidentally leave the restaurant unavailable all day.

---

# 34. Inventory Domain

Inventory is auditable and concurrency-safe.

```text
inventory_items
inventory_movements
inventory_reservations
recipes
```

Inventory item fields include branch, Arabic name, SKU, unit, on-hand quantity, reserved quantity, low-stock threshold, optional unit cost, tracking flag, and negative-stock policy.

Quantities such as grams or liters use fixed-precision decimal database types, not binary floating point.

---

# 35. Inventory Movements

Every stock change creates a movement.

Types include:

```text
OPENING_BALANCE
PURCHASE
RESERVATION
RESERVATION_RELEASE
SALE_CONSUMPTION
ADJUSTMENT
WASTE
RETURN
```

Finalized movement history is not casually deleted. Corrections create compensating movements. Large manual adjustments can require manager permission and mandatory reason.

---

# 36. Inventory Reservation and Concurrency

Do not reserve stock merely because an item is in a cart.

Recommended policy:

- Order placement reserves.
- Rejection/cancellation before consumption releases.
- Acceptance/preparation converts reservation into consumption based on configured restaurant policy.

If one cake remains and two customers place orders at the same moment, an atomic conditional update or row lock ensures only one reservation succeeds. Overselling cannot be solved only with UI disabling.

---

# 37. Recipes

Recipe inventory is optional for the first operational milestone but the schema should support it.

Example burger recipe:

```text
1 bun
1 patty
20 g sauce
1 cheese slice
```

When an ingredient becomes unavailable, linked products may automatically become unavailable if the restaurant enables that behavior. Auto-enabling after restock should only reverse an inventory-driven disable, not a manual manager disable.

---

# 38. Restaurant Expenses and Profitability

Restaurant Portal supports management accounting, not a claim to replace statutory accounting.

Expense categories can include salaries, rent, ingredients, utilities, marketing, maintenance, delivery, and other.

Recommended profit view:

```text
Net Sales
- Cost of Goods Sold
= Gross Profit

Gross Profit
- Jibli Commission
- Entered Operating Expenses
= Estimated Operating Profit
```

If cost data is incomplete, the Arabic UI explicitly says the profit is estimated from available data. Cost-price access is restricted to appropriate roles.

---

# 39. Finance Separation

Platform finance and restaurant private management accounting are distinct.

Platform tracks:

- Commission accrued.
- Platform service fee revenue.
- Adjustments.
- Amount due from restaurants.
- Payments.
- Outstanding/overdue settlements.

Restaurant management accounting tracks:

- Sales.
- Cost of goods.
- Expenses.
- Estimated profit.
- Driver cash custody.

The platform should not expose private restaurant cost information to broad Jibli staff roles without a business need and explicit permission.

---

# 40. Settlement Cycles

Each restaurant uses one contractual settlement policy.

Half-month:

- Period 1: day 1 inclusive to day 16 exclusive.
- Period 2: day 16 inclusive to first day of next month exclusive.

Monthly:

- First day of month inclusive to first day of next month exclusive.

Use half-open ranges `[start, end)` to avoid 23:59:59 precision mistakes. Boundaries are interpreted in Asia/Baghdad and converted to UTC for querying.

---

# 41. Settlement Generation

A scheduled Finance job:

1. Acquires a restaurant-period lock.
2. Finds completed eligible orders not already included elsewhere.
3. Loads immutable commission snapshots.
4. Loads approved adjustments.
5. Creates settlement and lines.
6. Validates totals.
7. Stores DRAFT.
8. Finance reviews during early launch.
9. Issues statement.
10. Sends notification.

A unique database constraint on restaurant and period prevents duplicate statements even if a worker retries.

---

# 42. Settlement and Payment Model

Settlement statuses:

```text
DRAFT
ISSUED
PARTIALLY_PAID
PAID
OVERDUE
DISPUTED
VOID
```

Restaurant-facing Arabic screen shows period, sales, order count, applicable commission rates, commission total, adjustments, amount due, amount paid, remaining amount, due date, and status.

Payment recording includes amount, method, reference, date, receipt attachment, and actor. Payments are immutable records. If a mistake occurs, create reversal/correction rather than editing history invisibly.

---

# 43. Financial Ledger

A platform operational ledger records commission and related events.

```text
ledger_entries
id
restaurant_id
order_id nullable
settlement_id nullable
entry_type
amount_iqd
direction
effective_at
idempotency_key
created_at
```

Examples:

- COMMISSION_ACCRUED.
- COMMISSION_PAYMENT.
- COMMISSION_CREDIT.
- COMMISSION_DEBIT.
- SERVICE_FEE_REVENUE.
- REVERSAL.

Balances are derived from ledger events or from a reconciled cached balance, not from uncontrolled increment/decrement logic scattered around the codebase.

---

# 44. Overdue and Disputes

When due date passes, the settlement becomes effectively overdue and is surfaced to Restaurant Owner/Accountant and Admin Finance. Automatic restaurant suspension is not recommended by default; Operations/Finance should make a controlled decision unless business policy explicitly enables automation.

A restaurant may dispute a settlement with reason, note, and optional attachment. Issued financial lines are not silently edited. Finance resolves through credit, debit, reversal, or controlled void/reissue workflow.

---

# 45. Driver Registration Model

Drivers belong to restaurants in Release 1. There is no open driver marketplace.

Restaurant Owner/Manager screen: `السائقون` → `إضافة سائق`.

Fields:

- Full name.
- Iraqi phone.
- Optional photo.
- Vehicle type.
- Optional plate number.
- Branch.
- Can collect cash.
- Internal note.

Creating the driver produces or links a user identity, creates driver profile and restaurant membership, and sends activation instructions. The driver activates using OTP in the Jibli mobile app.

---

# 46. Driver Data Model

```text
drivers
id
user_id
status
default_vehicle_type
photo_asset_id nullable
created_at
updated_at

restaurant_drivers
id
restaurant_id
branch_id
driver_id
can_collect_cash
is_active
created_by
created_at
deactivated_at nullable

delivery_assignments
id
order_id
restaurant_id
branch_id
driver_id
status
assigned_by
assigned_at
accepted_at nullable
picked_up_at nullable
arrived_customer_at nullable
delivered_at nullable
cancelled_at nullable
version
```

Driver account status is separate from availability.

Account:

```text
PENDING_ACTIVATION
ACTIVE
SUSPENDED
DEACTIVATED
```

Availability:

```text
OFFLINE
AVAILABLE
BUSY
ON_DELIVERY
BREAK
```

---

# 47. Driver Mode in React Native

After OTP/session resolution, the backend returns capabilities.

If customer only, show customer app. If driver only, show Driver Home. If both, display Arabic mode selector:

- `استخدام جيبلي كعميل`
- `استخدام جيبلي كسائق`

Driver tabs:

- `الرئيسية`
- `طلباتي`
- `الحساب`

Home displays availability toggle, active task, delivery count, and COD cash summary appropriate to the driver.

---

# 48. Driver Assignment

Restaurant Portal order card exposes `تعيين سائق` when assignment is appropriate.

The backend returns eligible drivers based on active membership, branch, status, availability, and active assignment capacity. Release 1 default should be one active delivery at a time.

Assignment endpoint validates everything again. A driver shown as available in the UI may become busy milliseconds later. Concurrency is resolved by backend state/version checks.

The assignment creates a realtime/push event for the driver. The driver may accept or reject with a reason. Rejected assignments remain in history and the restaurant can assign someone else.

---

# 49. Driver Delivery Flow

Delivery assignment states can be detailed internally, but the user-facing flow remains simple:

```text
ASSIGNED
→ ACCEPTED
→ PICKED_UP
→ NAVIGATING_TO_CUSTOMER
→ ARRIVED_CUSTOMER
→ DELIVERED
```

The order remains READY while a driver is merely assigned. It becomes OUT_FOR_DELIVERY when the driver confirms pickup.

The old driver loses delivery rights immediately after reassignment.

---

# 50. Google Maps and Waze

Release 1 should not build turn-by-turn navigation inside Jibli. The driver uses external navigation.

Google Maps default URL:

```text
https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=driving
```

Waze alternative:

```text
https://waze.com/ul?ll=LAT,LNG&navigate=yes
```

Google Maps URLs are cross-platform and do not require a Google API key merely to open Maps URLs. Waze deep links can open the app when installed or web otherwise. Jibli also provides `نسخ العنوان` as a fallback.

No authentication token, delivery PIN, or sensitive secret is ever included in an external deep link.

---

# 51. No Live GPS in Release 1

Jibli does not continuously upload driver location in the first release. This reduces battery use, background permission complexity, privacy burden, map cost, and OS-specific reliability issues.

Driver presence can be a lightweight heartbeat while Driver Mode is active. Presence is not location tracking.

Live GPS can be added later as a separately reviewed phase with background location permissions, retention policy, customer map, ETA logic, and dedicated privacy controls.

---

# 52. Delivery PIN

A short Delivery PIN is recommended for COD confirmation.

Properties:

- Randomly generated.
- Stored hashed.
- Tied to the order.
- Visible to the customer inside the app.
- Never visible to the driver or restaurant staff.
- Attempt-limited.
- Never logged.

At delivery, the driver enters the PIN. Successful verification completes the order. A manager/support override exists for exceptional cases and is strongly audited.

---

# 53. COD Completion Transaction

Delivery completion must be atomic and idempotent.

1. Validate authenticated driver.
2. Validate active assignment belongs to driver.
3. Validate current order/delivery state.
4. Validate PIN or authorized override.
5. Mark assignment delivered.
6. Mark order delivered/completed.
7. Mark payment as PAID_CASH.
8. Record COD cash collected.
9. Finalize inventory consumption if pending.
10. Create restaurant sales event.
11. Create commission accrual event.
12. Create driver cash custody event.
13. Add status history.
14. Add outbox events.
15. Commit.

A duplicate network retry returns the original successful result and cannot double-accrue commission or driver cash.

---

# 54. Driver Cash Custody

COD collected by a driver is restaurant cash custody, not Jibli commission payment.

```text
driver_cash_events
id
driver_id
restaurant_id
type
amount_iqd
order_id nullable
handover_id nullable
created_at
actor_user_id nullable
```

Types:

```text
ORDER_CASH_COLLECTED
CASH_HANDED_OVER
CASH_ADJUSTMENT
```

Restaurant accountant sees collected, handed-over, and remaining driver custody. A handover is confirmed and audited. Corrections use adjustment records.

---

# 55. Customer Order Tracking

Customer does not need a live driver dot in Release 1. Arabic timeline:

- `تم إرسال الطلب`
- `تم قبول الطلب`
- `قيد التحضير`
- `جاهز`
- `خرج للتوصيل`
- `السائق وصل`
- `تم التسليم`

After assignment, the customer may see driver first name/photo and a call action according to privacy policy.

---

# 56. Notifications

Customer transactional notifications include accepted, preparing, ready, out-for-delivery, arrived, delivered, cancelled.

Restaurant notifications include new order, settlement issued, commission due, low stock, platform message, staff invitation.

Driver notifications include new assignment, cancellation, order ready, and relevant task update.

Push tokens are device records with platform, app version, last seen, and revocation. Invalid provider tokens are disabled.

---

# 57. Customer Reviews

Only completed orders can be reviewed. One review per order. Restaurant rating uses 1–5 with optional comment. Moderation and abuse-report workflow exist. A future delivery rating can be separate from food rating.

---

# 58. Customer and Restaurant Search

Public search covers Arabic restaurant name, menu item name, and cuisine tags within the selected active city. Initial implementation can use PostgreSQL trigram/full-text capabilities with Arabic normalization such as Alef variants, tatweel removal, and whitespace normalization where safe.

Search never returns orderable results from a disabled ordering city.

---

# 59. Customer Favorites and Reorder

Favorites are simple user-to-restaurant links.

Reorder never blindly reuses historical prices. It rebuilds a new cart from current item IDs, prices, modifiers, and availability, then explains unavailable items.

---

# 60. Coupons

Coupon fields include code, type, amount/percentage, minimum order, max discount, usage limits, active period, restaurant scope, geography scope if needed, and funding source.

Funding source is critical:

```text
PLATFORM
RESTAURANT
SHARED
```

Restaurant-funded discount affects commission base according to contract; platform-funded discount does not automatically reduce restaurant net.

---

# 61. Restaurant Roles

Default roles:

**Owner** — full restaurant access.  
**Manager** — operations, menu, inventory, drivers, reports, selected finance.  
**Cashier** — live orders and possibly driver assignment, but no sensitive cost/profit.  
**Kitchen** — accepted/preparing/ready only.  
**Inventory Manager** — inventory, waste, purchases if added.  
**Accountant** — finance, expenses, settlements, driver cash.

Roles resolve to granular permissions. Authorization is checked server-side.

---

# 62. Admin Roles

Recommended platform roles:

- Super Admin.
- Operations Admin.
- Finance Admin.
- Restaurant Onboarding.
- Support Agent.
- Marketing.
- Analyst.
- Auditor.

Permissions include geography management, restaurant approval/suspension, commission update, global order read, financial statement issue, payment recording, adjustment creation, role management, audit read, and export.

Sensitive financial or identity actions can require re-authentication/MFA.

---

# 63. Tenant Isolation

Every restaurant request resolves membership from authenticated session. Submitted `restaurant_id` is never accepted as proof of access. Branch scopes are enforced. Exports and realtime channels use the same authorization model.

Security tests deliberately attempt cross-restaurant reads, writes, subscriptions, driver access, finance access, and export access.

---

# 64. Audit Logging

Audit fields:

```text
id
actor_user_id
actor_role
action
entity_type
entity_id
before_json
after_json
reason nullable
ip
user_agent
request_id
created_at
```

Audit high-risk actions including geography changes, restaurant approval/suspension, commission changes, role changes, settlement issue/void, payment recording, finance adjustments, delivery override, driver suspension, and customer block.

Never log passwords, OTPs, access tokens, refresh tokens, or delivery PIN values.

---

# 65. End of Core Domain Specification

The next sections define security, API standards, reliability, testing, phased implementation, and acceptance gates in detail.

---

# 66. API Design Standards

The public API should be versioned under `/api/v1`. REST is sufficient for Release 1 and keeps mobile, web, observability, caching, and authorization straightforward. GraphQL is not required merely because the product has multiple clients.

Suggested high-level routes:

```text
/api/v1/auth/*
/api/v1/geography/*
/api/v1/profile/*
/api/v1/addresses/*
/api/v1/restaurants/*
/api/v1/catalog/*
/api/v1/cart/*
/api/v1/checkout/*
/api/v1/orders/*
/api/v1/driver/*
/api/v1/restaurant-portal/*
/api/v1/admin/*
/api/v1/finance/*
/api/v1/support/*
```

Customer APIs, Restaurant APIs, Driver APIs, and Admin APIs must have clear authorization boundaries. A convenient shared controller folder must never become an excuse to expose Admin fields to public responses.

Success response convention:

```json
{
  "data": {},
  "meta": {}
}
```

Error convention:

```json
{
  "error": {
    "code": "CITY_NOT_AVAILABLE",
    "message": "هذه المدينة غير متاحة حالياً",
    "details": {},
    "request_id": "..."
  }
}
```

The client uses stable machine-readable `code` values. Arabic `message` remains human-facing.

---

# 67. Geography API Contracts

Customer-safe discovery:

```text
GET /api/v1/geography/governorates?capability=customer_signup
GET /api/v1/geography/governorates/{governorateId}/cities?capability=customer_signup
GET /api/v1/geography/governorates?capability=ordering
GET /api/v1/geography/governorates/{governorateId}/cities?capability=ordering
```

Restaurant onboarding:

```text
GET /api/v1/restaurant-portal/onboarding/geography/governorates
GET /api/v1/restaurant-portal/onboarding/geography/governorates/{id}/cities
```

Admin:

```text
GET   /api/v1/admin/geography/governorates
PATCH /api/v1/admin/geography/governorates/{id}
GET   /api/v1/admin/geography/cities
PATCH /api/v1/admin/geography/cities/{id}
GET   /api/v1/admin/geography/coverage-summary
```

Admin mutation bodies include desired capability values and reason when disabling or materially changing service coverage.

Public responses return only necessary information such as ID, Arabic name, and current selectable status. Internal source/version metadata belongs to Admin or internal APIs.

---

# 68. Customer Profile API

Profile completion:

```text
POST /api/v1/profile/complete
```

Example request:

```json
{
  "full_name": "محمد علي",
  "governorate_id": "uuid",
  "city_id": "uuid"
}
```

The backend validates:

- authenticated phone-verified user;
- profile state;
- name constraints;
- governorate exists;
- city exists;
- city belongs to governorate;
- customer-signup effective capability is true;
- request version/idempotency where needed.

Profile location update uses a separate endpoint and repeats geography validation.

---

# 69. Restaurant Onboarding API

Self-onboarding application:

```text
POST /api/v1/restaurant-portal/restaurants/applications
```

Fields include Arabic restaurant name, owner/contact, governorate, city, address, pin, cuisine, documents, and other required onboarding data.

Admin direct creation:

```text
POST /api/v1/admin/restaurants
```

Approval:

```text
POST /api/v1/admin/restaurants/{id}/approve
POST /api/v1/admin/restaurants/{id}/reject
POST /api/v1/admin/restaurants/{id}/request-info
```

Approval is a command, not a generic status patch, because approval may create activation records, invitations, notifications, audit entries, and readiness checks.

---

# 70. Order API

Customer:

```text
POST /api/v1/checkout/quote
POST /api/v1/orders
GET  /api/v1/orders
GET  /api/v1/orders/{id}
POST /api/v1/orders/{id}/cancel
POST /api/v1/orders/{id}/review
```

Restaurant:

```text
GET  /api/v1/restaurant-portal/orders/live
GET  /api/v1/restaurant-portal/orders/{id}
POST /api/v1/restaurant-portal/orders/{id}/accept
POST /api/v1/restaurant-portal/orders/{id}/reject
POST /api/v1/restaurant-portal/orders/{id}/start-preparing
POST /api/v1/restaurant-portal/orders/{id}/mark-ready
POST /api/v1/restaurant-portal/orders/{id}/assign-driver
```

Admin uses dedicated override commands rather than raw state updates.

---

# 71. Driver API

```text
GET   /api/v1/driver/me
PATCH /api/v1/driver/me/availability
GET   /api/v1/driver/deliveries
GET   /api/v1/driver/deliveries/{id}
POST  /api/v1/driver/deliveries/{id}/accept
POST  /api/v1/driver/deliveries/{id}/reject
POST  /api/v1/driver/deliveries/{id}/pickup
POST  /api/v1/driver/deliveries/{id}/arrived-customer
POST  /api/v1/driver/deliveries/{id}/confirm-delivery
```

Every endpoint verifies the active assignment belongs to the authenticated driver. A driver who was removed or reassigned cannot continue using a previously opened screen to mutate the task.

---

# 72. Inventory API

Restaurant inventory endpoints support list, create, update descriptive metadata, opening balance, movement, stocktake, waste, and reporting.

Do not expose an unrestricted endpoint such as `PATCH quantity=500`. Stock changes are domain commands:

```text
POST /inventory/{id}/receive
POST /inventory/{id}/adjust
POST /inventory/{id}/waste
POST /inventory/stocktakes
```

Each command creates movement history and requires permission/reason as appropriate.

---

# 73. Finance API

Restaurant read APIs:

```text
GET /restaurant-portal/finance/summary
GET /restaurant-portal/finance/settlements
GET /restaurant-portal/finance/settlements/{id}
GET /restaurant-portal/finance/expenses
POST /restaurant-portal/finance/expenses
```

Admin Finance:

```text
GET  /admin/finance/settlements
POST /admin/finance/settlements/{id}/issue
POST /admin/finance/settlements/{id}/record-payment
POST /admin/finance/settlements/{id}/adjustments
POST /admin/finance/settlements/{id}/void
```

Each sensitive mutation has its own permission and audit action.

---

# 74. Pagination, Filtering, Sorting, and Search Safety

High-volume lists use server-side pagination. Cursor pagination is preferred for order/event timelines; offset pagination is acceptable for smaller Admin tables if indexed and bounded.

Server must enforce a maximum page size. Sort fields are allowlisted; arbitrary client-provided SQL column names are prohibited. Search queries have reasonable maximum lengths and rate controls. Exports are background jobs when the requested range is large.

CSV exports must protect against spreadsheet formula injection in user-provided text values.

---

# 75. Validation Architecture

Validation occurs at multiple levels:

1. Client-side UX validation.
2. API schema validation.
3. Authorization.
4. Domain/business-rule validation.
5. Database constraints.

The client may show that a city is active, but the server decides. The API may validate a UUID, but the domain verifies the city belongs to the selected governorate. The domain may verify uniqueness, but the database still carries the final unique constraint to protect concurrent races.

Use shared Zod schemas only where doing so does not leak server-only details. Do not blindly share database models with the mobile app.

---

# 76. Error Taxonomy

Stable error codes improve mobile behavior and support.

Identity:

```text
OTP_RATE_LIMITED
OTP_INVALID
OTP_EXPIRED
ACCOUNT_SUSPENDED
SESSION_EXPIRED
```

Geography:

```text
GOVERNORATE_NOT_AVAILABLE
CITY_NOT_AVAILABLE
CITY_GOVERNORATE_MISMATCH
ORDERING_NOT_AVAILABLE_IN_CITY
```

Restaurant:

```text
RESTAURANT_NOT_APPROVED
RESTAURANT_SUSPENDED
RESTAURANT_CLOSED
BRANCH_NOT_AVAILABLE
```

Order:

```text
ITEM_UNAVAILABLE
PRICE_CHANGED
ORDER_ALREADY_UPDATED
ORDER_CANNOT_TRANSITION
ADDRESS_OUT_OF_SERVICE
MINIMUM_ORDER_NOT_MET
```

Driver:

```text
DRIVER_NOT_AVAILABLE
DELIVERY_ALREADY_ASSIGNED
DELIVERY_NOT_ASSIGNED_TO_DRIVER
DELIVERY_PIN_INVALID
```

Finance:

```text
SETTLEMENT_ALREADY_EXISTS
SETTLEMENT_LOCKED
PAYMENT_EXCEEDS_ALLOWED_BALANCE
FINANCIAL_RECONCILIATION_REQUIRED
```

---

# 77. Authentication and Session Security

Customer and driver login uses phone OTP. High-privilege web users require stronger controls.

Recommended policy:

- Super Admin and Finance Admin: password/passkey plus MFA.
- Restaurant Owner: password/passkey plus optional/encouraged MFA initially; stronger requirement can be enforced later.
- Cashier/Kitchen: controlled credentials/session policy.
- Customer/Driver: OTP.

Session requirements:

- Secure HttpOnly cookies for web where appropriate.
- Secure storage for mobile tokens.
- Refresh-token rotation if token architecture uses refresh tokens.
- Session revocation.
- Session listing for privileged users.
- Idle timeout for sensitive Admin roles.
- Absolute timeout.
- Immediate invalidation after role removal, staff deactivation, or platform suspension.

Authentication and authorization remain separate concerns. A successfully authenticated cashier still cannot read cost prices or settlements without permission.

---

# 78. OTP Abuse Protection

Document anti-automation controls as a formal security requirement.

Controls:

- per-number cooldown;
- per-number hourly/daily limits;
- IP/device-risk limits;
- limited verification attempts;
- challenge expiry;
- risk-based CAPTCHA/challenge if abuse detected;
- SMS spend monitoring;
- no detailed account-existence leakage;
- alert on unusual OTP failure or volume spikes.

Support must not "solve" OTP provider outages by manually bypassing customer verification in an insecure way.

---

# 79. Mobile Secure Storage and Deep Links

Sensitive session material belongs in Keychain/Keystore-backed storage. AsyncStorage can hold non-sensitive cached UI state but not bearer tokens, OTPs, passwords, private keys, or Delivery PIN values.

Internal deep links such as `jibli://orders/<id>` are only navigation hints. The app fetches the order from the authorized backend after opening. Deep links never contain tokens, customer addresses, or delivery PINs.

Universal/App Links are preferred where possible because custom URI schemes can be claimed by other applications.

---

# 80. Web Security and Next.js Caching

Authenticated Admin and Restaurant data must not accidentally enter a shared public cache. Finance views should be private/no-store where appropriate. Any cache key for tenant-specific data includes tenant scope and relevant authorization context.

Server Actions or Route Handlers still require explicit session and permission checks. A Next.js page being hidden from navigation does not secure the underlying action.

The platform must keep Next.js on a supported security-patched release line. Security advisories are reviewed routinely rather than waiting for a feature upgrade cycle.

---

# 81. CSRF, XSS, SQL Injection, and CORS

If web authentication uses cookies, apply SameSite policy, trusted-origin validation, and CSRF protection appropriate to the chosen architecture.

React output escaping remains enabled. Restaurant descriptions and customer notes are plain text. If rich text is introduced later, sanitize it with an audited library.

Database queries are parameterized through ORM/query builder. User-provided sort/filter values are mapped through allowlists rather than concatenated into SQL.

CORS allows only expected origins for credentialed browser access. Wildcard credentials are prohibited.

---

# 82. Security Headers

Restaurant/Admin web applications should use appropriately configured:

- HSTS.
- Content-Security-Policy.
- frame-ancestors / clickjacking protection.
- Referrer-Policy.
- X-Content-Type-Options.
- Secure cookies.

Finance pages should minimize third-party scripts.

---

# 83. File Upload Security

Public restaurant/menu images:

- MIME allowlist.
- File-size limit.
- Image dimension validation.
- Decode/re-encode where practical.
- Generated storage keys.
- Optimized variants.

Private onboarding/payment documents:

- Private storage.
- Signed temporary URLs.
- Strict authorization.
- Malware scanning when appropriate.
- No direct public object URL.

Never trust file extension alone.

---

# 84. PII and Privacy

Collect only data required for service. Customer onboarding requires phone, full name, governorate, city. Precise delivery address is collected when needed for delivery, not merely to create an account.

Driver Release 1 does not collect continuous background location. Restaurant staff should see only customer data needed to fulfill their restaurant's orders. Support roles can see masked phone values by default, with controlled unmask permission if operationally required.

Analytics and error monitoring must not receive raw phone numbers, OTPs, Delivery PINs, or full delivery addresses.

---

# 85. Authorization Model — RBAC plus Scope

A permission answers what action a user may take. Scope answers where the permission applies.

Restaurant user examples:

```text
order.read
order.accept
menu.write
inventory.adjust
driver.assign
finance.read
expense.write
staff.manage
```

Admin examples:

```text
geography.manage
restaurant.approve
restaurant.suspend
restaurant.commission.update
order.override
finance.settlement.issue
finance.payment.record
finance.adjustment.create
roles.manage
audit.read
```

Release 1 Admin scope may be global. The model should permit future governorate-level regional Admin scope without redesigning all permission checks.

Default is deny. Introducing a new permission does not automatically grant it to every existing role.

---

# 86. Restaurant Role Matrix

**Owner**: all restaurant operational and financial data, staff, drivers, settings.  
**Manager**: orders, menus, inventory, drivers, reports, selected staff/settings; finance according to configured role.  
**Cashier**: live orders, order acceptance/rejection, possibly driver assignment; no cost/profit by default.  
**Kitchen**: accepted/preparing/ready view; no customer finance or restaurant finance.  
**Inventory Manager**: stock, movements, waste, cost where authorized.  
**Accountant**: sales, expenses, commission statements, driver cash, settlement history; order read as needed.

A role change takes effect server-side immediately and can trigger session refresh/revocation for sensitive changes.

---

# 87. Admin Role Matrix

**Super Admin**: full platform, but still subject to audit and reauthentication for highly sensitive actions.  
**Operations Admin**: restaurants, orders, delivery operations, suspensions, service-area operations.  
**Finance Admin**: commissions, statements, payments, adjustments, finance reports.  
**Restaurant Onboarding**: applications and documents; approval may be separate.  
**Support Agent**: limited user/order support, no unrestricted finance.  
**Marketing**: banners, campaigns, coupons, aggregate analytics.  
**Analyst**: read-only approved reporting.  
**Auditor**: read-only audit/finance evidence according to scope.

---

# 88. Admin MFA and Critical Reauthentication

MFA is mandatory for Super Admin and Finance Admin before production launch. Critical operations can require reauthentication or a fresh MFA challenge:

- void settlement;
- large manual adjustment;
- role elevation to Super Admin/Finance;
- retroactive exceptional commission correction;
- sensitive account recovery;
- break-glass actions.

Recovery codes and account-recovery procedures are securely managed. Support cannot simply disable MFA because a user requests it informally.

---

# 89. Request IDs and Structured Logging

Every HTTP request receives a unique request ID. The ID propagates to application logs, audit metadata, outbox events, worker jobs, notification logs, and error-monitoring context.

Structured logs include service, environment, route, latency, request ID, internal user ID when appropriate, restaurant ID when appropriate, event name, and safe error code.

Sensitive headers, cookies, tokens, full phones, delivery addresses, OTPs, and PINs are redacted.

---

# 90. Health Checks

Expose lightweight endpoints:

```text
/health/live
/health/ready
```

Liveness answers whether the process is alive. Readiness answers whether the service can serve traffic based on critical dependencies. Do not execute expensive analytics queries as health checks.

---

# 91. Error Monitoring and Alerts

Monitor:

- Mobile crashes.
- React/Next.js runtime errors.
- API 5xx spikes.
- Database errors/latency.
- Worker job failures.
- Queue backlog.
- Realtime delivery delay.
- OTP provider failure.
- Settlement generation failure.
- Reconciliation mismatch.

Alerts should map to an owner and runbook. Avoid alerting on every harmless error while missing order-placement failures.

---

# 92. Redis Usage

Redis-compatible service may be used for:

- short-lived public/catalog cache;
- rate-limit state;
- driver/restaurant terminal presence;
- distributed locks for scheduled jobs;
- realtime pub/sub coordination;
- selected session metadata.

PostgreSQL remains authoritative for orders, finance, users, restaurants, geography, and assignments. Critical uniqueness must be backed by database constraints rather than Redis locks alone.

---

# 93. Queue Architecture

Recommended queues:

- notifications;
- finance;
- exports;
- media;
- analytics aggregation;
- maintenance.

Jobs are durable. Workers use retry with exponential backoff/jitter for transient errors. Permanent validation/authorization errors are not endlessly retried. Failed jobs move to a dead-letter or inspectable failed state that authorized operators can replay after correction.

---

# 94. Scheduled Jobs

Recurring tasks include:

- half-month/month settlement generation;
- overdue evaluation;
- OTP cleanup;
- expired campaign/coupon disable;
- daily financial reconciliation;
- aggregate report refresh;
- orphan storage cleanup;
- stale order alerts;
- stale inventory reservation checks;
- inactive push token cleanup.

Distributed locking prevents two worker instances from generating the same settlement. Database uniqueness remains the final protection.

---

# 95. Financial Reconciliation

Reconciliation is an explicit product feature, not an afterthought.

Daily/periodic invariants:

```text
completed order commission snapshots
= commission-accrual ledger entries
```

For driver-delivered COD:

```text
completed COD orders
= driver ORDER_CASH_COLLECTED events
```

Settlement:

```text
sum included eligible commission
+ approved adjustments
= settlement amount due
```

A mismatch creates an alert and blocks blind confidence in finance reports. Automated reconciliation may identify a problem but should not silently rewrite financial history.

---

# 96. Driver Cash Reconciliation

For each driver:

```text
opening custody
+ COD collected
- cash handed over
+/- authorized adjustments
= current custody
```

Restaurant Accountant screen should make this equation understandable. Handover events include amount, time, driver, receiving employee, and reference/note. A confirmed handover is immutable.

---

# 97. Geography Reconciliation and Integrity Jobs

A periodic integrity job checks:

- every city has valid governorate;
- no duplicate canonical codes;
- no restaurant branch references invalid geography;
- no customer profile references invalid geography;
- no impossible effective capability state in cached read models;
- no stale coverage cache after configuration events.

It reports inconsistencies; it does not silently move restaurants or customers between cities.

---

# 98. Database Index Strategy

Likely indexes include:

```text
orders (restaurant_id, status, created_at desc)
orders (user_id, created_at desc)
orders (branch_id, completed_at)
restaurant_branches (city_id, is_active)
cities (governorate_id, ordering_enabled)
restaurant_members (user_id, restaurant_id)
delivery_assignments (driver_id, status, created_at desc)
settlements (restaurant_id, period_start, period_end)
ledger_entries (restaurant_id, effective_at)
inventory_movements (inventory_item_id, created_at)
audit_logs (entity_type, entity_id, created_at)
```

Indexes are reviewed using real query plans. Do not index every column automatically.

---

# 99. Database Constraints

Database constraints provide race-condition safety:

- unique canonical geography codes;
- foreign key city→governorate;
- commission basis points 0–10000;
- positive order-item quantity;
- unique public order number;
- unique settlement per restaurant/period;
- valid enum/check constraints;
- unique idempotency keys in relevant scopes;
- unique event-recipient-channel notification where used;
- appropriate membership uniqueness.

Application validation gives good errors; constraints give final safety.

---

# 100. Money Data Types

All IQD monetary values are integer minor values. Since Release 1 treats IQD without fractional display, store values such as 31,000 as integer 31000.

Do not use JavaScript floating-point for financial calculations. Create a tested Money utility/domain type. Commission percentage uses basis points and one deterministic rounding policy. The same utility is used for order totals, settlements, reports, and exports.

---

# 101. Inventory Data Types

Inventory quantities may contain decimals such as 0.250 kg or 20.5 liters. Use a fixed-precision decimal database type. Recipe units use canonical units for each ingredient. Arbitrary conversion systems can be added later; Release 1 should avoid hidden floating-point conversions.

---

# 102. Working Time and Settlement Time

All persisted event timestamps use UTC. Business date calculations use `Asia/Baghdad`.

Test:

- restaurant open across midnight;
- month with 28, 29, 30, 31 days;
- year boundary;
- half-month day 15/16 boundary;
- order completed exactly near a settlement boundary.

Settlement membership is based on `completed_at`, not order creation time, unless Finance explicitly decides otherwise.

---

# 103. Order Status History

Every transition creates:

```text
order_status_history
id
order_id
from_status
to_status
actor_type
actor_user_id nullable
reason nullable
metadata_json nullable
created_at
```

Customer sees a friendly subset. Restaurant sees operational timeline. Admin sees full operational/audit view. Internal support notes remain separate from customer-visible status.

---

# 104. Delivery Assignment History

Reassignment does not erase old assignment. Preserve:

- assigned driver;
- assigned by;
- response;
- rejection reason;
- timeout/cancel;
- replacement driver;
- pickup/delivery timestamps.

This supports performance reports and dispute investigation.

---

# 105. Restaurant Working-Hour Evaluation

Working-hour calculation belongs in a single backend service. The mobile app may display current state, but checkout and acceptance eligibility use server time and server logic.

Holiday/special-day exceptions can override weekly hours. A temporary manual pause does not rewrite working hours.

---

# 106. Restaurant Service Zones

Release 1 can begin with city-level service plus optional district/radius restrictions. If radius is used, checkout validates coordinates server-side. If polygon delivery areas become important, add PostGIS later.

The customer profile city does not guarantee an address is inside a specific restaurant's delivery zone. Address eligibility remains restaurant/branch-specific.

---

# 107. Customer Address Privacy and Retention

Only the currently assigned driver needs precise location for a current delivery. Restaurant staff with order permissions need current address for fulfillment. Historical driver screens can hide precise addresses after a retention window while the backend preserves required records securely.

Push notification bodies should avoid full addresses because they may appear on a locked phone screen.

---

# 108. Navigation Failure Fallbacks

If coordinates are missing or invalid:

- attempt an encoded address query when appropriate;
- allow `نسخ العنوان`;
- allow calling customer;
- flag the address/restaurant workflow for correction.

The order must not become impossible to finish merely because an external maps application is unavailable.

---

# 109. Offline Customer Behavior

The app may display cached restaurants and cart state, but order placement requires connectivity. If Place Order times out, the app enters a "checking order status" state and resolves the idempotency key rather than assuming failure.

A saved address and cart can be available offline, but price, geography, availability, and final quote are revalidated online.

---

# 110. Offline Restaurant Behavior

If websocket disconnects:

- display visible offline/reconnecting banner;
- retry with backoff;
- poll live orders;
- perform delta sync after reconnect.

Order acceptance is not considered complete until the server confirms. The UI must not show success based only on optimistic local state for financial/operational commands.

---

# 111. Offline Driver Behavior

The current assignment can be cached for display so the driver can still view the address and continue external navigation. Final delivery confirmation and cash recording require server acknowledgement. Do not queue a final financial completion offline and pretend it succeeded.

When the application restarts, it fetches active assignments and restores the correct task.

---

# 112. Customer Error UX

Map stable errors to specific Arabic experiences.

`CITY_NOT_AVAILABLE` → explain service is not currently available and refresh city options.  
`ITEM_UNAVAILABLE` → identify unavailable item and keep the rest of cart.  
`PRICE_CHANGED` → show old/new relevant price and request confirmation.  
`RESTAURANT_CLOSED` → preserve cart but block checkout.  
`ADDRESS_OUT_OF_SERVICE` → request another address.  
`MINIMUM_ORDER_NOT_MET` → show required minimum.

Avoid generic "something went wrong" for recoverable business conditions.

---

# 113. Restaurant Error UX

`ORDER_ALREADY_UPDATED` → refresh current order state.  
`DRIVER_NOT_AVAILABLE` → reopen eligible-driver selector.  
`STOCK_CONFLICT` → show current stock and affected item.  
`PERMISSION_REVOKED` → deny action and refresh/re-auth session.  
`CITY_ORDERING_DISABLED` → show platform coverage banner rather than letting staff troubleshoot menus unnecessarily.

---

# 114. Admin Destructive Action UX

Disabling a city, suspending a restaurant, voiding a settlement, deleting a restaurant, or performing a large finance correction requires deliberate confirmation.

For geography disable, show affected counts such as active restaurants, active orders, and user profiles. Require a reason. Existing active orders continue by default. The Admin UI must describe this behavior before confirmation.

---

# 115. Cache Strategy

Safe short-lived cache candidates:

- public active geography lists;
- cuisine categories;
- public restaurant cards;
- menu snapshots with versioning;
- aggregate dashboards.

Do not cache private finance or tenant data in a shared public cache. Do not rely on cache freshness for final checkout eligibility.

When Admin changes geography, publish an invalidation event. Even if invalidation temporarily fails, server-side checkout validation reads authoritative current state.

---

# 116. Menu Versioning and Cart Revalidation

A restaurant menu can expose a `menu_version`. The cart records references and last seen version for UX. Checkout revalidates regardless of version. If prices or availability changed, the server returns structured differences.

---

# 117. Feature Flags

Use feature flags for high-risk staged features such as:

- Delivery PIN;
- advanced recipes;
- new checkout;
- service fee behavior;
- city pilot features;
- driver cash module;
- coupon engine.

Feature flags do not override authorization or geography. A feature flag cannot make a disabled city orderable.

---

# 118. Remote Configuration

Admin-managed configuration may include:

- platform service fee;
- default commission;
- default settlement policy;
- OTP cooldown settings;
- order acceptance timeout;
- Delivery PIN requirement;
- support phone;
- global checkout enabled;
- minimum app version.

Sensitive changes are versioned/audited.

---

# 119. App Version Enforcement

Backend config returns latest version and minimum supported version. The app may show optional update or force update. Never deploy a breaking API change assuming every customer immediately updates mobile.

---

# 120. API Backward Compatibility

Prefer additive response fields and endpoints. Deprecate old behavior through versioned rollout. Breaking mobile API changes require a new API version or a coordinated minimum-version policy.

OpenAPI change checks can run in CI.

---

# 121. Object Storage and Image Pipeline

Restaurant logo, cover, and menu item images are uploaded through signed/controlled flows. Store original metadata and generate optimized variants such as thumbnail, card, and full.

Public images use CDN. Private documents use signed temporary URLs. Replaced/orphan assets are garbage-collected only after reference checks.

---

# 122. Restaurant Onboarding Readiness Checklist

Before a restaurant can become ACTIVE/orderable:

- application approved;
- city ordering enabled;
- owner active;
- branch location valid;
- working hours configured;
- at least one active menu category/item;
- commission configured;
- settlement policy configured;
- delivery responsibility configured;
- at least one active driver if own-driver delivery is mandatory;
- order-alert setup tested/acknowledged;
- no critical missing required documents.

Admin approval UI shows readiness failures rather than relying on memory.

---

# 123. Restaurant Geography Change Safety

Minor address text/pin correction is different from governorate/city relocation. Create separate permissions/workflows. A restaurant cannot move from one active market to another simply by editing a dropdown after approval.

If a restaurant relocation is approved, future orders use new location; historical order and settlement data retains prior snapshots.

---

# 124. Geography Rollout Workflow

Recommended opening of a new city:

1. Canonical city already exists in master data.
2. Enable restaurant onboarding while ordering remains off.
3. Recruit and approve restaurants.
4. Create restaurant drivers.
5. Complete menus and readiness checks.
6. Run test orders.
7. Enable customer signup if desired.
8. Enable ordering.
9. Monitor order success, restaurant acceptance, driver completion, and support load.
10. If needed, disable only ordering while preserving all data.

This staged activation is a major reason the geography module uses separate capability flags.

---

# 125. Global Maintenance and Effective Ordering

Final effective checkout eligibility can be represented conceptually as:

```text
globalCheckoutEnabled
AND governorate.orderingEnabled
AND city.orderingEnabled
AND restaurant.approved
AND restaurant.active
AND branch.active
AND branch.acceptsOrders
AND workingHours.allow
AND serviceZone.allow
AND items.available
AND inventory.available
```

Each layer remains independent. Pausing a restaurant does not disable its city. Disabling a city does not mark every restaurant record suspended.

---

# 126. Customer Profile and Transaction Geography Analytics

Do not confuse profile geography with order geography.

Use:

- profile governorate/city for default customer segmentation;
- delivery-address/order snapshot geography for transactional reporting;
- branch snapshot geography for restaurant performance.

If a customer moves later, historical sales remain attributed to the actual order geography.

---

# 127. Admin Geography Coverage Matrix

Useful Admin report columns:

```text
Governorate
City
Customer signup
Restaurant onboarding
Ordering
Approved restaurants
Active restaurants
Active drivers
Customers
Orders 7d
GMV 7d
Acceptance rate
Average delivery duration
```

This helps decide expansion without letting analytics automatically activate coverage.

---

# 128. Analytics Event Principles

Customer events:

- app_open;
- otp_requested;
- otp_verified;
- profile_completed;
- restaurant_opened;
- item_added;
- checkout_started;
- order_placed;
- order_completed.

Restaurant events:

- order_alert_received;
- order_accepted;
- order_rejected;
- item_unavailable;
- driver_assigned;
- inventory_adjusted.

Driver events:

- assignment_received;
- assignment_accepted;
- pickup;
- navigation_opened;
- arrived;
- delivered.

Use pseudonymous internal IDs and avoid PII.

---

# 129. Operational KPIs

Platform:

- Active restaurants.
- Active customers.
- Orders/day.
- Completion rate.
- Average order value.
- Restaurant acceptance rate/time.
- Delivery duration.
- Commission accrued/collected/outstanding.
- Overdue settlements.
- Active service cities.

Restaurant:

- Orders today.
- Sales.
- Average order.
- Cancellation rate.
- Preparation time.
- Delivery time.
- Top items.
- Low stock.
- Estimated profit.
- Current commission.
- Driver cash custody.

---

# 130. Admin Dashboard Language and Layout

The Admin Portal is Arabic RTL only. Major groups can include:

- `الرئيسية`
- `إدارة المطاعم`
- `طلبات الانضمام`
- `إدارة الطلبات`
- `المستخدمون`
- `السائقون`
- `العمولات والتسويات`
- `التقارير المالية`
- `المناطق والتغطية`
- `الأدوار والصلاحيات`
- `سجل الأنشطة`
- `الإعدادات`

Cards show definitions consistently. For example, "Platform revenue" must not mix accrued commission with collected cash.

---

# 131. Restaurant Dashboard Language and Layout

Arabic RTL navigation:

- `الرئيسية`
- `الطلبات`
- `المنيو`
- `المخزون`
- `الأرباح`
- `العمولات`
- `التسويات`
- `السائقون`
- `الموظفون`
- `الإعدادات`

Live operational content takes priority over decorative analytics. New orders and alerts remain visible without scrolling through charts.

---

# 132. Driver UI Language

Arabic-only labels include:

- `متاح لاستلام الطلبات`
- `طلب توصيل جديد`
- `قبول الطلب`
- `رفض`
- `استلمت الطلب`
- `فتح في Google Maps`
- `فتح في Waze`
- `وصلت إلى العميل`
- `تأكيد التسليم`
- `رمز التسليم`

The interface must be usable one-handed on common Android phones.

---

# 133. Customer UI Language

Arabic-only primary labels include:

- `تسجيل الدخول`
- `رقم الهاتف`
- `إرسال رمز التحقق`
- `أكمل معلوماتك`
- `الاسم الكامل`
- `المحافظة`
- `المدينة`
- `الرئيسية`
- `المطاعم`
- `طلباتي`
- `المفضلة`
- `حسابي`
- `الدفع عند الاستلام`
- `إتمام الطلب`

---

# 134. Accessibility

Requirements:

- Adequate contrast.
- Large touch targets.
- Screen-reader labels.
- Keyboard access on web.
- Validation errors associated with fields.
- Status never communicated only by color.
- Safe alert animation without rapid flashing.
- Order sound accompanied by visible alert.

Governorate/city selectors support Arabic search, keyboard navigation on web, loading states, and accessible labels.

---

# 135. Low-End Device and Weak-Network Testing

Iraq-focused QA includes low/mid-range Android devices, limited memory, weak mobile data, intermittent connectivity, and Arabic RTL. Performance decisions should not be made only on a modern iPhone and gigabit Wi-Fi.

Measure cold start, Home first content, menu rendering, cart interaction, image loading, and memory. Use appropriately sized images and virtualized lists.

---

# 136. Web Browser Test Matrix

Restaurant Portal must be tested on modern Chrome and Edge, plus Safari/iPad if restaurants may use iPads. Order sound behavior requires real-device/manual verification because browser autoplay/background behavior varies.

Admin Portal targets modern desktop browsers with responsive support for tablets where practical.

---

# 137. Mobile Performance Rules

- Lazy-load images.
- Use CDN variants.
- Virtualized lists.
- Avoid unnecessary global state.
- Cache server data with explicit stale rules.
- Use skeleton states.
- Avoid repeated API calls on every scroll event.
- Keep navigation/resume reliable after external Maps.
- Monitor bundle size and crash-free sessions.

---

# 138. Web Performance Rules

- Server-side pagination.
- Aggregate chart endpoints.
- Avoid N+1 queries.
- Use indexes for common filters.
- Do not send thousands of order rows to render a chart.
- Cache only safe data.
- Keep realtime event payloads small.

---

# 139. CI Pipeline

Every pull request runs:

- deterministic dependency install;
- lint;
- format check;
- TypeScript typecheck;
- unit tests;
- integration tests;
- web builds;
- API build;
- migration checks;
- OpenAPI compatibility check where implemented;
- dependency/security scan;
- selected mobile build/static checks.

Required checks block merge.

---

# 140. Git and Review Strategy

Use protected main branch, short-lived feature branches, pull-request review, and release tags. Finance-domain changes require a reviewer who understands settlement/accounting behavior. Production database migrations receive explicit review.

No routine production change is made manually outside version-controlled deployment paths.

---

# 141. Coding Standards

- TypeScript strict.
- Avoid `any` except documented boundary cases.
- No business logic in React presentation components.
- No duplicated commission formulas.
- No ad hoc date arithmetic.
- No money floating point.
- No direct raw status edits.
- Stable domain errors.
- Shared clock abstraction for testable time logic.
- Structured logging.
- Functions/modules organized around domain use cases.

---

# 142. Architecture Decision Records

Create ADRs for at least:

- Monorepo.
- Modular monolith.
- PostgreSQL.
- Geography master data and capability flags.
- Customer profile geography vs delivery address.
- Next.js App Router.
- React Native Driver Mode in same app.
- Order state machine.
- Transactional outbox.
- Inventory reservation.
- Financial ledger.
- Commission snapshots.
- Settlement periods.
- External Google Maps/Waze navigation.
- No live GPS in Release 1.

---

# 143. Definition of Done

A feature is complete only when code, backend validation, authorization, Arabic RTL UI, loading/empty/error states, tests, audit where needed, analytics where needed, staging verification, documentation, and operational/monitoring considerations are complete.

A screenshot that looks complete is not a completed feature if the API can be bypassed or finance cannot reconcile it.

---

# 144. Unit Test Strategy

High-value unit tests include:

- phone normalization;
- geography effective capability;
- city-governorate relationship validation;
- restaurant eligibility;
- working-hour logic;
- order state transitions;
- money calculations;
- commission basis points/rounding;
- coupon funding allocation;
- settlement boundary calculations;
- inventory reservation math;
- recipe consumption;
- driver assignment eligibility;
- Delivery PIN verification;
- role/permission decision helpers.

Tests use an injected clock for deterministic date/time behavior.

---

# 145. Database Integration Tests

Use a real ephemeral PostgreSQL instance or isolated test database for critical flows. Mocking an ORM alone is insufficient for unique constraints, locking, transactions, and SQL behavior.

Integration tests include:

- concurrent order placement against last stock;
- duplicate idempotency key;
- simultaneous restaurant accept attempts;
- simultaneous driver assignment attempts;
- unique settlement period;
- commission effective-date snapshot;
- partial payment;
- driver cash event uniqueness;
- geography disable during transaction;
- tenant-scoped queries.

---

# 146. Customer E2E Tests

Critical happy path:

1. Launch app.
2. Enter Iraqi phone.
3. Verify OTP.
4. Enter full name.
5. Select enabled governorate.
6. Select enabled city.
7. Reach Home.
8. Open restaurant.
9. Add products/modifiers.
10. Add delivery address.
11. Checkout COD.
12. Place order.
13. Restaurant accepts.
14. Driver assigned.
15. Order goes out for delivery.
16. Customer views Delivery PIN.
17. Driver confirms.
18. Order shows completed.
19. Customer reviews.

Failure paths include disabled city, price change, out-of-stock item, closed restaurant, invalid address, and network timeout after Place Order.

---

# 147. Customer Geography E2E Tests

- Only active signup governorates appear after OTP.
- City list changes when governorate changes.
- Old city selection clears.
- City disabled by Admin before submit causes a controlled error.
- Returning user skips onboarding.
- Legacy incomplete user is routed to onboarding.
- User can change profile city only to active signup geography.
- Existing address remains after profile city change.
- Ordering-disabled saved address remains visible but cannot checkout.

---

# 148. Restaurant E2E Tests

1. Restaurant owner signs in.
2. Completes/submits onboarding in an enabled city.
3. Admin approves.
4. Restaurant configures menu/hours.
5. Sound activation works.
6. New order arrives realtime.
7. Cashier accepts.
8. Kitchen starts preparing.
9. Marks ready.
10. Manager/cashier assigns driver.
11. Driver accepts/picks up.
12. Delivery completes.
13. Inventory moves.
14. Sales/commission appear.
15. Driver cash appears.

Also test city ordering disabled while Restaurant Portal remains usable for historical/finance functions.

---

# 149. Driver E2E Tests

- Restaurant creates driver.
- Driver OTP activates.
- Driver sees Driver Mode.
- Sets AVAILABLE.
- Receives push/in-app assignment.
- Accepts.
- Pickup changes order to OUT_FOR_DELIVERY.
- Google Maps link is valid.
- Waze link is valid.
- App resumes after Maps.
- Arrived status works.
- Wrong Delivery PIN is rate-limited.
- Correct PIN completes once.
- COD cash event appears once.
- Reassigned old driver cannot complete.

---

# 150. Admin E2E Tests

- MFA login.
- Geography coverage view.
- Enable governorate customer signup.
- Enable city signup.
- Enable restaurant onboarding.
- Approve restaurant.
- Enable ordering.
- Verify customer can see restaurant.
- Disable city ordering.
- Verify new checkout blocked while active order remains.
- Change restaurant commission with future effective date.
- Generate settlement.
- Record partial payment.
- Complete payment.
- Suspend restaurant.
- Verify audit logs.

---

# 151. Financial Golden Tests

Maintain fixed datasets with known expected results for:

- order totals;
- fee/discount combinations;
- multiple commission rates in one settlement period;
- half-month period;
- monthly period;
- credit/debit adjustment;
- partial payment;
- reversal;
- driver cash custody;
- restaurant-funded vs platform-funded coupon.

These tests should be difficult to accidentally change without an explicit review.

---

# 152. Geography Seed Tests

CI validates:

- expected 19 governorates for current source version;
- Arabic names non-empty;
- canonical codes unique;
- every city has a parent governorate;
- city canonical codes unique in chosen namespace;
- deterministic seed output;
- no orphan aliases;
- no duplicate active records caused by rerunning import.

If the official master changes, the expected dataset version changes through a reviewed migration rather than silently breaking CI.

---

# 153. Geography Business-Rule Tests

- Parent governorate signup false makes child effectively false.
- Parent ordering false makes child effectively false.
- City onboarding false blocks restaurant submission.
- City ordering false blocks checkout.
- City ordering false does not cancel existing order.
- Disabling does not delete address.
- Disabling does not suspend restaurant record.
- Re-enabling does not automatically approve suspended restaurant.
- Admin without `geography.manage` cannot mutate.
- Every mutation writes audit and invalidation event.

---

# 154. Tenant-Isolation Security Tests

For every Restaurant endpoint, test:

- Restaurant A user can access A.
- A cannot access B by guessing/changing ID.
- Deactivated A staff cannot access A.
- Cashier cannot access A finance if permission absent.
- Driver cannot access restaurant financial data.
- Restaurant export cannot include B rows.
- Realtime subscription to B channel denied.

Any discovered tenant isolation defect becomes a permanent regression test.

---

# 155. Authentication Security Tests

- OTP request rate limits.
- OTP verification rate limits.
- Expired challenge.
- Reused challenge.
- Session revocation.
- Staff role removal.
- Driver suspension.
- Admin MFA requirement.
- Refresh-token reuse if applicable.
- account-recovery authorization.

---

# 156. OWASP Security Testing

Before launch, perform an ASVS 5.0 Level 2-oriented review covering architecture/threat modeling, authentication, sessions, authorization, input handling, cryptography, data protection, communications, business logic, files, APIs, and configuration.

Manual or automated security testing should explicitly look for:

- IDOR/broken access control;
- XSS;
- SQL injection;
- CSRF;
- file upload abuse;
- rate-limit bypass;
- session fixation/reuse;
- role escalation;
- price tampering;
- settlement manipulation;
- delivery-completion abuse.

No unresolved Critical or High finding is accepted for production launch.

---

# 157. Load and Peak Testing

Simulate lunch/dinner peaks, including a burst to one popular restaurant. Test:

- Home list.
- Search.
- Menu.
- Checkout quote.
- Place Order.
- Realtime publication.
- Restaurant live order updates.
- Driver assignment.
- Admin dashboards.
- Settlement batch.

Use production-like data sizes. A system that works only with ten rows in a local database is not load-tested.

---

# 158. Chaos/Failure-Mode Exercises

Staging exercises should include:

- realtime gateway unavailable;
- Redis unavailable;
- push provider unavailable;
- OTP provider unavailable;
- worker restart;
- API restart during order traffic;
- queue backlog;
- object storage failure;
- database read latency increase;
- city disabled while customers have stale cache.

The goal is not zero degradation. The goal is preserving order/financial truth and providing predictable fallback behavior.

---

# 159. Backups and Restore

Use automated database backups and point-in-time recovery where available. Define retention, RPO, and RTO. Object storage lifecycle and backup posture must be documented.

Run a restore drill before launch. Restore staging from backup and verify users, geography, restaurants, orders, inventory, drivers, ledger, and settlements. A backup is not trusted until restoration succeeds.

---

# 160. Incident Severity and Runbooks

SEV1 examples:

- orders cannot be created;
- financial corruption risk;
- cross-tenant data exposure;
- widespread authentication outage.

SEV2:

- realtime unavailable but polling works;
- push provider outage;
- non-critical Admin functionality unavailable.

SEV3:

- banner/analytics display problem.

Each critical service has a runbook with containment, communication, verification, and recovery steps.

---

# 161. Geography Incident Runbook

If an incorrect city is accidentally enabled:

1. Disable ordering capability immediately.
2. Preserve active orders.
3. Identify affected restaurants/orders/customers.
4. Notify Operations/Support.
5. Correct configuration.
6. Validate cache invalidation.
7. Re-enable only after verification.
8. Review audit and perform postmortem if material.

Do not delete the city or restaurant records to "fix" coverage.

---

# 162. Finance Incident Runbook

If a commission/settlement defect is suspected:

1. Pause statement issuance if required.
2. Continue ordering if financial accrual data remains safely captured.
3. Identify affected order range.
4. Reconcile snapshots and ledger.
5. Never bulk-edit historical amounts without trace.
6. Apply adjustments or controlled reissue.
7. Notify affected internal/business parties as required.
8. Add regression test.

---

# 163. Production Monitoring SLO-Oriented Metrics

Monitor at minimum:

- API availability.
- Place Order success rate.
- Place Order p95 latency.
- Realtime event delay.
- Restaurant pending-order age.
- Queue backlog.
- DB latency/connections.
- Driver delivery completion error rate.
- Settlement job success.
- Reconciliation mismatch count.
- Mobile crash-free sessions.

Business alert example: orders are being placed but restaurant acknowledgements drop abnormally to zero.

---

# 164. Data Retention and Deletion

Define retention separately for orders/finance, audit logs, OTP attempts, application logs, push tokens, support tickets, delivery details, and private documents. Retention must be reviewed with Iraqi legal/accounting advice.

Customer deletion can anonymize unnecessary PII while preserving required financial history. Driver/staff deletion is generally deactivation because historical order responsibility must remain understandable.

---

# 165. Exports

Restaurant export is restricted to own restaurant/authorized branches. Admin export requires permission. Large exports run as jobs and return expiring signed download links.

Audit the export event when it contains sensitive or financial data.

---

# 166. CSV and Arabic Compatibility

Use UTF-8 and test common spreadsheet applications. If necessary, include UTF-8 BOM for compatibility. Protect cells beginning with spreadsheet formula characters when the value originates from user input.

---

# 167. Printable/PDF Statements

A later PDF statement should be generated server-side from locked settlement data. Arabic RTL layout must be tested. PDF generation must not reimplement calculations independently from Finance domain data.

---

# 168. App Store and Platform Permissions

Request only needed mobile permissions. Release 1 may use notifications and foreground location for convenient map pin selection. It does not require contacts, broad storage access, or background location.

Permission prompts explain value in Arabic and appear in context rather than immediately on install without explanation.

---

# 169. Maps SDK vs Maps URLs

Opening Google Maps directions through Maps URLs does not require a Google Maps API key. If Jibli embeds an interactive Google map for address-pin selection, that SDK/API is a separate concern and must use properly restricted keys and budget monitoring.

Waze navigation remains a deep-link option and does not replace Jibli order state.

---

# 170. Vendor Abstraction

Use interfaces around external providers:

```text
OtpProvider
PushProvider
ObjectStorage
NavigationLinkBuilder
```

The domain should not contain vendor-specific response objects. This keeps provider replacement practical.

---

# 171. Release Strategy

Use staged rollout:

- internal team;
- staging pilot;
- selected restaurants;
- selected city;
- broader city rollout;
- additional cities.

Geography activation is itself a rollout control. Do not activate all Iraq merely because all master data exists.

---

# 172. Pilot Quality Gate

Before public expansion, require:

- controlled real-device customer tests;
- restaurant sound validated on real terminals;
- driver navigation validated;
- Delivery PIN validated;
- 100+ representative test/pilot order flows without financial mismatch;
- tenant security tests passed;
- settlement cycle simulated/generated;
- driver cash reconciliation passed;
- backup restore passed;
- monitoring/alerts active.

---

# 173. Documentation Deliverables

Engineering documentation:

- README.
- Architecture overview.
- ERD.
- OpenAPI.
- ADRs.
- Geography seed/import guide.
- Permission matrix.
- Finance definitions.
- Settlement specification.
- Deployment guide.
- Backup/restore runbook.
- Incident runbooks.
- Security checklist.
- Release checklist.

Operational Arabic guides:

- Restaurant operations.
- Order alert/sound.
- Driver management.
- Inventory.
- Commission/settlement.
- Driver cash handover.
- Admin geography activation.

---

# 174. Current Word Count Checkpoint

---

# 175. Implementation Phases Overview

The implementation should be divided into controlled phases. Each phase has explicit deliverables and a quality gate. A later phase may begin in parallel for UI work, but no phase is considered production-ready until its gate passes.

Recommended phases:

```text
Phase 0  Product and architecture freeze
Phase 1  Platform foundation
Phase 2  Geography and customer identity
Phase 3  Restaurant onboarding and catalog
Phase 4  Customer ordering
Phase 5  Restaurant live operations
Phase 6  Driver Mode and delivery
Phase 7  Inventory
Phase 8  Finance, commission, and accounting
Phase 9  Admin operations and reporting
Phase 10 Security hardening
Phase 11 Performance and resilience
Phase 12 Pilot
Phase 13 Production launch
Phase 14 Post-launch optimization
```

The ordering of phases intentionally places geography before marketplace and finance after the order/delivery lifecycle is stable. Geography is foundational because customer registration, restaurant onboarding, and checkout all depend on it. Finance is built on top of immutable completed-order facts, so order state and snapshots must be reliable first.

---

# 176. Phase 0 — Product and Architecture Freeze

## Goal

Convert the business concept into signed-off technical decisions before writing critical domain code.

## Deliverables

- Final Release 1 scope.
- Arabic-only UI policy.
- Customer onboarding flow.
- Geography capability rules.
- Complete governorate/city seed source decision.
- Restaurant onboarding flow.
- Order state machine.
- COD lifecycle.
- Driver operating model.
- Delivery PIN decision.
- Commission base definition.
- Settlement cycle definitions.
- Platform service fee rule.
- Delivery fee beneficiary rule.
- Cancellation policy.
- Permissions matrix.
- Initial ERD.
- OpenAPI skeleton.
- Threat model draft.
- Architecture Decision Records.

## Quality gate

Do not implement finance/order core if commission base, settlement periods, COD completion moment, geography activation semantics, and delivery ownership remain ambiguous. The purpose of Phase 0 is to remove expensive ambiguity, not to create decorative documents.

---

# 177. Phase 1 — Platform Foundation

## Build

- Monorepo.
- Shared TypeScript configuration.
- Lint/format/typecheck.
- CI pipeline.
- PostgreSQL connection/migrations.
- Redis connection.
- Worker skeleton.
- Realtime gateway skeleton.
- Structured logging and request IDs.
- Error monitoring.
- Health endpoints.
- Base auth/session abstractions.
- Role/permission engine.
- Object storage abstraction.
- Arabic RTL shells for mobile/admin/restaurant.
- Shared design tokens.
- Environment validation.

## Tests

- Configuration validation.
- Database migration up/down or forward-compatibility testing.
- Permission helper tests.
- Session creation/revocation basics.
- Health readiness behavior.
- Log redaction checks.

## Quality gate

CI is green, staging deploys automatically or reproducibly, secret handling is documented, Admin/Restaurant shells cannot access private routes without authentication, and runtime services have health/monitoring visibility.

---

# 178. Phase 2 — Geography and Customer Identity

This is a critical new phase and should be treated as a standalone domain milestone.

## Build — geography

- `governorates` table.
- `cities` table.
- Canonical source codes.
- Arabic names.
- Source version.
- Capability flags.
- Import/seed process.
- Effective capability service.
- Public geography APIs.
- Admin geography APIs.
- Admin Arabic geography screens.
- Cache/invalidation.
- Audit events.

## Build — identity

- Iraqi phone input.
- OTP request/verify.
- Rate limiting.
- Secure mobile session storage.
- Customer profile table fields.
- Mandatory post-OTP profile-completion screen.
- Full name.
- Governorate selector.
- Dependent city selector.
- Profile update flow.
- Legacy incomplete-profile migration behavior.

## Build — addresses

- Multiple delivery addresses.
- Governorate/city relation.
- Iraqi address fields.
- Map pin support if Maps SDK is configured.
- Default address.

## Required tests

- Seed integrity.
- 19 governorates expected for current seed version.
- Every city has one parent.
- Duplicate code rejection.
- Active-child/disabled-parent effective state.
- OTP rate limits.
- OTP expiry.
- Arabic digit normalization.
- Profile city-parent validation.
- City disabled between list fetch and submit.
- Returning user skips profile flow.
- Legacy incomplete user is redirected.
- Address saved in active/inactive geography according to policy.
- Checkout not yet built, but geography service unit tests ready for it.

## Quality gate

A fresh customer can complete OTP and Arabic profile onboarding only in an enabled service-signup city. Admin can change activation without a mobile release. No stale client can save invalid geography. Audit history exists for every Admin activation change.

---

# 179. Phase 3 — Restaurant Onboarding and Catalog

## Build

- Provider/restaurant/branch entities.
- Restaurant owner membership.
- Admin direct creation.
- Restaurant self-application.
- Arabic onboarding wizard.
- Geography selection from onboarding-enabled master data.
- Address/map pin.
- Onboarding statuses.
- Approval/rejection/request-info commands.
- Operational statuses.
- Logo/cover upload.
- Working hours.
- Temporary pause.
- Busy mode.
- Menu categories.
- Menu items.
- Modifiers.
- Item availability.
- Customer public restaurant/menu APIs.
- Basic Home/discovery UI.

## Required tests

- Restaurant cannot submit mismatched city/governorate.
- Disabled onboarding city blocked.
- City disabled after submission blocks approval by default.
- Restaurant approved but ordering-disabled city remains invisible.
- Suspended restaurant invisible.
- Working hours.
- Overnight hours.
- Menu price validation.
- Modifier constraints.
- Cross-tenant catalog edits denied.
- Private documents inaccessible publicly.

## Quality gate

Admin can create/approve a restaurant and a restaurant owner can self-submit. Approved restaurants appear to customers only when all geography and operational conditions are true. Restaurant A cannot modify Restaurant B catalog.

---

# 180. Phase 4 — Customer Ordering

## Build

- Restaurant detail page.
- Product detail/modifier selection.
- Cart.
- Single-restaurant cart enforcement.
- Quote endpoint.
- Platform service fee.
- Coupon foundation if included.
- Address selection.
- Service eligibility check.
- COD checkout.
- Place Order transaction.
- Order/item/modifier snapshots.
- Idempotency.
- Customer order history.
- Customer order detail/timeline.
- Customer cancellation according to policy.

## Required tests

- Price tampering rejected.
- Fee tampering rejected.
- Commission value from client ignored.
- Restaurant disabled during checkout.
- City disabled during checkout.
- Restaurant closes after cart creation.
- Item removed after cart creation.
- Modifier invalid.
- Minimum order.
- Duplicate Place Order request.
- Network timeout and idempotency lookup.
- Address out of service.
- Existing address in newly disabled city blocked.
- Order snapshots remain stable after menu edit.

## Quality gate

A customer can complete a COD order and the database contains an internally consistent immutable order snapshot. Duplicate network requests cannot create duplicate orders. Geography changes are enforced at final checkout.

---

# 181. Phase 5 — Restaurant Live Operations

## Build

- Live-order query/read model.
- Realtime order channel.
- Transactional outbox worker.
- Audible alert manager.
- Notification permission setup.
- Browser notification.
- Reconnection/delta sync.
- Polling fallback.
- Accept/reject commands.
- Preparing/ready commands.
- Kitchen view.
- SLA timers.
- Print-friendly order ticket.
- Stale order monitoring.

## Required tests

- Outbox event persists with order.
- Worker retry does not duplicate domain state.
- Duplicate realtime event does not duplicate sound.
- Two cashiers accept simultaneously; only one transition succeeds.
- Rejection releases reserved state when inventory arrives later.
- Browser reconnect fetches missed order.
- Polling discovers order during realtime outage.
- Staff permission removed while portal open.
- Sound activation after browser user gesture.
- Multi-tab duplicate alert mitigation where implemented.

## Manual QA

Sound must be tested on the actual browsers/tablets/laptops restaurants are expected to use. Browser autoplay and background-tab behavior cannot be trusted solely from unit tests.

## Quality gate

A placed order cannot silently disappear from restaurant operations because a single realtime delivery failed. There is a reliable DB→outbox→realtime/push→poll fallback chain.

---

# 182. Phase 6 — Driver Mode and Delivery

## Build

- Driver profile.
- Restaurant driver membership.
- Driver creation screen.
- OTP activation.
- Mobile Driver Mode.
- Driver availability.
- Eligible-driver list.
- Assignment/reassignment.
- Driver push/realtime channel.
- Accept/reject assignment.
- Pickup.
- OUT_FOR_DELIVERY transition.
- Google Maps URL.
- Waze URL.
- Copy address fallback.
- Arrival notification.
- Delivery PIN.
- COD completion transaction.
- Driver order history.
- Driver session revocation.

## Required tests

- Restaurant A cannot assign Restaurant B driver.
- Suspended driver cannot accept.
- Assignment race.
- Reassigned old driver denied.
- Duplicate push opens current state rather than stale state.
- App killed/reopened restores active assignment.
- Google Maps URL encoded.
- Waze URL encoded.
- Missing coordinates fallback.
- Wrong PIN attempts rate-limited.
- Correct PIN completes exactly once.
- Duplicate completion cannot duplicate commission/cash.
- Pickup only after valid order state.

## Quality gate

A restaurant can create a driver, assign a ready order, the driver can navigate externally and return to Jibli, and successful PIN confirmation completes order/payment/finance once.

---

# 183. Phase 7 — Inventory

## Build

- Inventory items.
- Units.
- Opening balances.
- Receive stock.
- Manual adjustment.
- Waste.
- Reservation.
- Reservation release.
- Consumption.
- Low-stock threshold.
- Movement history.
- Product-to-stock link.
- Optional recipe layer.
- Inventory dashboard.
- Permissions.

## Required tests

- Last-unit race.
- Negative-stock policy.
- Duplicate consumption protection.
- Rejection releases reservation.
- Cancellation after consumption records correct consequence.
- Adjustment requires reason/permission.
- Low-stock event once per appropriate threshold state.
- Product auto-disable behavior does not override manual disable incorrectly.

## Quality gate

Concurrent orders cannot oversell tracked inventory under defined rules. Every stock change is attributable to a movement and actor/reference.

---

# 184. Phase 8 — Finance, Commission, and Restaurant Accounting

## Build

- Money domain utility.
- Commission effective-dated config.
- Order commission snapshots.
- Platform ledger.
- Restaurant sales summaries.
- Cost of goods foundation.
- Expenses.
- Estimated profitability.
- Half-month settlement job.
- Monthly settlement job.
- Settlement lines.
- DRAFT review.
- Issue.
- Partial/full payment.
- Overdue.
- Disputes.
- Credits/debits.
- Reversal.
- Driver cash custody.
- Cash handover.
- Reconciliation jobs.
- Finance dashboards.

## Required tests

- Deterministic IQD math.
- Basis-point rounding.
- Restaurant-funded discount.
- Platform-funded discount.
- Commission rate changes mid-period.
- Order completed across period boundary.
- Half-month February.
- Leap-year February.
- Month/year rollover.
- Settlement worker retry.
- Same order cannot enter two settlements.
- Partial payment.
- Full payment.
- Reversal.
- Driver cash collected once.
- Driver handover equation.
- Reconciliation mismatch alert.

## Quality gate

A Finance reviewer can independently reproduce statement totals from immutable order snapshots and ledger/settlement lines. No balance depends on an uncontrolled mutable accumulator.

---

# 185. Phase 9 — Admin Operations and Reporting

## Build

- Complete Admin dashboard.
- Geography coverage matrix.
- Restaurant management.
- Customer lookup/block controls.
- Driver overview.
- Global order operations.
- Finance/settlement operations.
- Support tickets.
- Marketing/banner basics.
- Roles/permissions management.
- Audit log viewer.
- Reports and exports.

## Required tests

- Role matrix.
- Geography permissions.
- Finance permissions.
- PII masking.
- Export scoping.
- Audit read scope.
- Destructive action confirmations.
- Admin role revocation.
- MFA enforcement.

## Quality gate

Platform staff can operate Jibli without routine direct database edits. Common support and finance actions have safe audited interfaces.

---

# 186. Phase 10 — Security Hardening

## Activities

- Update threat model with implemented system.
- OWASP ASVS 5.0 Level 2-oriented assessment.
- IDOR/broken-access-control testing.
- XSS testing.
- SQL injection review/testing.
- CSRF review/testing.
- Session abuse testing.
- OTP abuse testing.
- Delivery PIN abuse testing.
- File-upload testing.
- Role escalation testing.
- Deep-link review.
- Dependency vulnerability review.
- Secret scan.
- Mobile storage inspection.
- Web security headers review.

## Gate

No unresolved Critical or High security findings. Any accepted Medium risk requires documented owner, mitigation, and deadline.

---

# 187. Phase 11 — Performance and Resilience

## Activities

- Peak-order load tests.
- Hot restaurant burst.
- Large menu.
- Large order history.
- Large Admin report.
- Settlement batch.
- Realtime outage.
- Redis outage/degradation.
- Push outage.
- Worker restart.
- Queue backlog.
- Weak-network mobile test.
- Low-end Android test.
- Backup restore drill.

## Gate

Critical order and finance truth survive degraded dependencies. Known bottlenecks have capacity/alert thresholds. Restore procedure is proven.

---

# 188. Phase 12 — Pilot

Enable a limited service city/area. Onboard a small number of real restaurants and drivers. Train operators. Run real or controlled orders through lunch/dinner patterns. Produce a real pilot settlement. Reconcile driver cash and commission.

Pilot metrics include OTP success, profile-completion drop-off, order conversion, restaurant acceptance, average prep time, driver assignment response, delivery completion, failed delivery, support cases, settlement mismatch, and missed-order incidents.

Pilot is explicitly a learning phase. Configuration changes and usability fixes are expected before broad launch.

---

# 189. Phase 13 — Production Launch

Launch checklist includes final migrations, fresh backup, production secret validation, Admin MFA, store release, monitoring, alert routing, runbook availability, support staffing, target-city activation, restaurant readiness, and rollback/kill-switch verification.

Use staged mobile rollout if available. Do not activate nationwide geography simply because the app is in the stores.

---

# 190. Phase 14 — Post-Launch Optimization

After real data is stable, optimize search ranking, prep-time estimates, driver workflow, report usability, inventory recipes, cashier-shift features, and additional city rollout. Do not introduce water/gas categories until restaurant operations and finance demonstrate stable behavior unless business leadership intentionally accepts the extra operational risk.

---

# 191. Go/No-Go — Geography

**Go** only when:

- complete approved master dataset imported;
- 19 governorates verified for current source version;
- city parent relationships validated;
- Admin capability toggles work;
- audit works;
- stale-client race tests pass;
- current target city is correctly enabled;
- non-target cities remain disabled;
- customer and restaurant selectors read server data;
- no client hard-coded availability bypass exists.

Otherwise: **No-Go**.

---

# 192. Go/No-Go — Customer Identity

**Go** only when:

- Iraqi number normalization works;
- OTP rate limits work;
- OTP values are not logged/stored insecurely;
- session storage is secure;
- post-OTP name/governorate/city flow works;
- returning user behavior works;
- legacy incomplete profile behavior works;
- account and delivery-address geography remain separate.

---

# 193. Go/No-Go — Restaurant

**Go** only when:

- Admin creation works;
- self-onboarding works if enabled;
- approval required;
- geography eligibility enforced;
- menu works;
- hours work;
- sound works on target device/browser;
- tenant isolation tests pass;
- restaurant remains operable for history/finance when city ordering is disabled.

---

# 194. Go/No-Go — Ordering

**Go** only when:

- quote and Place Order use server calculation;
- stale price handled;
- duplicate retry safe;
- city disable handled;
- restaurant disable handled;
- order snapshots complete;
- status history works;
- realtime/poll fallback works;
- cancellation behavior defined and tested.

---

# 195. Go/No-Go — Driver

**Go** only when:

- restaurant creates driver;
- OTP activation works;
- assignment/reassignment safe;
- old driver loses rights;
- Maps/Waze links work on real devices;
- Delivery PIN works;
- duplicate completion safe;
- COD cash event recorded once;
- session revocation works.

---

# 196. Go/No-Go — Finance

**Go** only when:

- Money calculations deterministic;
- commission snapshots immutable;
- 15-day/monthly periods correct;
- statements reproducible;
- partial/full payments correct;
- overdue correct;
- adjustments/reversals auditable;
- driver cash separate from commission;
- reconciliation shows zero unexplained mismatch.

---

# 197. Go/No-Go — Security

**Go** only when:

- Admin MFA live;
- tenant isolation tests pass;
- secure token storage verified;
- no client secrets;
- high-risk rate limits live;
- upload controls live;
- Critical/High findings closed;
- audit covers sensitive commands;
- security headers and TLS correct.

---

# 198. Go/No-Go — Reliability

**Go** only when:

- backups exist;
- restore tested;
- order outbox tested;
- queue retry tested;
- realtime fallback tested;
- monitoring/alerts active;
- incident ownership defined;
- release rollback strategy understood.

---

# 199. Acceptance Criteria — Customer Profile Geography

A customer geography feature is complete only if:

- OTP success leads to profile screen for new user.
- Full name is mandatory.
- Governorate is mandatory.
- City is mandatory.
- Governorates come from backend master data.
- City list is dependent on selected governorate.
- Disabled signup governorates do not appear in normal selector.
- Disabled signup cities do not appear in normal selector.
- Server rejects stale disabled city.
- Server rejects city from another governorate.
- Profile is not marked complete until valid commit.
- Returning complete user is not forced through onboarding.
- Existing delivery addresses are not changed by profile updates.
- UI is Arabic RTL.

---

# 200. Acceptance Criteria — Admin Geography

Complete only if:

- all master governorates/cities visible to authorized Admin;
- Admin can toggle customer signup;
- Admin can toggle restaurant onboarding;
- Admin can toggle ordering;
- child effective state respects parent;
- impact preview exists for high-impact disable;
- reason required where policy demands;
- audit written;
- cache invalidation event written;
- unauthorized role receives forbidden response;
- historical data unchanged;
- active orders continue by default.

---

# 201. Acceptance Criteria — Restaurant Geography

Complete only if:

- Admin direct creation requires governorate/city;
- restaurant self-application requires governorate/city;
- onboarding selectors use enabled data;
- server validates parent relation;
- restaurant is not visible before approval;
- ordering-disabled city blocks marketplace visibility;
- relocation uses controlled workflow;
- branch geography stored;
- historical order snapshots remain stable.

---

# 202. Acceptance Criteria — Live Orders

Complete only if:

- new order appears without manual refresh in normal operation;
- sound works after activation;
- visual alert exists;
- browser notification behavior works where permitted;
- reconnect obtains missed orders;
- polling fallback works;
- duplicate event does not double-alert indefinitely;
- accept/reject protected by version/state;
- actor recorded.

---

# 203. Acceptance Criteria — Inventory

Complete only if:

- opening balance works;
- receiving works;
- reservation works;
- release works;
- consumption works;
- waste works;
- manual adjustment audited;
- low stock works;
- last-unit concurrency test passes;
- permissions enforced;
- historical movements remain traceable.

---

# 204. Acceptance Criteria — Driver Delivery

Complete only if:

- driver creation/activation works;
- availability works;
- assignment push/realtime works;
- accept/reject works;
- pickup changes order state;
- Google Maps opens correct destination;
- Waze opens correct destination;
- Copy Address fallback works;
- arrival notification works;
- Delivery PIN is protected/rate-limited;
- completion is idempotent;
- COD cash is recorded;
- reassigned former driver is denied.

---

# 205. Acceptance Criteria — Restaurant Accounting

Complete only if:

- completed sales included;
- cancelled/rejected excluded according to policy;
- cost coverage transparent;
- expenses categorized;
- commission deducted distinctly;
- profit labeled estimated when incomplete;
- cashier cannot see restricted cost data;
- exports match on-screen totals for same period.

---

# 206. Acceptance Criteria — Commission and Settlement

Complete only if:

- effective commission stored;
- order snapshot immutable;
- statement periods correct;
- each eligible order included once;
- multiple rates displayed correctly;
- partial payment supported;
- full payment closes balance;
- overdue visible;
- dispute workflow exists;
- adjustment/reversal history visible;
- reconciliation passes.

---

# 207. Acceptance Criteria — Driver Cash

Complete only if:

- every completed driver COD order creates exactly one collection event;
- driver current custody derives correctly;
- handover records receiving employee;
- partial handover supported if desired;
- driver cannot edit final amount;
- accountant can reconcile;
- corrections use adjustment;
- cash data does not affect commission ledger incorrectly.

---

# 208. Acceptance Criteria — Arabic RTL

Complete only if all production-facing screens are Arabic, layout direction is correct, dropdowns and tables are usable RTL, numbers are legible, Arabic/Latin mixed order numbers render correctly, error messages are Arabic, empty states are Arabic, and no accidental developer English strings appear in production release.

---

# 209. Threat Model — Identity

Threats:

- automated OTP spam;
- brute force;
- SIM-swap-related account recovery abuse;
- stolen session token;
- insecure mobile storage;
- support social engineering.

Controls:

- rate limiting;
- short OTP expiry;
- attempt limits;
- secure storage;
- session revocation;
- strong owner/admin recovery procedure;
- no secret logging.

---

# 210. Threat Model — Geography

Threats:

- unauthorized Admin enables city;
- stale cache allows order in disabled city;
- client forges city ID;
- restaurant claims different city;
- data import creates duplicate/mis-parented city.

Controls:

- RBAC;
- audit;
- server effective-capability validation;
- DB foreign keys;
- seed tests;
- cache invalidation plus authoritative checkout check;
- controlled relocation workflow.

---

# 211. Threat Model — Tenant Isolation

Threats:

- IDOR on order/restaurant IDs;
- export leaks another restaurant;
- websocket subscription leaks another tenant;
- cached SSR response leaks tenant;
- Admin role accidentally exposed to restaurant user.

Controls:

- membership-derived scope;
- permission middleware/policy;
- tenant-aware cache keys/no-store;
- realtime channel authorization;
- regression security tests;
- separate Admin/Restaurant route/app boundaries.

---

# 212. Threat Model — Finance

Threats:

- client sends lower commission;
- Admin silently edits settlement;
- duplicate payment recording;
- worker duplicates accrual;
- historical rate changed;
- insider unauthorized adjustment.

Controls:

- server calculation;
- snapshots;
- ledger;
- idempotency;
- unique constraints;
- audit;
- granular permissions;
- MFA/reauthentication;
- reconciliation.

---

# 213. Threat Model — Delivery

Threats:

- driver completes someone else's task;
- old driver completes after reassignment;
- brute-forced Delivery PIN;
- forged COD amount;
- duplicate completion;
- exposed customer location.

Controls:

- active-assignment authorization;
- state/version checks;
- hashed PIN and attempt limit;
- server authoritative amount;
- idempotency;
- minimal address access window;
- no PIN/address in insecure push/deep links.

---

# 214. Threat Model — Inventory

Threats:

- concurrent oversell;
- staff unauthorized stock manipulation;
- deleting movement history;
- negative stock hiding shortage.

Controls:

- atomic reservation;
- permissions;
- immutable movement history;
- reason-required adjustment;
- low/negative-stock alerts;
- stocktake reconciliation.

---

# 215. Detailed Test Matrix — Geography

## Master data

- Fresh database import succeeds.
- Re-running import is idempotent.
- Governorate code unique.
- City code unique.
- Arabic name required.
- City parent required.
- Deprecated record not hard-deleted when referenced.

## Activation

- Enable governorate signup.
- Disable governorate signup.
- Enable city signup under enabled parent.
- City effective false under disabled parent.
- Enable onboarding separately from ordering.
- Ordering can remain false while onboarding true.

## Customer

- Selector hides inactive city.
- Forged inactive city rejected.
- Stale selected city rejected after Admin change.
- Existing account login not deleted.
- Existing address retained.

## Restaurant

- Application in disabled onboarding city rejected.
- Approved restaurant in ordering-disabled city hidden from customer.
- Active order survives disable.
- Re-enable restores eligibility only if restaurant itself is active/open.

---

# 216. Detailed Test Matrix — OTP and Sessions

- Valid Iraqi number.
- Arabic-Indic digits.
- Invalid prefix/format.
- Request cooldown.
- Hourly cap.
- Wrong OTP attempt cap.
- Expired OTP.
- OTP reuse.
- Successful verification.
- Session persists securely.
- Logout revokes local session.
- Server-revoked session rejected.
- Driver suspension revokes/denies Driver Mode.
- Restaurant staff deactivation denies portal.
- Admin role change applies promptly.

---

# 217. Detailed Test Matrix — Order Totals

For combinations of item prices, quantities, modifiers, restaurant discount, platform discount, delivery fee, and service fee, verify:

```text
customer_total =
items_subtotal
+ delivery_fee
+ service_fee
- discounts
```

Verify commission base follows contract rule and cannot be supplied by client. Verify integer rounding and high-value totals. Verify the same inputs produce the same result in quote and order creation unless underlying data legitimately changed.

---

# 218. Detailed Test Matrix — State Machine

- PENDING → ACCEPTED allowed.
- PENDING → REJECTED allowed.
- PENDING → COMPLETED denied.
- ACCEPTED → PREPARING allowed.
- PREPARING → READY allowed.
- READY → OUT_FOR_DELIVERY through valid pickup.
- OUT_FOR_DELIVERY → COMPLETED only through delivery confirmation flow.
- Completed order cannot return to PREPARING through normal endpoint.
- Admin override uses dedicated audited command.

Test concurrency with stale version numbers.

---

# 219. Detailed Test Matrix — Realtime

- Order created while portal connected.
- Order created while portal reconnecting.
- Realtime event duplicated.
- Events arrive out of order.
- Browser tab backgrounded.
- Browser returns visible.
- Websocket unavailable; polling finds order.
- Worker retries outbox publish.
- Portal reconnects and delta sync finds missed order.
- Accepted order not re-alerted as new after reload.

---

# 220. Detailed Test Matrix — Driver Assignment

- Eligible available driver assigned.
- Offline driver policy enforced.
- Busy driver capacity enforced.
- Driver from wrong branch rejected.
- Driver from wrong restaurant rejected.
- Two staff assign different drivers simultaneously; one wins.
- Driver rejects; order remains ready and reassignable.
- Assignment times out.
- Reassignment invalidates old driver rights.
- Restaurant suspension after assignment does not orphan current task.

---

# 221. Detailed Test Matrix — Delivery PIN

- Correct PIN.
- Wrong PIN.
- Attempt rate limit.
- Expired/invalid completed-order PIN.
- PIN absent from logs.
- PIN absent from driver API before confirmation.
- Duplicate successful request idempotent.
- Manager override permission.
- Override reason/audit required.

---

# 222. Detailed Test Matrix — Driver Navigation

Google Maps:

- valid lat/lng;
- URL encoding;
- device current origin omitted/allowed;
- missing coordinates fallback to encoded address.

Waze:

- valid deep link;
- encoding;
- app installed;
- app not installed/web fallback.

App:

- goes background when Maps opens;
- resumes active assignment correctly;
- no secret included in URL.

---

# 223. Detailed Test Matrix — Inventory

- Opening balance.
- Purchase/receive.
- Reserve.
- Release.
- Consume.
- Waste.
- Manual adjustment.
- Low stock threshold.
- Last unit concurrent orders.
- Cancellation before prep.
- Cancellation after consumption.
- Replenish stock and auto-availability rule.
- Manual product disable remains manual after restock.

---

# 224. Detailed Test Matrix — Commission

- 0% allowed if contract permits.
- Typical 10/12/15%.
- Fractional basis-point representation such as 12.5%.
- Rounding deterministic.
- Rate effective tomorrow does not affect today.
- Multiple rates same statement period.
- Restaurant-funded discount affects base.
- Platform-funded discount behavior correct.
- Cancelled order no accrual.
- Completed order accrual once.
- Reversal compensates.

---

# 225. Detailed Test Matrix — Settlement

- Half-month first period.
- Half-month second period.
- February normal year.
- February leap year.
- 30/31 day month.
- Year transition.
- No eligible orders.
- Worker retry.
- Duplicate worker instance.
- Late completion after period boundary.
- Partial payment.
- Multiple partial payments.
- Overdue transition.
- Dispute.
- Credit adjustment.
- Debit adjustment.
- Void/reissue permission.

---

# 226. Detailed Test Matrix — Driver Cash

- Completed COD creates collection.
- Non-COD future method would not create COD event.
- Failed delivery does not falsely collect.
- Duplicate completion does not duplicate cash.
- Partial handover.
- Full handover.
- Adjustment permission.
- Negative custody prevention unless controlled correction.
- Driver deactivation with outstanding custody remains visible to accountant.

---

# 227. Detailed Test Matrix — Roles

For every default role, verify allowed and denied actions. Testing only allowed actions is insufficient. Cashier must be actively tested against finance endpoints. Kitchen must be denied customer-sensitive and finance operations. Accountant must not manage platform geography. Restaurant owner cannot mutate platform commission. Operations Admin cannot issue finance adjustments unless permission granted.

---

# 228. Detailed Test Matrix — Files

- Oversized image rejected.
- Invalid MIME rejected.
- File extension spoof rejected.
- Private document inaccessible publicly.
- Signed URL expiry.
- Unauthorized restaurant cannot read another restaurant document.
- Replaced logo updates CDN/reference.
- Orphan cleanup does not remove referenced asset.

---

# 229. Detailed Test Matrix — Exports

- Restaurant export only own rows.
- Branch scope respected.
- Admin export permission required.
- Large export asynchronous.
- Signed link expires.
- Arabic text opens correctly.
- User-provided string cannot trigger spreadsheet formula unexpectedly.
- Export event audited where sensitive.

---

# 230. Detailed Test Matrix — Backups and Restore

- Latest backup exists.
- Backup encryption/access controlled.
- Restore into isolated staging.
- User count reasonable.
- Governorate/city data intact.
- Orders intact.
- Ledger/settlements intact.
- Driver assignments intact.
- Object references valid.
- Application can boot against restored data.

Document actual restore time for RTO planning.

---

# 231. Production Support Scenarios

## Missed restaurant order complaint

Support can inspect order creation, outbox status, realtime publication, notification attempt, terminal presence, and acceptance timeline using order/request IDs.

## Customer says app charged/total wrong

COD Release 1 has no online charge, but Support can inspect immutable quote/order components and explain subtotal, discount, delivery fee, service fee, and total.

## Restaurant disputes commission

Finance opens settlement lines and order snapshots. If contract/config mismatch is proven, create adjustment/reissue rather than editing orders.

## Driver says task disappeared

Support checks assignment history/reassignment/current state. Old push notifications do not grant rights.

## City unexpectedly unavailable

Operations checks capability flags and audit history rather than modifying restaurant records.

---

# 232. Data Quality Monitoring

Flag conditions such as:

- approved restaurant without owner;
- approved restaurant without working hours;
- restaurant in disabled ordering city;
- active restaurant without active menu;
- driver membership without active user;
- invalid/missing address coordinates where pin required;
- stale inventory reservation;
- completed order missing commission event;
- completed driver COD order missing cash event;
- settlement amount not matching lines.

These are diagnostics. Financial inconsistencies must be investigated rather than silently repaired.

---

# 233. Search and Arabic Normalization

Search preprocessing may normalize common Arabic variations for lookup while preserving original display names. Examples include safe treatment of Alef variants, tatweel, and excess whitespace. Do not replace canonical stored names with search-normalized strings.

Geography selection uses canonical IDs, so spelling aliases never create duplicate cities. Optional `geography_aliases` can support alternative local spellings.

---

# 234. Customer Profile Name Validation

Avoid overly restrictive Latin-style regular expressions. Iraqi names may contain Arabic characters, spaces, and legitimate punctuation. Apply Unicode normalization, trim repeated whitespace, set practical min/max length, reject control characters, and escape output normally.

Do not require a customer to provide unnecessary date of birth, gender, ID documents, or email for basic food ordering unless a future business/legal need is established.

---

# 235. Restaurant Naming and Legal Identity

Keep `display_name` separate from optional `legal_name`. Customer marketplace shows display name. Contracts/finance may use legal entity information where available. Changing display name does not rewrite historical order snapshots.

---

# 236. Phone Change Workflows

Customer phone change:

- authenticated session;
- verify new number;
- resolve collision;
- update identity;
- optionally revoke other sessions.

Driver phone change:

- Restaurant Manager/Admin awareness;
- verify new number;
- preserve driver history.

Restaurant owner/Admin account recovery requires stronger identity verification than ordinary customer change.

---

# 237. Session and Device Management

Store safe metadata such as platform/device family, session creation time, and last activity. Users can log out. Restaurant owners/Admins can revoke lost staff sessions. Do not collect invasive hardware fingerprints by default.

Role removal or driver suspension should make the next authorized call fail even if UI is still open.

---

# 238. Restaurant Terminal Presence

Restaurant Portal can send a lightweight heartbeat so Operations can see approximate terminal availability and whether order notifications/sound are activated. Presence is an operational hint only. It is not a substitute for the order state machine.

---

# 239. Stale Orders

A scheduled/read-model process flags orders that exceed configured thresholds in PENDING, PREPARING, READY, or OUT_FOR_DELIVERY. Alerts are operational; the system should not silently mark orders completed to make dashboards look healthy.

---

# 240. Cancellation Financial and Inventory Effects

Before acceptance, cancellation normally releases reservation and creates no commission.

After food preparation has started, a cancellation may require a waste movement because ingredients/food cannot be restored automatically. If a completed order is later reversed by an exceptional Admin workflow, create financial reversals instead of deleting the original history.

---

# 241. Restaurant Analytics Definitions

Document definitions to avoid inconsistent dashboards:

- **Sales:** completed item sales under defined discount treatment.
- **AOV:** eligible sales divided by completed order count.
- **Acceptance rate:** accepted eligible orders / eligible offers.
- **Preparation time:** accepted_at → ready_at.
- **Delivery time:** picked_up_at → delivered_at.
- **Cancellation rate:** defined numerator/denominator documented.
- **Estimated profit:** sales minus available costs/commission/entered expenses, explicitly not statutory accounting.

---

# 242. Platform Analytics Definitions

- **GMV:** define whether it means item value or customer total and label explicitly.
- **Commission accrued:** commission on completed orders.
- **Commission collected:** settlement payments actually recorded.
- **Outstanding:** accrued/issued amounts minus payments/credits according to finance design.
- **Customer transaction value:** customer total if needed as a separate metric.

Avoid calling accrued receivables "cash revenue collected".

---

# 243. Report Time Ranges

Common presets:

- Today.
- Yesterday.
- Last 7 days.
- This month.
- Last month.
- Custom.

Ranges are interpreted in Baghdad local business time and queried using safe UTC boundaries.

---

# 244. Large Reporting Architecture

Initial reporting can use PostgreSQL read queries/summary tables. As volume grows, introduce materialized summaries, replicas, or a warehouse. Do not introduce a separate big-data stack before operational volume justifies it.

Order placement must never synchronously update every chart and cohort table.

---

# 245. Public and Private Caching Rules

Public menu/restaurant imagery can be CDN cached. Public restaurant cards can use short revalidation. Customer account data, Restaurant Portal data, finance, Admin data, and private documents are never placed in a shared public cache.

Next.js caching behavior must be explicit for authenticated routes to prevent tenant leakage.

---

# 246. Database Migration Policy

Every migration is version-controlled, reviewed, tested on staging, and deployed through CI/CD. Use expand/contract patterns for breaking schema evolution. Avoid dropping columns in the same release that stops writing them unless backward compatibility is guaranteed.

Never manually alter production schema as a normal workflow.

---

# 247. Geography Migration Policy

Master-data changes are not ordinary UI edits when they change administrative structure. Moving a canonical city to another governorate, merging records, or deprecating a city requires a reviewed data migration and impact analysis. Simple service activation remains an Admin operation.

---

# 248. Production Access Control

Developers do not receive broad permanent production database access. Support actions are built into Admin. Emergency break-glass access is time-limited, logged, and reviewed. Read-only analytics access is separate from write credentials.

---

# 249. Secrets and Key Rotation

Document rotation procedures for database credentials, OTP provider credentials, object storage keys, signing/session secrets, map SDK keys if used, and mobile app signing credentials. Rotation must not require exposing secrets in chat, tickets, or source control.

---

# 250. App Signing and Store Ownership

Android keystore and iOS signing credentials are secured and backed up according to platform best practice. Store accounts should belong to the business rather than an individual developer where feasible. Release access uses least privilege.

---

# 251. Privacy Policy Inputs

The legal privacy document should accurately reflect the technical design: phone, name, account geography, delivery addresses, order history, driver data, push tokens, crash diagnostics, and any map/location use. Release 1 should explicitly avoid claiming background driver tracking if it does not exist.

---

# 252. Terms and Restaurant Contract Inputs

Restaurant contract should define:

- commission rate;
- commission base;
- settlement cycle;
- payment due period;
- delivery responsibility;
- service/ordering suspension rules;
- data/portal usage;
- dispute process.

Technical configuration should match contract metadata, and Admin can receive a warning if commission config differs from recorded contract data.

---

# 253. Finance Statement Legal Naming

Use a neutral internal name such as Commission Statement until local accounting/legal review confirms whether the document can be called an invoice, tax invoice, or another regulated term. The software plan should not invent legal compliance.

---

# 254. Future Online Payments

Prepare a payment abstraction:

```text
payments
payment_attempts
provider
method
amount
status
provider_reference
```

COD is the only Release 1 active method. Future online payments must not be bolted onto `orders.payment_status` without provider-attempt history/webhook idempotency.

---

# 255. Future Platform Driver Fleet

Current driver membership is restaurant-owned. A future platform fleet would add driver organization/employment/dispatch ownership and possibly platform-level assignment. Keep `delivery_assignments` sufficiently generic, but do not overcomplicate Release 1 with unused fleet logic.

---

# 256. Future Live GPS

If added later, create a separate design covering foreground/background permissions, frequency, battery, retention, location accuracy, customer visibility, driver consent/notice, map cost, and abuse/security. Do not simply start uploading coordinates because a map component exists.

---

# 257. Future Water/Gas Expansion

Reuse identity, geography, addresses, provider, order, fee, commission, settlement, delivery, notification, Admin, and reporting foundations.

Category-specific extensions:

- water bottle sizes;
- tanker capacity;
- gas cylinder products;
- availability/fulfillment attributes.

Do not expose those types in Release 1 UI.

---

# 258. Final Default Product Decisions

Unless Product Owner changes them through a documented decision:

- UI is Arabic-only Release 1.
- Customer login is Iraqi phone OTP.
- New customer must provide full name, governorate, city after OTP.
- All Iraqi governorates and canonical cities are pre-seeded.
- Admin controls customer-signup, restaurant-onboarding, and ordering capabilities.
- Customer profile geography and delivery addresses are separate.
- Restaurant branch has governorate/city.
- Restaurant approval required.
- COD only.
- Platform service fee configurable.
- Restaurant percentage commission snapshotted per order.
- Half-month or calendar-month settlement.
- Restaurant-owned drivers.
- Drivers created by restaurants.
- Driver OTP activation.
- One active delivery assignment by default.
- Google Maps default and Waze alternative.
- No live GPS Release 1.
- Delivery PIN enabled by default.
- Driver COD cash custody tracked.
- Inventory movement history auditable.
- Financial corrections use adjustment/reversal.
- Commercial deletion is soft/deactivation.
- Admin Finance/Super Admin use MFA.
- City rollout is staged rather than nationwide by default.

---

# 259. Reference Guidance to Keep Current

Implementation should consult and periodically re-check official documentation rather than freezing assumptions forever:

- Next.js official documentation and security releases.
- React Native official security guidance.
- OWASP ASVS 5.0.
- Google Maps URLs documentation.
- Waze Deep Links documentation.
- Reliable current Iraqi administrative references for governorate/city master-data maintenance.

Framework patch versions should be selected at implementation/release time, not permanently pinned by this planning document.

---

# 260. Final Production Checklist

## Geography

- Master dataset imported.
- 19 governorates validated for current dataset version.
- All canonical cities validated.
- Target launch capabilities correct.
- Audit works.
- Cache invalidation works.

## Identity

- OTP works.
- Abuse limits work.
- Secure session storage verified.
- Profile onboarding works.
- Arabic UI complete.

## Restaurant

- Onboarding/approval works.
- Geography works.
- Menu/hours work.
- Order sound works on real terminal.
- Roles work.

## Customer order

- Quote correct.
- Order idempotent.
- COD correct.
- Address eligibility correct.
- Timeline works.

## Driver

- Creation/activation works.
- Assignment works.
- Maps/Waze tested.
- Delivery PIN tested.
- Cash event tested.

## Inventory

- Reservation race tested.
- Movement history correct.
- Low stock works.

## Finance

- Commission snapshots correct.
- Half-month statement tested.
- Monthly statement tested.
- Partial/full payments tested.
- Reconciliation clean.
- Driver cash separate.

## Security

- Admin MFA.
- Tenant isolation.
- ASVS-oriented review.
- No Critical/High findings.
- File/security headers/rate limits.

## Reliability

- Backup.
- Restore test.
- Monitoring.
- Alerts.
- Runbooks.
- Realtime fallback.

## Release

- Store accounts/signing ready.
- Privacy/terms reviewed.
- Pilot passed.
- Staged launch plan approved.

---

# 261. Closing Architecture Position

Jibli must be built as an operations and transaction platform, not merely a restaurant-browsing interface. The visible customer flow should remain simple: verify phone, enter name/governorate/city, choose a restaurant, order, receive delivery. The backend must absorb the complexity required to make that simplicity reliable.

The architecture is successful if a service city can be opened or paused from Admin without publishing a mobile update; a restaurant can receive orders reliably even through realtime interruptions; a driver can complete a COD delivery without Jibli running continuous GPS; every stock movement is explainable; every commission amount is reproducible; every settlement can be audited; every driver cash amount can be reconciled; and no restaurant can see another restaurant's data.

The separation between master geography and service activation is especially important for growth. Jibli can safely seed all Iraqi governorates and cities, recruit restaurants before launch in a new city, activate customer signup when marketing begins, and finally activate ordering after restaurants and drivers are operationally ready. If a local issue appears, ordering can be disabled without destroying customer, restaurant, or financial history.

The separation between profile geography and delivery address is equally important. A customer is not permanently tied to one address simply because the account was created in a city. The profile location provides a default market context, while each order uses an independently validated delivery destination.

The separation between restaurant commission and driver cash protects finance integrity. The customer may hand cash to a restaurant driver, the driver's custody may later be handed to the restaurant, and the restaurant may separately owe Jibli commission according to a 15-day or monthly statement. These are related business events but they are not the same balance and must never be combined into one uncontrolled field.

Finally, the product should resist premature complexity. Release 1 does not need continuous driver tracking, microservices for every module, AI ranking, or multiple commerce categories. It does need strong identity, geography, tenant isolation, order state, inventory integrity, delivery confirmation, financial snapshots, settlement reconciliation, security verification, backup/restore, and operational observability. Building those foundations correctly gives Jibli a credible path from a focused Iraqi restaurant-delivery launch to a broader local-commerce platform later.

---

# Appendix A — Arabic UI Labels

## Customer

```text
تسجيل الدخول
رقم الهاتف
إرسال رمز التحقق
تحقق من رقمك
أكمل معلوماتك
الاسم الكامل
المحافظة
المدينة
متابعة
الرئيسية
المطاعم
طلباتي
المفضلة
حسابي
الدفع عند الاستلام
رسوم الخدمة
الإجمالي
إتمام الطلب
```

## Restaurant

```text
الرئيسية
الطلبات
المنيو
المخزون
الأرباح
العمولات
التسويات
السائقون
الموظفون
الإعدادات
طلبات جديدة
قبول
رفض
قيد التحضير
جاهز
تعيين سائق
قيد التوصيل
```

## Driver

```text
متاح لاستلام الطلبات
طلب توصيل جديد
قبول الطلب
رفض
استلمت الطلب
فتح في Google Maps
فتح في Waze
نسخ العنوان
وصلت إلى العميل
تأكيد التسليم
رمز التسليم
```

## Admin

```text
الرئيسية
إدارة المطاعم
إضافة مطعم
طلبات الانضمام
إدارة الطلبات
المستخدمون
السائقون
العمولات والتسويات
التقارير المالية
المناطق والتغطية
المحافظات
المدن
الأدوار والصلاحيات
سجل الأنشطة
الإعدادات
```

---

# Appendix B — Example Geography SQL Shape

```sql
create table governorates (
  id uuid primary key,
  code text not null unique,
  name_ar text not null,
  name_en_internal text,
  is_enabled boolean not null default false,
  customer_signup_enabled boolean not null default false,
  restaurant_onboarding_enabled boolean not null default false,
  ordering_enabled boolean not null default false,
  source_version text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table cities (
  id uuid primary key,
  governorate_id uuid not null references governorates(id),
  code text not null unique,
  name_ar text not null,
  name_en_internal text,
  is_enabled boolean not null default false,
  customer_signup_enabled boolean not null default false,
  restaurant_onboarding_enabled boolean not null default false,
  ordering_enabled boolean not null default false,
  source_version text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

Effective state still checks the governorate parent even if the city row itself says true.

---

# Appendix C — Example Customer Profile Completion

```text
POST /api/v1/profile/complete
```

```json
{
  "full_name": "محمد علي",
  "governorate_id": "uuid",
  "city_id": "uuid"
}
```

Possible errors:

```text
CITY_GOVERNORATE_MISMATCH
GOVERNORATE_NOT_AVAILABLE
CITY_NOT_AVAILABLE
PROFILE_ALREADY_COMPLETED_CONFLICT
```

---

# Appendix D — Example Restaurant Application

```json
{
  "display_name": "مطعم البيت العراقي",
  "governorate_id": "uuid",
  "city_id": "uuid",
  "address_text": "...",
  "latitude": 33.0,
  "longitude": 44.0
}
```

Server validates owner identity, geography onboarding capability, coordinates, and duplicate-risk rules, then stores the application as `UNDER_REVIEW`.

---

# Appendix E — Example Order Calculation

```text
Items subtotal:          30,000 IQD
Restaurant discount:     -2,000 IQD
Delivery fee:             2,000 IQD
Platform service fee:     1,000 IQD
Customer total:          31,000 IQD
```

If commission is 12% and commission base is items subtotal minus restaurant-funded discount:

```text
Commission base = 28,000
Commission = 3,360 IQD
```

These become immutable order snapshots.

---

# Appendix F — Example Half-Month Statement

```text
Restaurant: Example Restaurant
Period: 1st through before 16th
Completed orders: 240
Commission base total: 5,000,000 IQD
Commission: 600,000 IQD
Credit adjustment: -20,000 IQD
Amount due: 580,000 IQD
```

Payment 1:

```text
300,000 → PARTIALLY_PAID
remaining 280,000
```

Payment 2:

```text
280,000 → PAID
```

---

# Appendix G — Example Driver Cash

Customer total:

```text
31,000 IQD
```

Delivery completed:

```text
driver custody +31,000
```

Driver hands cash to restaurant:

```text
cash handed over -31,000
current driver custody 0
```

Restaurant commission owed to Jibli remains a separate finance balance.

---

# Appendix H — Example Navigation Links

Google Maps:

```text
https://www.google.com/maps/dir/?api=1&destination=33.3128,44.3615&travelmode=driving
```

Waze:

```text
https://waze.com/ul?ll=33.3128,44.3615&navigate=yes
```

Use platform URL-encoding utilities in production.

---

# Appendix I — Critical Regression Checklist

## Geography

- parent disabled;
- child disabled;
- stale cached list;
- forged city;
- historical order after disable;
- pending restaurant after disable;
- re-enable without auto-approval.

## Order

- duplicate place;
- stale price;
- last stock;
- restaurant closes;
- city disables;
- reject;
- cancel;
- realtime fails.

## Driver

- duplicate assignment;
- reassignment;
- old driver completion;
- wrong PIN;
- duplicate confirm;
- Maps resume;
- cash duplicate.

## Finance

- commission change;
- half-month boundary;
- month boundary;
- partial payment;
- adjustment;
- reversal;
- worker retry;
- reconciliation.

## Security

- cross-tenant IDOR;
- role escalation;
- OTP brute force;
- Delivery PIN brute force;
- CSRF;
- XSS;
- SQL injection;
- file upload;
- session revocation.

---

# Appendix J — Production Go/No-Go Gate

**GO** only if:

- geography seed and launch activation are correct;
- all P0 customer/order/restaurant/driver tests pass;
- financial reconciliation has no unexplained mismatch;
- backup restore has succeeded;
- restaurant alert sound works on target hardware;
- Google Maps and Waze links work on real phones;
- Delivery PIN works;
- Admin MFA is active;
- tenant isolation tests pass;
- no Critical/High security issue remains;
- monitoring and on-call/runbooks are active;
- pilot restaurants are trained;
- rollback and kill switches are confirmed.

Otherwise the production decision is **NO-GO**.

---

**End of Jibli Complete Production Engineering Plan**
