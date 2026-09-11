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
