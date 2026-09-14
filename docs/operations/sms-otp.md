# Runbook — connecting a real SMS gateway

What stands between the deployed app and a customer signing in with their own
Iraqi number. The code path is complete and tested; what this describes is the
vendor account and the eight environment variables that point at it.

## Choosing a vendor

The provider is generic on purpose, so this is a commercial decision rather
than a technical one. Three shapes of answer, for a business at this stage:

|             | OTPIQ                   | Infobip / Twilio             | Direct with Zain / Asiacell / Korek |
| ----------- | ----------------------- | ---------------------------- | ----------------------------------- |
| Signup      | self-service, minutes   | business verification, weeks | contract, in person                 |
| Billing     | prepaid IQD, no minimum | USD invoice, committed spend | monthly, per operator               |
| Coverage    | all three networks      | all three, via aggregators   | one operator each                   |
| Per message | 80–250 IQD              | typically higher for Iraq    | lowest at volume                    |
| Fallback    | WhatsApp / Telegram     | none built in                | none                                |

**Start with [OTPIQ](https://otpiq.com).** It is Iraq-and-Kurdistan only, which
is precisely the coverage needed, and it is the only one of the three that can
be signed up for and tested in an afternoon. Nothing about the choice is
permanent — switching vendors is the same eight variables pointed elsewhere,
which is why the provider was written this way.

Direct operator contracts become worth their overhead somewhere in the tens of
thousands of messages a month. Not before.

## Connecting OTPIQ

1. Sign up at [otpiq.com](https://otpiq.com) and create a project.
2. Copy the project API key — it begins `sk_live_`.
3. Add credit.
4. **Leave the sender id alone.** `SMS_GATEWAY_SENDER_ID` unset means OTPIQ's
   own approved sender is used, which is what delivered the verification above
   with nothing registered on the account. Register `Jibli` in the dashboard if
   you want your name on the SMS leg, and set the variable only once
   `GET /api/sender-ids` reports it `accepted` — an unapproved sender id is
   rejected outright, and that is a sign-in nobody can complete.

Then set, locally in `.env` or in the Render dashboard:

```sh
OTP_PROVIDER=sms_gateway
SMS_GATEWAY_URL=https://api.otpiq.com/api/sms
SMS_GATEWAY_API_KEY=sk_live_…
SMS_GATEWAY_TO_FIELD=phoneNumber
SMS_GATEWAY_SENDER_FIELD=senderId
SMS_GATEWAY_NUMBER_FORMAT=e164_no_plus
```

`NUMBER_FORMAT=e164_no_plus` because OTPIQ rejects the leading `+`. The stored
number is always `+9647XXXXXXXXX`; this only changes how it is written on the
wire.

Then one of the two modes below.

### Which key

Project settings in the dashboard offers two, and they behave differently in a
way that matters here.

`sk_live_…` sends to the number in the request. `sk_dev_…` is bound to one
"development phone number" and **ignores the number in the request entirely**,
redirecting every message to that one handset.

Use `sk_live_` to verify the integration. A dev key would silently pass the one
question `SMS_GATEWAY_NUMBER_FORMAT` exists to answer — it never reads the
number we send, so a wrong format could not fail. Verify with a live key
against your own handset, then switch to a dev key while building screens, so
a loop in the app cannot text a customer.

## Which mode: who writes the sentence

This is the decision that matters, and it is not really about wording — it
decides which channels are reachable and what each message costs.

|                              | A. verification                   | B. custom                    |
| ---------------------------- | --------------------------------- | ---------------------------- |
| We send                      | the code                          | the finished Arabic sentence |
| Wording seen by the customer | OTPIQ's approved template         | `NOTIFICATION_TEMPLATES`     |
| Channels                     | WhatsApp, Telegram, SMS           | **SMS only**                 |
| Price per message            | ~25 IQD (authentication template) | 80–250 IQD                   |

WhatsApp will not carry free text from a business — only an approved template
with a slot in it. That single fact is why mode B cannot reach WhatsApp, and
why mode A is several times cheaper.

### A. verification — recommended

```sh
SMS_GATEWAY_BODY_FIELD=verificationCode
SMS_GATEWAY_BODY_MODE=code
SMS_GATEWAY_EXTRA_FIELDS={"smsType":"verification","provider":"auto"}
```

`provider=auto` tries WhatsApp, then Telegram, then SMS. A customer who is not
on WhatsApp still receives an SMS; nobody is cut off, and the common case is
the cheap one.

The API still generates the code, hashes it, stores it, expires it and counts
attempts exactly as before. `BODY_MODE=code` only changes what travels: the
digits are read back out of the rendered message and sent alone.

### B. custom — our wording, SMS only

```sh
SMS_GATEWAY_BODY_FIELD=customMessage
SMS_GATEWAY_BODY_MODE=text
SMS_GATEWAY_EXTRA_FIELDS={"smsType":"custom","provider":"sms"}
```

`smsType=custom` is load-bearing: without it OTPIQ generates a code of its own,
the customer receives a code this API never stored, and no sign-in can ever
succeed — while every request returns `200 OK`.

## Does WhatsApp need a Meta account? No — measured

**No Meta business account, no WhatsApp Business Account, and no verification.**
Established by sending one, not by reading the documentation:

```json
{
  "status": "delivered",
  "lastChannel": "whatsapp",
  "channelFlow": [{ "channel": "whatsapp", "tried": true, "success": true }],
  "cost": 25,
  "isFinalStatus": true
}
```

What makes that conclusive is the state of the account at the time: no WABA
connected and `GET /api/sender-ids` returning `{"success":true,"data":[]}` —
nothing registered at all. OTPIQ carried it on its own approved sender.

The cost is the second half of the proof. 25 IQD is the authentication-template
rate; an SMS on the same number would have been 80–250. The channel is not
inferred from the price, but the price agrees with it.

Their _campaigns_ endpoint is genuinely different — it requires `phoneNumberId`,
so bulk marketing does need your own WABA. Verification does not.

Re-test if OTPIQ changes their terms, with:

```sh
pnpm sms:test +9647XXXXXXXXX --via whatsapp
```

## Confirming a send actually landed

Accepted is not delivered, and the gateway will say so if asked. Every send
returns a message id; `GET /api/sms/track/{smsId}` turns it into a final
status and — the useful part — the channel that carried it:

```sh
curl -H "Authorization: Bearer $SMS_GATEWAY_API_KEY" \
  https://api.otpiq.com/api/sms/track/sms-…
```

`status` runs `pending` → `sent` → `delivered` → `read`, or `failed`.
`channelFlow` shows each channel tried and whether it worked, which is how a
`provider=auto` send reveals whether it reached WhatsApp or fell through to
SMS. `isFinalStatus` says whether it can still change.

Two other endpoints are worth knowing, both free:

|                       |                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/info`       | project name and remaining credit — the cheapest way to prove a key works             |
| `GET /api/sender-ids` | registered senders and their per-carrier prices; `accepted` is the only usable status |

## Proving it before trusting it

```sh
pnpm sms:test +9647XXXXXXXXX
```

Sends one real message through the same provider class the API uses, built
from the same environment variables, carrying the same Arabic template. It
needs no database, no Redis and no running API — only the key.

`--via <channel>` overrides the vendor's channel field for one send, so a
channel can be tried before it is committed to:

```sh
pnpm sms:test +9647XXXXXXXXX --via whatsapp
pnpm sms:test +9647XXXXXXXXX --via auto
pnpm sms:test +9647XXXXXXXXX --via sms
```

It prints the request before making it, which is usually where the mistake is,
then the code it sent. Compare that against the handset:

| What arrives        | What it means                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The code it printed | Done. Sign in from the app with this number.                                                                                                                   |
| `????` or boxes     | Unicode is off. Ask the vendor which field turns Arabic on, add it to `SMS_GATEWAY_EXTRA_FIELDS`.                                                              |
| A _different_ code  | The gateway generated its own. In mode B, `smsType` is not `custom`; in mode A, `BODY_MODE` is not `code`, so the whole sentence went where the code belonged. |
| Nothing             | Sender id unapproved, number barred for A2P, or a dead route. Check the delivery report against the message id it printed.                                     |

A refusal is diagnosed in place — the gateway's own words, plus what to do
about them. `HTTP_400: Insufficient credit` names the problem; a bare
`HTTP_400` would not have.

## Any other vendor

Four questions to their documentation. Each is a way the integration fails
silently — the gateway accepts the request, bills for it, and the phone stays
quiet:

1. **How is the number written?** `+9647…` / `9647…` / `07…`
   → `SMS_GATEWAY_NUMBER_FORMAT` = `e164` | `e164_no_plus` | `national`
2. **POST JSON, POST a form, or GET a query string?**
   → `SMS_GATEWAY_METHOD`, `SMS_GATEWAY_ENCODING`
3. **What turns Arabic on?** Almost every gateway needs a constant for it.
   → `SMS_GATEWAY_EXTRA_FIELDS={"type":"unicode","route":"4"}`
4. **Does a failure come back as 4xx, or as 200 with an error inside?**
   → `SMS_GATEWAY_SUCCESS_FIELD` / `SMS_GATEWAY_SUCCESS_VALUE`. Leave unset for
   a gateway that uses status codes honestly; set them for one that does not,
   or every refusal is recorded as a successful send.

5. **Does it want the whole message, or just the code?** A vendor with a
   verification endpoint usually wants the digits and owns the wording — and
   that is the only shape WhatsApp can be reached through, whoever the vendor
   is.
   → `SMS_GATEWAY_BODY_MODE` = `text` | `code`

Field names, the auth scheme and the message-id location are configuration too.
`.env.example` lists all of them.

## What the gateway never gets to decide

Configuration covers the vendor's dialect. It does not cover the parts that
protect a customer, which are the same whichever vendor is chosen:

- An 8-second timeout, and exactly one retry — on a 5xx or a dead connection
  only. A 4xx is the gateway's answer and repeating it costs money and can get
  a sender id blocked.
- The message body is never logged. It carries the code.
- The number is masked in every log line (`+96477***`).
- Per-number cooldown, hourly and daily caps, per-IP caps, limited verification
  attempts and challenge expiry — all in `otp-service.ts`, all unchanged by
  which gateway is behind them.

## Staging without texting a real customer

`OTP_PHONE_ALLOWLIST` is a comma-separated list of E.164 numbers. When set on a
non-production deployment, delivery to anything else is refused before it
reaches the gateway. `pnpm sms:test` honours it too — a verification tool that
passed where the app would fail would be worse than none.

`OTP_TEST_PHONES` is the other half: listed numbers get `OTP_MOCK_CODE` back in
the response and never reach the gateway at all. Both are refused outright when
`APP_ENV=production`.

**Remove `OTP_TEST_PHONES` from the Render dashboard the day the gateway goes
live.** It exists because nobody could sign in without it.
