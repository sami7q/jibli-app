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
    },
  ) {}

  async send(message: SmsMessage): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
  }> {
    const toField = this.config.toField ?? 'to';
    const bodyField = this.config.bodyField ?? 'message';
    const senderField = this.config.senderField ?? 'sender';
    const scheme = this.config.authScheme ?? 'bearer';

    const payload: Record<string, string> = {
      [toField]: message.toE164,
      [bodyField]: message.body,
      ...(this.config.senderId ? { [senderField]: this.config.senderId } : {}),
      ...(scheme === 'body' ? { [this.config.apiKeyField ?? 'api_key']: this.config.apiKey } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        // A gateway that returns an id lets a delivery report be matched later;
        // one that does not is still a successful send.
        let id: string | undefined;
        try {
          const parsed = (await response.json()) as Record<string, unknown>;
          const candidate = parsed.message_id ?? parsed.messageId ?? parsed.id;
          if (typeof candidate === 'string') id = candidate;
        } catch {
          /* not JSON, which several gateways are not */
        }
        return { ok: true, permanent: true, ...(id ? { id } : {}) };
      }

      return {
        ok: false,
        // 4xx is the gateway's answer; 5xx might be a bad minute.
        permanent: response.status < 500,
        status: response.status,
        error: `HTTP_${response.status}`,
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
   * every caller, to save one regex in the one place that needs it.
   */
  private extractCode(body: string): string | null {
    const match = /(\d{4,8})/.exec(body);
    return match?.[1] ?? null;
  }

  async send(message: SmsMessage): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
  }> {
    const code = this.extractCode(message.body);
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
    bodyAr: `المطعم قبل طلبك رقم ${orderNumber} وبدأ التحضير قريباً`,
  }),
  orderPreparing: (orderNumber: string): NotificationTemplate => ({
    titleAr: 'جاري تحضير طلبك',
    bodyAr: `طلبك رقم ${orderNumber} قيد التحضير الآن`,
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
    bodyAr: `للأسف لم يتمكن المطعم من قبول طلبك رقم ${orderNumber}`,
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
