import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { Logger } from '@jibli/logger';

/**
 * Notification and OTP delivery providers (plan §56, §170).
 *
 * Every external vendor sits behind an interface so it can be swapped without
 * touching domain code, and so staging can run against a console implementation
 * that cannot text a real customer (plan §7).
 */

// ── OTP / SMS ────────────────────────────────────────────────────────────────

export interface SmsMessage {
  readonly toE164: string;
  readonly body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ ok: boolean; providerMessageId?: string; error?: string }>;
}

/**
 * Development provider. Logs that a code was issued — never the code itself
 * (plan §10: "Do not log OTP values").
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  constructor(
    private readonly logger: Logger,
    /** Local development only: echo the code so a developer can log in. */
    private readonly revealCodes = false,
  ) {}

  async send(message: SmsMessage): Promise<{ ok: boolean; providerMessageId: string }> {
    this.logger.info(
      {
        event: 'sms.send',
        provider: this.name,
        to: `${message.toE164.slice(0, 6)}***`,
        ...(this.revealCodes ? { devBody: message.body } : {}),
      },
      'SMS dispatched (console provider)',
    );
    return { ok: true, providerMessageId: `console-${Date.now()}` };
  }
}

/**
 * The verification code, read back out of the rendered Arabic sentence.
 *
 * Two providers need the code rather than the message: Meta's authentication
 * template takes it as a parameter, and OTP-specialised gateways like OTPIQ
 * take it as `verificationCode`. Both are handed a finished body by a caller
 * that has no idea either of them exists.
 *
 * One definition rather than one per provider, because two regexes that must
 * agree about what a code looks like will eventually stop agreeing, and the
 * symptom would be a channel that silently sends the wrong digits.
 */
export function extractOtpCode(body: string): string | null {
  const match = /(\d{4,8})/.exec(body);
  return match?.[1] ?? null;
}

/**
 * A value out of a possibly-nested response body: `smsId`, or `data.messageId`.
 *
 * Gateways that wrap their answer in an envelope are common enough that a flat
 * lookup would send a correctly-configured deployment back to reading raw
 * responses to find out why its sends report no id.
 */
function readPath(source: Record<string, unknown> | null, path: string): unknown {
  if (!source) return undefined;
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

/**
 * The gateway's own reason for a refusal, short enough to belong in a log line.
 *
 * `HTTP_400` on its own cannot be acted on: an unapproved sender id, an
 * exhausted balance and a malformed number are three different problems with
 * three different fixes and one status code between them. The gateway says
 * which in the body — OTPIQ answers `{"error":"Insufficient credit, please add
 * more credit"}` — and reading a body that is about to be discarded anyway is
 * the difference between a deployment that can be fixed and one that can only
 * be guessed at.
 *
 * Bounded on both sides: the read cannot hang the send, because the same abort
 * signal governs it, and the string cannot flood a log, because it is
 * truncated here.
 */
async function describeRefusal(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    if (!text) return undefined;

    // Most answer JSON, and name the field `error` or `message` about equally
    // often. Falling through to the raw text covers the ones that do neither.
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reason = parsed.error ?? parsed.message ?? parsed.error_message;
      if (typeof reason === 'string' && reason.length > 0) return reason.slice(0, 200);
    } catch {
      /* not JSON, in which case the text is itself the reason */
    }

    return text.slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * A real SMS gateway, over HTTP.
 *
 * `OTP_PROVIDER=sms_gateway` has been a valid setting since the config was
 * written — and production refuses to boot without it — but nothing
 * implemented it, so the only provider that existed was the console stub and
 * nobody could sign into the app from a deployed build.
 *
 * Deliberately generic rather than Twilio-shaped. Iraqi OTP traffic is usually
 * bought from a local aggregator whose API is a POST with an API key, and
 * every one of them differs in the names of three fields — so the field names
 * are configuration too. What is *not* configurable is the part that matters:
 * the timeout, the single retry, and never logging the body.
 */
export class HttpSmsGatewayProvider implements SmsProvider {
  readonly name = 'sms_gateway';

  constructor(
    private readonly logger: Logger,
    private readonly config: {
      readonly url: string;
      readonly apiKey: string;
      readonly senderId?: string | undefined;
      /** Field names, because no two Iraqi aggregators agree on them. */
      readonly toField?: string | undefined;
      readonly bodyField?: string | undefined;
      readonly senderField?: string | undefined;
      /** How the key travels: a bearer token, or a field in the body. */
      readonly authScheme?: 'bearer' | 'header' | 'body' | undefined;
      readonly apiKeyHeader?: string | undefined;
      readonly apiKeyField?: string | undefined;
      readonly timeoutMs?: number | undefined;
      /**
       * How the number is written on the wire.
       *
       * The single most common reason a correctly-configured gateway silently
       * delivers nothing. Iraqi aggregators disagree: some want E.164 with the
       * plus, some reject the plus, and several want the national trunk form
       * the customer would dial — `07701234567`. All three are the same number
       * and none of them is guessable from a vendor's documentation, which
       * usually shows one example and calls it obvious.
       */
      readonly numberFormat?: 'e164' | 'e164_no_plus' | 'national' | undefined;
      /**
       * POST with a JSON body, POST a form, or GET a query string.
       *
       * Roughly a third of the aggregators in this market are a GET endpoint
       * with the message in the query — an older shape, and not a wrong one.
       * Without this the provider could only ever talk to the third that
       * happen to take JSON.
       */
      readonly method?: 'POST' | 'GET' | undefined;
      readonly encoding?: 'json' | 'form' | undefined;
      /**
       * Constants the vendor needs and nobody else does.
       *
       * `type=unicode`, `route=4`, `dcs=8`, `unicodeMessage=1` — every gateway
       * has one or two of these and every one names them differently. They are
       * the difference between an Arabic message arriving and arriving as
       * question marks, which is a failure nobody notices until a customer
       * says the code did not make sense.
       */
      readonly extraFields?: Readonly<Record<string, string>> | undefined;
      /**
       * What a successful answer looks like, when 200 is not enough.
       *
       * Plenty of aggregators answer `200 OK` with `{"status":"error"}` in the
       * body — out of credit, sender id not approved, number barred — and a
       * provider that reads only the status code records those as sent. The
       * customer waits for a code that was never dispatched and the log says
       * everything worked, which is the worst failure mode this class can
       * have.
       *
       * Optional, and checked only when set: an unconfigured gateway keeps the
       * old behaviour rather than having a guess imposed on it.
       */
      readonly successField?: string | undefined;
      /** The value that field must hold. Compared as text, case-insensitively. */
      readonly successValue?: string | undefined;
      /**
       * Whether the body field carries the message, or only the code.
       *
       * `text` is an ordinary SMS gateway: it is handed a finished sentence
       * and sends it verbatim.
       *
       * `code` is the OTP-specialised shape — OTPIQ's `smsType=verification`,
       * and most gateways that offer a verification endpoint. There the
       * gateway owns the wording and wants the digits alone, which is what
       * makes WhatsApp reachable through it at all: WhatsApp refuses free
       * text from a business and will only carry an approved template with a
       * slot in it.
       *
       * The trade is real and worth stating. In `code` mode the customer sees
       * the vendor's approved sentence rather than `NOTIFICATION_TEMPLATES`,
       * so the Arabic wording is no longer ours. What it buys is a channel
       * that costs a fraction of SMS and arrives in an app that is already
       * open.
       */
      readonly bodyMode?: 'text' | 'code' | undefined;
      /**
       * Where the gateway puts the id it assigns the message.
       *
       * Guessed from the usual handful of names when unset, which covers most
       * gateways and misses the rest. An id that is not picked up is not a
       * failed send — only a delivery report that cannot be matched to it
       * later — so this is a convenience, not a correctness setting.
       *
       * Dotted paths reach into an envelope: `data.messageId`.
       */
      readonly messageIdField?: string | undefined;
    },
  ) {}

  /**
   * The recipient, in the shape this particular gateway expects.
   *
   * `+9647701234567` is the stored truth; everything else is a rendering of
   * it. National form drops the country code and restores the trunk zero,
   * which is what an Iraqi number looks like written down.
   */
  private formatNumber(e164: string): string {
    switch (this.config.numberFormat ?? 'e164') {
      case 'e164_no_plus':
        return e164.replace(/^\+/, '');
      case 'national': {
        const digits = e164.replace(/^\+?964/, '');
        return digits.startsWith('0') ? digits : `0${digits}`;
      }
      default:
        return e164;
    }
  }

  async send(message: SmsMessage): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
  }> {
    const toField = this.config.toField ?? 'to';
    const bodyField = this.config.bodyField ?? 'message';
    const senderField = this.config.senderField ?? 'sender';
    const scheme = this.config.authScheme ?? 'bearer';

    /*
     * In `code` mode a body with no digits in it is not a verification
     * message, and sending it would spend a message on a gateway that would
     * reject it — or worse, accept it and deliver nothing a customer can type
     * in. Refused here, permanently, rather than retried.
     */
    let outgoingBody = message.body;
    if (this.config.bodyMode === 'code') {
      const code = extractOtpCode(message.body);
      if (!code) {
        this.logger.error(
          { event: 'sms.send_failed', provider: this.name, reason: 'NO_CODE_IN_BODY' },
          'Gateway is in code mode and the message carried no verification code',
        );
        return { ok: false, error: 'NO_CODE_IN_BODY' };
      }
      outgoingBody = code;
    }

    const payload: Record<string, string> = {
      [toField]: this.formatNumber(message.toE164),
      [bodyField]: outgoingBody,
      ...(this.config.senderId ? { [senderField]: this.config.senderId } : {}),
      ...(scheme === 'body' ? { [this.config.apiKeyField ?? 'api_key']: this.config.apiKey } : {}),
      // Last, so a vendor's own constants win over a name this provider
      // happened to pick as a default.
      ...(this.config.extraFields ?? {}),
    };

    const encoding = this.config.encoding ?? 'json';

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(this.config.method === 'GET'
        ? {}
        : {
            'Content-Type':
              encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
          }),
      ...(scheme === 'bearer' ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(scheme === 'header'
        ? { [this.config.apiKeyHeader ?? 'X-API-Key']: this.config.apiKey }
        : {}),
    };

    /*
     * One retry, and only on a transport failure or a 5xx.
     *
     * A 4xx is the gateway saying the number is wrong or the account is out of
     * credit; repeating it wastes the customer's time and can cost money. A
     * timeout might be the gateway and might be the network, and an OTP that
     * never arrives is a customer who cannot sign in at all.
     */
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await this.attempt(payload, headers);

      if (outcome.ok || outcome.permanent) {
        this.logger[outcome.ok ? 'info' : 'error'](
          {
            event: 'sms.send',
            provider: this.name,
            // Never the body: it carries the code (plan §10).
            to: `${message.toE164.slice(0, 6)}***`,
            attempt,
            ...(outcome.status ? { status: outcome.status } : {}),
            ...(outcome.error ? { err: outcome.error } : {}),
          },
          outcome.ok ? 'SMS dispatched' : 'SMS refused by gateway',
        );
        return outcome.ok
          ? { ok: true, ...(outcome.id ? { providerMessageId: outcome.id } : {}) }
          : { ok: false, error: outcome.error ?? 'GATEWAY_REFUSED' };
      }

      if (attempt === 2) {
        this.logger.error(
          {
            event: 'sms.send_failed',
            provider: this.name,
            to: `${message.toE164.slice(0, 6)}***`,
            err: outcome.error,
          },
          'SMS gateway unreachable after retry',
        );
        return { ok: false, error: outcome.error ?? 'GATEWAY_UNREACHABLE' };
      }
    }

    return { ok: false, error: 'GATEWAY_UNREACHABLE' };
  }

  private async attempt(
    payload: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<{
    ok: boolean;
    /** True when retrying cannot help — a rejection, not a failure to reach. */
    permanent: boolean;
    id?: string;
    status?: number;
    error?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8000);

    const method = this.config.method ?? 'POST';
    const encoding = this.config.encoding ?? 'json';

    /*
     * A GET carries everything in the query, so there is no body to send — and
     * `URLSearchParams` is what encodes an Arabic message correctly for both
     * shapes. Hand-built query strings are where an OTP turns into mojibake.
     */
    const query = new URLSearchParams(payload).toString();

    /*
     * `&` when the configured URL already has a query of its own — several
     * gateways carry the account id there — because a second `?` collapses the
     * whole query into one unparseable parameter and the gateway answers with
     * a validation error naming a field that was sent correctly.
     */
    const url =
      method === 'GET'
        ? `${this.config.url}${this.config.url.includes('?') ? '&' : '?'}${query}`
        : this.config.url;

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(method === 'GET'
          ? {}
          : { body: encoding === 'form' ? query : JSON.stringify(payload) }),
        signal: controller.signal,
      });

      if (response.ok) {
        // A gateway that returns an id lets a delivery report be matched later;
        // one that does not is still a successful send.
        let id: string | undefined;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = (await response.json()) as Record<string, unknown>;
          const candidate = this.config.messageIdField
            ? readPath(parsed, this.config.messageIdField)
            : (parsed.message_id ?? parsed.messageId ?? parsed.smsId ?? parsed.id);
          if (typeof candidate === 'string') id = candidate;
          // Numeric ids are common and are still ids.
          else if (typeof candidate === 'number') id = String(candidate);
        } catch {
          /* not JSON, which several gateways are not */
        }

        /*
         * A refusal dressed as a 200.
         *
         * Only when the deployment said what success looks like. Reported as
         * permanent because that is what these are — no credit, an unapproved
         * sender id, a barred number — and retrying spends the customer's
         * patience on an answer that will not change.
         */
        if (this.config.successField) {
          const actual = readPath(parsed, this.config.successField);
          const expected = this.config.successValue;
          const matches =
            expected === undefined
              ? actual !== undefined && actual !== null && actual !== false
              : String(actual).toLowerCase() === expected.toLowerCase();

          if (!matches) {
            return {
              ok: false,
              permanent: true,
              status: response.status,
              error: `GATEWAY_SAID_${String(actual ?? 'NOTHING').slice(0, 40)}`,
            };
          }
        }

        return { ok: true, permanent: true, ...(id ? { id } : {}) };
      }

      const detail = await describeRefusal(response);

      return {
        ok: false,
        // 4xx is the gateway's answer; 5xx might be a bad minute.
        permanent: response.status < 500,
        status: response.status,
        error: detail ? `HTTP_${response.status}: ${detail}` : `HTTP_${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        permanent: false,
        error: error instanceof Error ? error.name : 'FETCH_FAILED',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * OTP over WhatsApp, through Meta's Cloud API.
 *
 * Chosen over SMS for the market rather than for the technology. An Iraqi
 * customer has WhatsApp; a local SMS aggregator costs money per message, needs
 * a contract signed in person, and delivers unevenly across the three
 * networks — while an authentication template costs a fraction of that and
 * arrives in the app the customer already has open.
 *
 * A separate class rather than configuration on `HttpSmsGatewayProvider`,
 * because the two are not the same shape. That gateway maps three flat field
 * names, which is all an aggregator needs; Cloud API wants a nested `template`
 * with a `components` array, and bending field-name configuration into that
 * would have produced a config nobody could read and a provider that still
 * could not express a button.
 *
 * What Meta requires before this sends anything, none of which is code:
 *
 *   - a verified Meta business, a WhatsApp Business Account, and a phone
 *     number registered to it — not a number already on the consumer app
 *   - a template in the **AUTHENTICATION** category, approved. Utility and
 *     marketing templates are refused for codes, and an unapproved one fails
 *     with 132001 rather than quietly sending the wrong thing
 *   - a permanent System User token. The one the dashboard offers first
 *     expires in 24 hours and would strand sign-in the next morning
 */
export class WhatsAppOtpProvider implements SmsProvider {
  readonly name = 'whatsapp';

  constructor(
    private readonly logger: Logger,
    private readonly config: {
      /** The sender's id from WhatsApp Manager — not the phone number itself. */
      readonly phoneNumberId: string;
      readonly accessToken: string;
      /** The approved AUTHENTICATION template's name. */
      readonly templateName: string;
      /** Its language, exactly as registered: `ar`, `ar_EG`, `en_US`. */
      readonly templateLanguage?: string | undefined;
      /**
       * Whether the template carries a copy-code button.
       *
       * Meta's authentication templates almost always do, and the button takes
       * the code as a parameter of its own — send the body alone and the whole
       * message is refused with 132000, «number of parameters does not match».
       */
      readonly hasCopyCodeButton?: boolean | undefined;
      readonly apiVersion?: string | undefined;
      readonly timeoutMs?: number | undefined;
    },
  ) {}

  /**
   * The code, read back out of the rendered Arabic sentence.
   *
   * Every other provider takes a finished body and sends it. WhatsApp cannot:
   * an authentication template is a fixed, approved sentence with a slot, and
   * what travels is the slot's value. So the caller's message is where the
   * code is *read from* rather than what is transmitted, and the wording the
   * customer sees is Meta's approved copy rather than `NOTIFICATION_TEMPLATES`.
   *
   * Deliberately not a new interface. Changing `SmsProvider` to carry a code
   * would push a WhatsApp detail into the console provider, the allowlist and
   * every caller, to save one regex in the one place that needs it — and it is
   * no longer one place, so `extractOtpCode` is shared with the SMS gateway's
   * `code` mode rather than copied into it.
   */

  async send(message: SmsMessage): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
  }> {
    const code = extractOtpCode(message.body);
    if (!code) {
      // Neither retryable nor the network's fault: this provider was handed
      // something that is not a verification message.
      this.logger.error(
        { event: 'whatsapp.send_failed', reason: 'NO_CODE_IN_BODY' },
        'WhatsApp provider received a message with no verification code in it',
      );
      return { ok: false, error: 'NO_CODE_IN_BODY' };
    }

    const version = this.config.apiVersion ?? 'v21.0';
    const url = `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Cloud API wants the number without the leading plus.
      to: message.toE164.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: this.config.templateName,
        language: { code: this.config.templateLanguage ?? 'ar' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          ...(this.config.hasCopyCodeButton === false
            ? []
            : [
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: code }],
                },
              ]),
        ],
      },
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.accessToken}`,
    };

    /*
     * One retry, on a transport failure or a 5xx only — the same rule the SMS
     * gateway follows, for the same reason. A 4xx from Meta is an answer: a
     * template that was never approved, a number with no WhatsApp, a token
     * that expired. Repeating any of those spends the customer's patience
     * waiting for a code that is not coming.
     */
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await this.attempt(url, payload, headers);

      if (outcome.ok || outcome.permanent) {
        this.logger[outcome.ok ? 'info' : 'error'](
          {
            event: 'whatsapp.send',
            provider: this.name,
            // Never the code, and never the payload that carries it (plan §10).
            to: `${message.toE164.slice(0, 6)}***`,
            attempt,
            ...(outcome.status ? { status: outcome.status } : {}),
            ...(outcome.error ? { err: outcome.error } : {}),
          },
          outcome.ok ? 'OTP dispatched over WhatsApp' : 'WhatsApp refused the message',
        );

        return outcome.ok
          ? { ok: true, ...(outcome.id ? { providerMessageId: outcome.id } : {}) }
          : { ok: false, error: outcome.error ?? 'WHATSAPP_REFUSED' };
      }

      if (attempt === 2) {
        this.logger.error(
          {
            event: 'whatsapp.send_failed',
            provider: this.name,
            to: `${message.toE164.slice(0, 6)}***`,
            err: outcome.error,
          },
          'WhatsApp unreachable after retry',
        );
        return { ok: false, error: outcome.error ?? 'WHATSAPP_UNREACHABLE' };
      }
    }

    return { ok: false, error: 'WHATSAPP_UNREACHABLE' };
  }

  private async attempt(
    url: string,
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<{
    ok: boolean;
    /** True when retrying cannot help — a refusal, not a failure to reach. */
    permanent: boolean;
    id?: string;
    status?: number;
    error?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        let id: string | undefined;
        try {
          const parsed = (await response.json()) as { messages?: { id?: unknown }[] };
          const candidate = parsed.messages?.[0]?.id;
          if (typeof candidate === 'string') id = candidate;
        } catch {
          /* A 200 with an unreadable body is still a send. */
        }
        return { ok: true, permanent: true, ...(id ? { id } : {}) };
      }

      /*
       * Meta's own error code, not only the HTTP status.
       *
       * «HTTP_400» is the same string for a template that was never approved,
       * a token that has expired and a number with no WhatsApp — three
       * different problems with three different fixes, and the operator
       * reading the log is the person who has to tell them apart.
       */
      let detail: string | undefined;
      try {
        const parsed = (await response.json()) as {
          error?: { code?: unknown; error_subcode?: unknown; message?: unknown };
        };
        const parts = [parsed.error?.code, parsed.error?.error_subcode]
          .filter((part) => typeof part === 'number')
          .join('/');
        if (parts) detail = `META_${parts}`;
        else if (typeof parsed.error?.message === 'string') {
          detail = parsed.error.message.slice(0, 120);
        }
      } catch {
        /* Not JSON. The status is all there is. */
      }

      return {
        ok: false,
        permanent: response.status < 500,
        status: response.status,
        error: detail ?? `HTTP_${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        permanent: false,
        error: error instanceof Error ? error.name : 'FETCH_FAILED',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Wraps any provider with an allowlist so a staging deployment cannot send to
 * arbitrary real numbers (plan §7).
 */
export class AllowlistSmsProvider implements SmsProvider {
  readonly name: string;

  constructor(
    private readonly inner: SmsProvider,
    private readonly allowedE164: readonly string[],
    private readonly logger: Logger,
  ) {
    this.name = `allowlist(${inner.name})`;
  }

  async send(message: SmsMessage) {
    if (!this.allowedE164.includes(message.toE164)) {
      this.logger.warn(
        { event: 'sms.blocked_by_allowlist', to: `${message.toE164.slice(0, 6)}***` },
        'SMS blocked: recipient not in the non-production allowlist',
      );
      return { ok: false, error: 'RECIPIENT_NOT_ALLOWLISTED' };
    }
    return this.inner.send(message);
  }
}

// ── Push ─────────────────────────────────────────────────────────────────────

export interface PushMessage {
  readonly token: string;
  readonly titleAr: string;
  readonly bodyAr: string;
  readonly data?: Record<string, string>;
  /** Android channel / iOS category for order alerts. */
  readonly channelId?: string;
  /**
   * A sound bundled into the app (`new-order.wav`), or the system default.
   * iOS plays the named file; Android takes the sound from the channel, which
   * is why work alerts also travel on their own `work` channel.
   */
  readonly sound?: string;
}

export interface PushResult {
  readonly ok: boolean;
  /** Set when the provider reports the token is permanently dead. */
  readonly tokenInvalid?: boolean;
  readonly error?: string;
}

export interface PushProvider {
  readonly name: string;
  send(message: PushMessage): Promise<PushResult>;
  sendMany(messages: PushMessage[]): Promise<PushResult[]>;
}

/**
 * Logs that a notification would have been sent, and sends nothing.
 *
 * Legitimate in local development and in tests. It is **not** legitimate in
 * production, and for a long time it was what production ran: the worker
 * constructed this unconditionally, so every notification the platform produced
 * was written to `notification_deliveries` as `SENT` and never left the server.
 * Nothing in the system could tell the difference — which is why
 * `createPushProvider` below now refuses to return it outside development.
 */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';

  constructor(private readonly logger: Logger) {}

  async send(message: PushMessage): Promise<PushResult> {
    this.logger.info(
      { event: 'push.send', provider: this.name, title: message.titleAr },
      'Push dispatched (console provider)',
    );
    return { ok: true };
  }

  async sendMany(messages: PushMessage[]): Promise<PushResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }
}

/**
 * Expo's push service — the one the mobile app is actually built against.
 *
 * `apps/mobile/src/lib/push.ts` registers with `getExpoPushTokenAsync`, so the
 * tokens in `user_devices` are Expo tokens (`ExponentPushToken[...]`). Expo then
 * fans out to APNs and FCM, which is why iOS needs only an APNs key on EAS and
 * Android needs FCM credentials there — neither belongs in this process.
 *
 * Three things this has to get right, and only the first is obvious:
 *
 *   **Order.** `outbox-publisher.ts` maps results back to devices *by index* to
 *   decide which token to revoke. Expo's API chunks, and a chunk boundary does
 *   not line up with the caller's array — so results are written back into a
 *   pre-sized array at the original index rather than concatenated. Getting
 *   this wrong revokes a working device because a different one was dead.
 *
 *   **A ticket is not a delivery.** `status: 'ok'` means Expo accepted the
 *   message, not that a phone received it. That is the honest meaning of
 *   `PushResult.ok`, and the caller is told so at its own call site.
 *
 *   **Which failures are permanent.** `DeviceNotRegistered` means the app was
 *   uninstalled and the token is dead forever; everything else is transient and
 *   must not revoke anything.
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';

  private readonly client: Expo;

  constructor(
    private readonly logger: Logger,
    config: {
      /**
       * Optional. Expo accepts unauthenticated pushes; an access token raises
       * the rate limit and is required once "enhanced security" is switched on
       * for the project, at which point its absence is a silent 401.
       */
      readonly accessToken?: string | undefined;
    } = {},
  ) {
    this.client = new Expo(config.accessToken ? { accessToken: config.accessToken } : {});
  }

  async send(message: PushMessage): Promise<PushResult> {
    const [result] = await this.sendMany([message]);
    return result ?? { ok: false, error: 'NO_RESULT' };
  }

  async sendMany(messages: PushMessage[]): Promise<PushResult[]> {
    // Pre-sized so every write lands at the caller's index. See the note above.
    const results: PushResult[] = new Array<PushResult>(messages.length);

    /** Only the messages worth sending, each remembering where it came from. */
    const sendable: { index: number; payload: ExpoPushMessage }[] = [];

    for (const [index, message] of messages.entries()) {
      /*
       * A malformed token is rejected here rather than by Expo.
       *
       * Expo answers a bad token with a whole-request error rather than a
       * per-message ticket, so one stale row could otherwise cost the entire
       * batch — every other customer in it silently unnotified.
       *
       * It is permanent, so it is reported as `tokenInvalid` and the caller
       * revokes the row.
       */
      if (!Expo.isExpoPushToken(message.token)) {
        results[index] = { ok: false, tokenInvalid: true, error: 'INVALID_TOKEN_FORMAT' };
        continue;
      }

      sendable.push({
        index,
        payload: {
          to: message.token,
          title: message.titleAr,
          body: message.bodyAr,
          ...(message.data ? { data: message.data } : {}),
          ...(message.channelId ? { channelId: message.channelId } : {}),
          /*
           * An order update is time-sensitive by definition — «طلبك جاهز» an
           * hour late is worse than useless. `high` is what asks iOS and
           * Android to deliver rather than to batch.
           */
          priority: 'high',
          sound: message.sound ?? 'default',
        },
      });
    }

    if (sendable.length === 0) return results;

    for (const chunk of this.client.chunkPushNotifications(sendable.map((s) => s.payload))) {
      /*
       * Which caller indices this chunk covers.
       *
       * `chunkPushNotifications` preserves order but not identity, so the
       * originals are consumed in the same order they were handed over.
       */
      const covered = sendable.splice(0, chunk.length);

      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.client.sendPushNotificationsAsync(chunk);
      } catch (error) {
        /*
         * The whole chunk failed — network, 5xx, or a rejected access token.
         * Transient by assumption, so no token is revoked: a credentials
         * problem must not be allowed to delete every device on the platform.
         */
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(
          { event: 'push.chunk_failed', provider: this.name, count: chunk.length, reason },
          'Expo push chunk failed',
        );
        for (const { index } of covered) {
          results[index] = { ok: false, error: reason };
        }
        continue;
      }

      for (const [position, ticket] of tickets.entries()) {
        const target = covered[position];
        if (!target) continue;

        if (ticket.status === 'ok') {
          // Accepted by Expo. Not the same as delivered — see the class note.
          results[target.index] = { ok: true };
          continue;
        }

        /*
         * `DeviceNotRegistered` is the only permanent one: the app was
         * uninstalled, or the token was rotated and this row is the old one.
         * `MessageRateExceeded` and `ProviderError` are transient;
         * `DeveloperError` and `InvalidCredentials` are ours to fix and would
         * be catastrophic to act on by deleting devices.
         */
        const code = ticket.details?.error;
        const permanent = code === 'DeviceNotRegistered';

        this.logger.warn(
          { event: 'push.rejected', provider: this.name, code: code ?? 'UNKNOWN', permanent },
          'Expo rejected a push message',
        );

        results[target.index] = {
          ok: false,
          ...(permanent ? { tokenInvalid: true } : {}),
          error: code ?? ticket.message,
        };
      }

      // A short chunk response would otherwise leave holes in the array.
      for (const { index } of covered.slice(tickets.length)) {
        results[index] = { ok: false, error: 'NO_TICKET_RETURNED' };
      }
    }

    return results;
  }
}

/**
 * The provider this process should use, chosen from configuration.
 *
 * It exists because the worker used to construct `ConsolePushProvider`
 * directly and never read `PUSH_PROVIDER` at all — so the setting was
 * decorative, and production silently sent nothing while recording success.
 * Selection now happens in exactly one place, and that place refuses the
 * combination that caused it.
 *
 * `fcm` is accepted by the config schema and has no implementation. It throws
 * rather than falling back, because falling back to a stub is the failure mode
 * this whole function exists to prevent.
 */
export function createPushProvider(
  config: {
    readonly provider: 'console' | 'expo' | 'fcm';
    readonly nodeEnv: string;
    readonly expoAccessToken?: string | undefined;
  },
  logger: Logger,
): PushProvider {
  if (config.provider === 'console') {
    /*
     * Fail at boot, loudly, rather than at a customer's first order, silently.
     *
     * The env schema already refuses this when `APP_ENV=production`, but the
     * deployment that shipped the bug ran `APP_ENV=staging` with
     * `NODE_ENV=production` — so the guard that mattered was the one nobody
     * had written. This is that guard.
     */
    if (config.nodeEnv === 'production') {
      throw new Error(
        'PUSH_PROVIDER=console cannot run under NODE_ENV=production: it logs ' +
          'notifications and sends nothing, while recording them as SENT. ' +
          'Set PUSH_PROVIDER=expo.',
      );
    }
    return new ConsolePushProvider(logger);
  }

  if (config.provider === 'expo') {
    return new ExpoPushProvider(logger, { accessToken: config.expoAccessToken });
  }

  throw new Error(
    `PUSH_PROVIDER=${config.provider} has no implementation. Use 'expo' — the ` +
      'mobile app registers Expo push tokens, and Expo fans out to APNs and FCM.',
  );
}

// ── Arabic notification templates (plan §56) ─────────────────────────────────

export interface NotificationTemplate {
  readonly titleAr: string;
  readonly bodyAr: string;
}

/**
 * Bodies deliberately omit addresses and phone numbers: a push body can appear
 * on a locked screen (plan §107).
 */
export const NOTIFICATION_TEMPLATES = {
  orderAccepted: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'تم قبول طلبك',
    bodyAr: `تم قبول طلبك رقم ${orderNumber} وسيبدأ تجهيزه الآن`,
  }),
  orderPreparing: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'جاري تجهيز طلبك',
    bodyAr: `طلبك رقم ${orderNumber} قيد التجهيز الآن`,
  }),
  orderReady: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'طلبك جاهز',
    bodyAr: `طلبك رقم ${orderNumber} جاهز وبانتظار المندوب`,
  }),
  orderOutForDelivery: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'طلبك في الطريق',
    bodyAr: `المندوب استلم طلبك رقم ${orderNumber} وهو في الطريق إليك`,
  }),
  orderArrived: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'المندوب وصل',
    bodyAr: `المندوب وصل لتسليم طلبك رقم ${orderNumber}`,
  }),
  orderDelivered: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'تم تسليم طلبك',
    bodyAr: `تم تسليم طلبك رقم ${orderNumber}. شكراً لاستخدامك جيبلي`,
  }),
  orderRejected: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'تعذّر قبول الطلب',
    bodyAr: `للأسف لم يتمكن المتجر من قبول طلبك رقم ${orderNumber}`,
  }),
  orderCancelled: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'تم إلغاء الطلب',
    bodyAr: `تم إلغاء طلبك رقم ${orderNumber}`,
  }),

  newOrderForRestaurant: (orderNumber: string, total: string): NotificationTemplate => ({
    titleAr: 'طلب جديد',
    bodyAr: `وصل طلب جديد رقم ${orderNumber} بقيمة ${total}`,
  }),
  lowStock: (itemName: string): NotificationTemplate => ({
    titleAr: 'تنبيه مخزون',
    bodyAr: `كمية "${itemName}" أوشكت على النفاد`,
  }),
  settlementIssued: (amount: string): NotificationTemplate => ({
    titleAr: 'كشف عمولة جديد',
    bodyAr: `تم إصدار كشف العمولة بمبلغ ${amount}`,
  }),
  settlementOverdue: (amount: string): NotificationTemplate => ({
    titleAr: 'عمولة مستحقة',
    bodyAr: `لديك مبلغ عمولة مستحق ${amount}. الرجاء المراجعة`,
  }),

  newAssignmentForDriver: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'طلب توصيل جديد',
    bodyAr: `تم تعيينك لتوصيل الطلب رقم ${orderNumber}`,
  }),
  /** The order a courier is holding is packed — time to collect it. */
  orderReadyForDriver: (orderNumber: string, shopName: string): NotificationTemplate => ({
    titleAr: 'الطلب جاهز للاستلام',
    bodyAr: shopName
      ? `الطلب رقم ${orderNumber} جاهز في ${shopName}. توجّه لاستلامه`
      : `الطلب رقم ${orderNumber} جاهز. توجّه لاستلامه`,
  }),
  /** A courier said no: the shop has an order with nobody to carry it. */
  deliveryRejectedForRestaurant: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'المندوب رفض التوصيل',
    bodyAr: `رفض المندوب توصيل الطلب رقم ${orderNumber}. أسنده إلى مندوب آخر`,
  }),
  assignmentCancelled: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'تم إلغاء التعيين',
    bodyAr: `لم يعد الطلب رقم ${orderNumber} معيّناً لك`,
  }),
  driverInvited: (): NotificationTemplate => ({
    titleAr: 'مرحباً بك في جيبلي',
    bodyAr: 'تم إنشاء حسابك كمندوب توصيل. سجّل الدخول بالتطبيق لتفعيل الحساب',
  }),

  restaurantApproved: (): NotificationTemplate => ({
    titleAr: 'تم اعتماد مطعمك',
    bodyAr: 'تمت الموافقة على طلب انضمامك إلى جيبلي',
  }),
  restaurantRejected: (): NotificationTemplate => ({
    titleAr: 'طلب الانضمام',
    bodyAr: 'لم تتم الموافقة على طلب الانضمام. راجع التفاصيل في البوابة',
  }),
  restaurantInfoRequested: (): NotificationTemplate => ({
    titleAr: 'مطلوب معلومات إضافية',
    bodyAr: 'نحتاج معلومات إضافية لإكمال مراجعة طلب انضمامك',
  }),

  otpCode: (code: string): NotificationTemplate => ({
    titleAr: 'رمز التحقق',
    bodyAr: `رمز التحقق الخاص بك في جيبلي هو ${code}. لا تشاركه مع أي شخص`,
  }),
} as const;
