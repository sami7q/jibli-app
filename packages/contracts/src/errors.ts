/**
 * Error taxonomy.
 *
 * Plan §66 and §76: clients branch on a stable machine-readable `code`; the
 * Arabic `message` is for humans only. Adding a code here is the only way a new
 * failure reaches a client, which keeps mobile error handling exhaustive.
 */

export const ERROR_CODES = {
  // ── Generic ────────────────────────────────────────────────────────────────
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  APP_VERSION_UNSUPPORTED: 'APP_VERSION_UNSUPPORTED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  // ── Identity (plan §76) ────────────────────────────────────────────────────
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_COOLDOWN_ACTIVE: 'OTP_COOLDOWN_ACTIVE',
  OTP_DELIVERY_FAILED: 'OTP_DELIVERY_FAILED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  PROFILE_ALREADY_COMPLETED_CONFLICT: 'PROFILE_ALREADY_COMPLETED_CONFLICT',
  MFA_REQUIRED: 'MFA_REQUIRED',
  REAUTHENTICATION_REQUIRED: 'REAUTHENTICATION_REQUIRED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',

  // ── Geography (plan §76) ───────────────────────────────────────────────────
  GOVERNORATE_NOT_AVAILABLE: 'GOVERNORATE_NOT_AVAILABLE',
  CITY_NOT_AVAILABLE: 'CITY_NOT_AVAILABLE',
  CITY_GOVERNORATE_MISMATCH: 'CITY_GOVERNORATE_MISMATCH',
  ORDERING_NOT_AVAILABLE_IN_CITY: 'ORDERING_NOT_AVAILABLE_IN_CITY',
  RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY: 'RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY',
  GLOBAL_CHECKOUT_DISABLED: 'GLOBAL_CHECKOUT_DISABLED',

  // ── Restaurant (plan §76) ──────────────────────────────────────────────────
  RESTAURANT_NOT_APPROVED: 'RESTAURANT_NOT_APPROVED',
  RESTAURANT_SUSPENDED: 'RESTAURANT_SUSPENDED',
  RESTAURANT_CLOSED: 'RESTAURANT_CLOSED',
  RESTAURANT_PAUSED: 'RESTAURANT_PAUSED',
  BRANCH_NOT_AVAILABLE: 'BRANCH_NOT_AVAILABLE',
  RESTAURANT_NOT_READY: 'RESTAURANT_NOT_READY',
  RESTAURANT_APPLICATION_INVALID_STATE: 'RESTAURANT_APPLICATION_INVALID_STATE',

  // ── Catalog and order (plan §76) ───────────────────────────────────────────
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  ITEM_NOT_IN_RESTAURANT: 'ITEM_NOT_IN_RESTAURANT',
  PRICE_CHANGED: 'PRICE_CHANGED',
  MODIFIER_SELECTION_INVALID: 'MODIFIER_SELECTION_INVALID',
  ORDER_ALREADY_UPDATED: 'ORDER_ALREADY_UPDATED',
  ORDER_CANNOT_TRANSITION: 'ORDER_CANNOT_TRANSITION',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  ADDRESS_OUT_OF_SERVICE: 'ADDRESS_OUT_OF_SERVICE',
  MINIMUM_ORDER_NOT_MET: 'MINIMUM_ORDER_NOT_MET',
  CART_MULTI_RESTAURANT: 'CART_MULTI_RESTAURANT',
  CART_EMPTY: 'CART_EMPTY',
  COUPON_INVALID: 'COUPON_INVALID',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_USAGE_EXCEEDED: 'COUPON_USAGE_EXCEEDED',

  // ── Driver (plan §76) ──────────────────────────────────────────────────────
  DRIVER_NOT_AVAILABLE: 'DRIVER_NOT_AVAILABLE',
  DRIVER_NOT_IN_RESTAURANT: 'DRIVER_NOT_IN_RESTAURANT',
  DRIVER_SUSPENDED: 'DRIVER_SUSPENDED',
  DRIVER_AT_CAPACITY: 'DRIVER_AT_CAPACITY',
  DELIVERY_ALREADY_ASSIGNED: 'DELIVERY_ALREADY_ASSIGNED',
  DELIVERY_NOT_ASSIGNED_TO_DRIVER: 'DELIVERY_NOT_ASSIGNED_TO_DRIVER',
  DELIVERY_PIN_INVALID: 'DELIVERY_PIN_INVALID',
  DELIVERY_PIN_ATTEMPTS_EXCEEDED: 'DELIVERY_PIN_ATTEMPTS_EXCEEDED',
  DELIVERY_CANNOT_TRANSITION: 'DELIVERY_CANNOT_TRANSITION',

  // ── Inventory ──────────────────────────────────────────────────────────────
  STOCK_CONFLICT: 'STOCK_CONFLICT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVENTORY_ADJUSTMENT_REASON_REQUIRED: 'INVENTORY_ADJUSTMENT_REASON_REQUIRED',

  // ── Finance (plan §76) ─────────────────────────────────────────────────────
  SETTLEMENT_ALREADY_EXISTS: 'SETTLEMENT_ALREADY_EXISTS',
  SETTLEMENT_LOCKED: 'SETTLEMENT_LOCKED',
  SETTLEMENT_INVALID_STATE: 'SETTLEMENT_INVALID_STATE',
  PAYMENT_EXCEEDS_ALLOWED_BALANCE: 'PAYMENT_EXCEEDS_ALLOWED_BALANCE',
  FINANCIAL_RECONCILIATION_REQUIRED: 'FINANCIAL_RECONCILIATION_REQUIRED',
  COMMISSION_CONFIG_MISSING: 'COMMISSION_CONFIG_MISSING',

  // ── Authorization / tenancy (plan §63) ─────────────────────────────────────
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',

  // ── Uploads (plan §83) ─────────────────────────────────────────────────────
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_INVALID: 'FILE_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Arabic user-facing messages. Release 1 is Arabic-only (plan §2); these strings
 * live here rather than inside business logic so a second language is a data
 * change, not a refactor.
 */
export const ERROR_MESSAGES_AR: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'البيانات المدخلة غير صحيحة',
  UNAUTHENTICATED: 'الرجاء تسجيل الدخول للمتابعة',
  // Deliberately does not say which half was wrong (plan §78).
  INVALID_CREDENTIALS: 'رقم الهاتف أو كلمة المرور غير صحيحة',
  FORBIDDEN: 'لا تملك صلاحية لتنفيذ هذا الإجراء',
  NOT_FOUND: 'العنصر المطلوب غير موجود',
  CONFLICT: 'تعذّر إتمام العملية بسبب تعارض في البيانات',
  RATE_LIMITED: 'عدد المحاولات كبير، الرجاء المحاولة لاحقاً',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع، الرجاء المحاولة مرة أخرى',
  SERVICE_UNAVAILABLE: 'الخدمة غير متاحة حالياً، الرجاء المحاولة بعد قليل',
  APP_VERSION_UNSUPPORTED: 'الرجاء تحديث التطبيق للمتابعة',
  IDEMPOTENCY_KEY_REUSED: 'تم استخدام هذا الطلب مسبقاً ببيانات مختلفة',

  OTP_RATE_LIMITED: 'تجاوزت عدد محاولات إرسال رمز التحقق، حاول لاحقاً',
  OTP_INVALID: 'رمز التحقق غير صحيح',
  OTP_EXPIRED: 'انتهت صلاحية رمز التحقق، اطلب رمزاً جديداً',
  OTP_COOLDOWN_ACTIVE: 'الرجاء الانتظار قبل طلب رمز جديد',
  OTP_DELIVERY_FAILED: 'تعذّر إرسال رمز التحقق، الرجاء المحاولة مرة أخرى',
  OTP_MAX_ATTEMPTS: 'تجاوزت عدد المحاولات المسموحة، اطلب رمزاً جديداً',
  ACCOUNT_SUSPENDED: 'تم إيقاف هذا الحساب، الرجاء التواصل مع الدعم',
  SESSION_EXPIRED: 'انتهت الجلسة، الرجاء تسجيل الدخول مرة أخرى',
  PROFILE_INCOMPLETE: 'الرجاء إكمال معلومات حسابك للمتابعة',
  PROFILE_ALREADY_COMPLETED_CONFLICT: 'تم إكمال معلومات الحساب مسبقاً',
  MFA_REQUIRED: 'مطلوب التحقق بخطوتين للمتابعة',
  REAUTHENTICATION_REQUIRED: 'الرجاء تأكيد هويتك مرة أخرى للمتابعة',
  PASSWORD_CHANGE_REQUIRED: 'يجب تغيير كلمة المرور قبل المتابعة',

  GOVERNORATE_NOT_AVAILABLE: 'هذه المحافظة غير متاحة حالياً',
  CITY_NOT_AVAILABLE: 'هذه المدينة غير متاحة حالياً',
  CITY_GOVERNORATE_MISMATCH: 'المدينة المختارة لا تتبع المحافظة المحددة',
  ORDERING_NOT_AVAILABLE_IN_CITY: 'الطلب غير متاح حالياً في هذه المدينة',
  RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY: 'تسجيل المطاعم غير متاح حالياً في هذه المدينة',
  GLOBAL_CHECKOUT_DISABLED: 'الطلبات متوقفة مؤقتاً، الرجاء المحاولة لاحقاً',

  RESTAURANT_NOT_APPROVED: 'هذا المطعم غير معتمد بعد',
  RESTAURANT_SUSPENDED: 'هذا المطعم متوقف حالياً',
  RESTAURANT_CLOSED: 'المطعم مغلق الآن',
  RESTAURANT_PAUSED: 'المطعم متوقف مؤقتاً عن استقبال الطلبات',
  BRANCH_NOT_AVAILABLE: 'هذا الفرع غير متاح حالياً',
  RESTAURANT_NOT_READY: 'لم يكتمل إعداد المطعم بعد',
  RESTAURANT_APPLICATION_INVALID_STATE: 'حالة طلب الانضمام لا تسمح بهذا الإجراء',

  ITEM_UNAVAILABLE: 'هذا الصنف غير متوفر حالياً',
  ITEM_NOT_IN_RESTAURANT: 'هذا الصنف لا يتبع المطعم المحدد',
  PRICE_CHANGED: 'تم تحديث الأسعار، الرجاء مراجعة الطلب',
  MODIFIER_SELECTION_INVALID: 'اختيارات الإضافات غير صحيحة',
  ORDER_ALREADY_UPDATED: 'تم تحديث الطلب من مكان آخر، الرجاء تحديث الصفحة',
  ORDER_CANNOT_TRANSITION: 'لا يمكن تنفيذ هذا الإجراء على حالة الطلب الحالية',
  ORDER_NOT_CANCELLABLE: 'لا يمكن إلغاء الطلب في هذه المرحلة',
  ADDRESS_OUT_OF_SERVICE: 'هذا العنوان خارج نطاق التوصيل',
  MINIMUM_ORDER_NOT_MET: 'قيمة الطلب أقل من الحد الأدنى المطلوب',
  CART_MULTI_RESTAURANT: 'لا يمكن الطلب من أكثر من مطعم في سلة واحدة',
  CART_EMPTY: 'سلة المشتريات فارغة',
  COUPON_INVALID: 'رمز الخصم غير صالح',
  COUPON_EXPIRED: 'انتهت صلاحية رمز الخصم',
  COUPON_USAGE_EXCEEDED: 'تم استنفاد رمز الخصم',

  DRIVER_NOT_AVAILABLE: 'السائق غير متاح حالياً',
  DRIVER_NOT_IN_RESTAURANT: 'هذا السائق لا يتبع المطعم',
  DRIVER_SUSPENDED: 'تم إيقاف حساب السائق',
  DRIVER_AT_CAPACITY: 'السائق لديه طلب توصيل نشط بالفعل',
  DELIVERY_ALREADY_ASSIGNED: 'تم تعيين سائق لهذا الطلب مسبقاً',
  DELIVERY_NOT_ASSIGNED_TO_DRIVER: 'هذا الطلب غير معيّن لك',
  DELIVERY_PIN_INVALID: 'رمز التسليم غير صحيح',
  DELIVERY_PIN_ATTEMPTS_EXCEEDED: 'تجاوزت عدد محاولات إدخال رمز التسليم',
  DELIVERY_CANNOT_TRANSITION: 'لا يمكن تنفيذ هذا الإجراء على حالة التوصيل الحالية',

  STOCK_CONFLICT: 'تغيّرت كمية المخزون، الرجاء المراجعة',
  INSUFFICIENT_STOCK: 'الكمية المتوفرة في المخزون غير كافية',
  INVENTORY_ADJUSTMENT_REASON_REQUIRED: 'الرجاء كتابة سبب التعديل',

  SETTLEMENT_ALREADY_EXISTS: 'توجد تسوية لهذه الفترة بالفعل',
  SETTLEMENT_LOCKED: 'التسوية مقفلة ولا يمكن تعديلها',
  SETTLEMENT_INVALID_STATE: 'حالة التسوية لا تسمح بهذا الإجراء',
  PAYMENT_EXCEEDS_ALLOWED_BALANCE: 'المبلغ المدفوع يتجاوز المبلغ المستحق',
  FINANCIAL_RECONCILIATION_REQUIRED: 'يوجد اختلاف مالي يتطلب المراجعة',
  COMMISSION_CONFIG_MISSING: 'لم يتم ضبط نسبة العمولة لهذا المطعم',

  PERMISSION_REVOKED: 'تم تغيير صلاحياتك، الرجاء تحديث الجلسة',
  TENANT_MISMATCH: 'لا يمكن الوصول إلى بيانات مطعم آخر',

  FILE_TOO_LARGE: 'حجم الملف كبير جداً',
  FILE_TYPE_NOT_ALLOWED: 'نوع الملف غير مدعوم',
  FILE_INVALID: 'الملف غير صالح',
};

/** HTTP status for each code. Keeps status selection out of route handlers. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  APP_VERSION_UNSUPPORTED: 426,
  IDEMPOTENCY_KEY_REUSED: 409,

  OTP_RATE_LIMITED: 429,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_COOLDOWN_ACTIVE: 429,
  OTP_DELIVERY_FAILED: 502,
  OTP_MAX_ATTEMPTS: 429,
  ACCOUNT_SUSPENDED: 403,
  SESSION_EXPIRED: 401,
  PROFILE_INCOMPLETE: 403,
  PROFILE_ALREADY_COMPLETED_CONFLICT: 409,
  MFA_REQUIRED: 401,
  REAUTHENTICATION_REQUIRED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,

  GOVERNORATE_NOT_AVAILABLE: 409,
  CITY_NOT_AVAILABLE: 409,
  CITY_GOVERNORATE_MISMATCH: 422,
  ORDERING_NOT_AVAILABLE_IN_CITY: 409,
  RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY: 409,
  GLOBAL_CHECKOUT_DISABLED: 503,

  RESTAURANT_NOT_APPROVED: 409,
  RESTAURANT_SUSPENDED: 409,
  RESTAURANT_CLOSED: 409,
  RESTAURANT_PAUSED: 409,
  BRANCH_NOT_AVAILABLE: 409,
  RESTAURANT_NOT_READY: 409,
  RESTAURANT_APPLICATION_INVALID_STATE: 409,

  ITEM_UNAVAILABLE: 409,
  ITEM_NOT_IN_RESTAURANT: 422,
  PRICE_CHANGED: 409,
  MODIFIER_SELECTION_INVALID: 422,
  ORDER_ALREADY_UPDATED: 409,
  ORDER_CANNOT_TRANSITION: 409,
  ORDER_NOT_CANCELLABLE: 409,
  ADDRESS_OUT_OF_SERVICE: 409,
  MINIMUM_ORDER_NOT_MET: 409,
  CART_MULTI_RESTAURANT: 409,
  CART_EMPTY: 422,
  COUPON_INVALID: 422,
  COUPON_EXPIRED: 409,
  COUPON_USAGE_EXCEEDED: 409,

  DRIVER_NOT_AVAILABLE: 409,
  DRIVER_NOT_IN_RESTAURANT: 403,
  DRIVER_SUSPENDED: 403,
  DRIVER_AT_CAPACITY: 409,
  DELIVERY_ALREADY_ASSIGNED: 409,
  DELIVERY_NOT_ASSIGNED_TO_DRIVER: 403,
  DELIVERY_PIN_INVALID: 400,
  DELIVERY_PIN_ATTEMPTS_EXCEEDED: 429,
  DELIVERY_CANNOT_TRANSITION: 409,

  STOCK_CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  INVENTORY_ADJUSTMENT_REASON_REQUIRED: 422,

  SETTLEMENT_ALREADY_EXISTS: 409,
  SETTLEMENT_LOCKED: 409,
  SETTLEMENT_INVALID_STATE: 409,
  PAYMENT_EXCEEDS_ALLOWED_BALANCE: 422,
  FINANCIAL_RECONCILIATION_REQUIRED: 409,
  COMMISSION_CONFIG_MISSING: 409,

  PERMISSION_REVOKED: 403,
  TENANT_MISMATCH: 403,

  FILE_TOO_LARGE: 413,
  FILE_TYPE_NOT_ALLOWED: 415,
  FILE_INVALID: 422,
};

export interface ErrorDetails {
  readonly [key: string]: unknown;
}

/**
 * The single error type domain and API code throws. Carrying the code (not an
 * HTTP status or a raw string) keeps the taxonomy authoritative.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details: ErrorDetails;
  /** Arabic text shown to the user. */
  public readonly messageAr: string;
  /** True for expected business outcomes — these are not paged on (plan §91). */
  public readonly expected: boolean;

  constructor(
    code: ErrorCode,
    options: { details?: ErrorDetails; messageAr?: string; cause?: unknown } = {},
  ) {
    super(`${code}: ${ERROR_MESSAGES_AR[code]}`);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = options.details ?? {};
    this.messageAr = options.messageAr ?? ERROR_MESSAGES_AR[code];
    this.expected = this.httpStatus < 500;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  static is(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  /** Narrow to a specific code without instanceof gymnastics at call sites. */
  static hasCode(error: unknown, code: ErrorCode): error is AppError {
    return AppError.is(error) && error.code === code;
  }
}

/** Convenience constructors for the codes thrown most often. */
export const errors = {
  validation: (details?: ErrorDetails) => new AppError(ERROR_CODES.VALIDATION_FAILED, { details }),
  unauthenticated: () => new AppError(ERROR_CODES.UNAUTHENTICATED),
  forbidden: (details?: ErrorDetails) => new AppError(ERROR_CODES.FORBIDDEN, { details }),
  notFound: (entity?: string) =>
    new AppError(ERROR_CODES.NOT_FOUND, entity ? { details: { entity } } : {}),
  conflict: (details?: ErrorDetails) => new AppError(ERROR_CODES.CONFLICT, { details }),
  internal: (cause?: unknown) => new AppError(ERROR_CODES.INTERNAL_ERROR, { cause }),
};
