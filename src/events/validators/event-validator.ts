import { z } from 'zod';

export const BaseIngestEventSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    eventType: z.string().min(3),
    userId: z.string().min(1),
    timestamp: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
    sourceSystem: z.enum(['TRADING_ENGINE', 'RMS', 'SIP_ENGINE', 'MARKET_FEED', 'COMPLIANCE']),
    idempotencyKey: z.string().optional(),
    correlationId: z.string().uuid().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

// A. Transaction Events (TXNX-001..005)
export const BuySellOrderPayloadSchema = z
  .object({
    order_id: z.string().min(1),
    symbol: z.string().min(1),
    quantity: z.number().positive(),
    price: z.number().positive(),
    total_amount: z.number().positive(),
    execution_time: z.string().min(1),
    exchange: z.enum(['NSE', 'BSE', 'MCX']),
  })
  .strict();

export const OrderRejectedPayloadSchema = z
  .object({
    order_id: z.string().min(1),
    symbol: z.string().min(1),
    rejection_reason: z.string().min(1),
    rejection_code: z.string().min(1),
  })
  .strict();

export const DividendCreditedPayloadSchema = z
  .object({
    symbol: z.string().min(1),
    amount: z.number().positive(),
    shares_count: z.number().positive(),
    payout_date: z.string().min(1),
  })
  .strict();

export const FundsDepositedPayloadSchema = z
  .object({
    transaction_id: z.string().min(1),
    amount: z.number().positive(),
    balance_after: z.number().nonnegative(),
    payment_mode: z.enum(['UPI', 'NETBANKING', 'NEFT', 'RTGS']),
  })
  .strict();

// B. Risk & Margin Events (RISK-001..005)
export const MarginCallPayloadSchema = z
  .object({
    account_id: z.string().min(1),
    required_margin: z.number().positive(),
    available_margin: z.number(),
    shortfall: z.number().positive(),
    deadline_time: z.string().min(1),
  })
  .strict();

export const MarginShortfallPayloadSchema = z
  .object({
    account_id: z.string().min(1),
    shortfall_amount: z.number().positive(),
    penalty_risk_amount: z.number().nonnegative(),
    deadline: z.string().min(1),
  })
  .strict();

export const PositionSquaredOffPayloadSchema = z
  .object({
    positions: z.array(z.record(z.string(), z.unknown())).min(1),
    liquidation_value: z.number(),
    loss_incurred: z.number(),
    reason: z.string().min(1),
  })
  .strict();

export const PortfolioRiskAlertPayloadSchema = z
  .object({
    var_95: z.number().nonnegative(),
    beta: z.number(),
    recommendation: z.string().min(1),
  })
  .strict();

export const ConcentrationAlertPayloadSchema = z
  .object({
    symbol: z.string().min(1),
    sector: z.string().min(1),
    concentration_percent: z.number().positive().max(100),
    threshold_percent: z.number().positive().max(100),
  })
  .strict();

// C. SIP & Investment Events (SIPX-001..005)
export const SipDueReminderPayloadSchema = z
  .object({
    fund_name: z.string().min(1),
    amount: z.number().positive(),
    due_date: z.string().min(1),
    mandate_bank: z.string().min(1),
  })
  .strict();

export const SipExecutedPayloadSchema = z
  .object({
    fund_name: z.string().min(1),
    amount: z.number().positive(),
    nav: z.number().positive(),
    units_allotted: z.number().positive(),
  })
  .strict();

export const SipFailedPayloadSchema = z
  .object({
    fund_name: z.string().min(1),
    amount: z.number().positive(),
    failure_reason: z.string().min(1),
    retry_date: z.string().min(1),
  })
  .strict();

export const SipStepUpPayloadSchema = z
  .object({
    fund_name: z.string().min(1),
    current_amount: z.number().positive(),
    suggested_amount: z.number().positive(),
  })
  .strict();

export const GoalMilestonePayloadSchema = z
  .object({
    goal_name: z.string().min(1),
    target_amount: z.number().positive(),
    achieved_amount: z.number().nonnegative(),
    percentage_achieved: z.number().min(0).max(1000),
  })
  .strict();

// D. Market & Price Events (MKTX-001..005)
export const PriceAlertPayloadSchema = z
  .object({
    symbol: z.string().min(1),
    target_price: z.number().positive(),
    current_price: z.number().positive(),
    change_percentage: z.number(),
  })
  .strict();

export const CircuitBreakerHitPayloadSchema = z
  .object({
    symbol: z.string().min(1),
    circuit_type: z.enum(['UPPER', 'LOWER']),
    band_percentage: z.number().positive(),
    halt_duration_minutes: z.number().positive(),
  })
  .strict();

export const MarketOpenClosePayloadSchema = z
  .object({
    session: z.enum(['PRE_OPEN', 'MARKET_OPEN', 'MARKET_CLOSE']),
    indices: z.object({
      NIFTY50: z.number().positive(),
      SENSEX: z.number().positive(),
    }),
  })
  .strict();

export const Week52MilestonePayloadSchema = z
  .object({
    symbol: z.string().min(1),
    milestone: z.enum(['52_WEEK_HIGH', '52_WEEK_LOW']),
    price: z.number().positive(),
  })
  .strict();

export const EarningsAnnouncementPayloadSchema = z
  .object({
    symbol: z.string().min(1),
    q_period: z.string().min(1),
    revenue_growth: z.number(),
    pat_growth: z.number(),
  })
  .strict();

// E. Regulatory & Compliance Events (REGX-001..005)
const safeHttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must use http or https scheme' });

export const KycExpiryPayloadSchema = z
  .object({
    kyc_expiry_date: z.string().min(1),
    rekyc_portal_url: safeHttpUrl,
    days_remaining: z.number().nonnegative(),
  })
  .strict();

export const NomineeUpdatePayloadSchema = z
  .object({
    deadline_date: z.string().min(1),
    opt_out_available: z.boolean(),
  })
  .strict();

export const ContractNotePayloadSchema = z
  .object({
    trade_date: z.string().min(1),
    contract_note_number: z.string().min(1),
    download_url: safeHttpUrl,
    net_payable_receivable: z.number(),
  })
  .strict();

export const TaxStatementPayloadSchema = z
  .object({
    financial_year: z.string().min(1),
    statement_type: z.enum(['CAPITAL_GAINS', 'PNL']),
    download_url: safeHttpUrl,
  })
  .strict();

export const RegulatoryPolicyPayloadSchema = z
  .object({
    circular_number: z.string().min(1),
    issuing_authority: z.enum(['SEBI', 'RBI', 'NSE', 'BSE']),
    title: z.string().min(1),
    effective_date: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

export const EVENT_PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'TXNX-001': BuySellOrderPayloadSchema,
  'TXNX-002': BuySellOrderPayloadSchema,
  'TXNX-003': OrderRejectedPayloadSchema,
  'TXNX-004': DividendCreditedPayloadSchema,
  'TXNX-005': FundsDepositedPayloadSchema,
  'RISK-001': MarginCallPayloadSchema,
  'RISK-002': MarginShortfallPayloadSchema,
  'RISK-003': PositionSquaredOffPayloadSchema,
  'RISK-004': PortfolioRiskAlertPayloadSchema,
  'RISK-005': ConcentrationAlertPayloadSchema,
  'SIPX-001': SipDueReminderPayloadSchema,
  'SIPX-002': SipExecutedPayloadSchema,
  'SIPX-003': SipFailedPayloadSchema,
  'SIPX-004': SipStepUpPayloadSchema,
  'SIPX-005': GoalMilestonePayloadSchema,
  'MKTX-001': PriceAlertPayloadSchema,
  'MKTX-002': CircuitBreakerHitPayloadSchema,
  'MKTX-003': MarketOpenClosePayloadSchema,
  'MKTX-004': Week52MilestonePayloadSchema,
  'MKTX-005': EarningsAnnouncementPayloadSchema,
  'REGX-001': KycExpiryPayloadSchema,
  'REGX-002': NomineeUpdatePayloadSchema,
  'REGX-003': ContractNotePayloadSchema,
  'REGX-004': TaxStatementPayloadSchema,
  'REGX-005': RegulatoryPolicyPayloadSchema,
};

export function validateEventPayload(
  eventType: string,
  payload: unknown
): { success: boolean; data?: any; error?: string } {
  try {
    const schema = EVENT_PAYLOAD_SCHEMAS[eventType];
    if (!schema) {
      return { success: false, error: `Unsupported eventType: ${eventType}` };
    }
    return { success: true, data: schema.parse(payload) };
  } catch (err: any) {
    return { success: false, error: err.errors ? JSON.stringify(err.errors) : err.message };
  }
}

export function validateBaseIngestEvent(input: unknown): { success: boolean; data?: any; error?: string } {
  try {
    return { success: true, data: BaseIngestEventSchema.parse(input) };
  } catch (err: any) {
    return { success: false, error: err.errors ? JSON.stringify(err.errors) : err.message };
  }
}
