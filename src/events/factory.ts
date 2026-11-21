import { v4 as uuidv4 } from 'uuid';
import { IngestedEventPayload } from './models/event';

export class EventFactory {
  static createEvent(eventType: string, overrides: Partial<IngestedEventPayload> = {}): IngestedEventPayload {
    const userId = overrides.userId || `USR-${Math.floor(100000 + Math.random() * 900000)}`;
    const eventId = overrides.eventId || uuidv4();
    const timestamp = overrides.timestamp || new Date().toISOString();
    const correlationId = overrides.correlationId || uuidv4();

    let sourceSystem: IngestedEventPayload['sourceSystem'] = 'TRADING_ENGINE';
    let payload: Record<string, unknown> = {};

    switch (eventType) {
      // Transactions
      case 'TXNX-001':
        sourceSystem = 'TRADING_ENGINE';
        payload = {
          order_id: `ORD-${Math.floor(Math.random() * 1000000)}`,
          symbol: 'RELIANCE',
          quantity: 50,
          price: 2950.5,
          total_amount: 147525.0,
          execution_time: timestamp,
          exchange: 'NSE',
        };
        break;
      case 'TXNX-002':
        sourceSystem = 'TRADING_ENGINE';
        payload = {
          order_id: `ORD-${Math.floor(Math.random() * 1000000)}`,
          symbol: 'TCS',
          quantity: 20,
          price: 4120.0,
          total_amount: 82400.0,
          execution_time: timestamp,
          exchange: 'NSE',
        };
        break;
      case 'TXNX-003':
        sourceSystem = 'TRADING_ENGINE';
        payload = {
          order_id: `ORD-${Math.floor(Math.random() * 1000000)}`,
          symbol: 'INFY',
          rejection_reason: 'RMS: Insufficient margin in trading account',
          rejection_code: 'RMS_MARGIN_SHORTFALL',
        };
        break;
      case 'TXNX-004':
        sourceSystem = 'TRADING_ENGINE';
        payload = {
          symbol: 'HDFCBANK',
          amount: 4500.0,
          shares_count: 250,
          payout_date: timestamp,
        };
        break;
      case 'TXNX-005':
        sourceSystem = 'TRADING_ENGINE';
        payload = {
          transaction_id: `TXN-DEP-${Math.floor(Math.random() * 900000)}`,
          amount: 50000.0,
          balance_after: 125430.0,
          payment_mode: 'UPI',
        };
        break;

      // Risk & Margin
      case 'RISK-001':
        sourceSystem = 'RMS';
        payload = {
          account_id: `ACC-${userId}`,
          required_margin: 250000.0,
          available_margin: 180000.0,
          shortfall: 70000.0,
          deadline_time: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        };
        break;
      case 'RISK-002':
        sourceSystem = 'RMS';
        payload = {
          account_id: `ACC-${userId}`,
          shortfall_amount: 95000.0,
          penalty_risk_amount: 950.0,
          deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        };
        break;
      case 'RISK-003':
        sourceSystem = 'RMS';
        payload = {
          positions: [{ symbol: 'NIFTY26NOV24000CE', qty: 100, squaredPrice: 12.5 }],
          liquidation_value: 1250.0,
          loss_incurred: 45000.0,
          reason: 'RMS_AUTO_SQUAREOFF',
        };
        break;
      case 'RISK-004':
        sourceSystem = 'RMS';
        payload = {
          var_95: 18.4,
          beta: 1.45,
          recommendation: 'Portfolio Beta is elevated (>1.3). Consider hedging with index puts.',
        };
        break;
      case 'RISK-005':
        sourceSystem = 'RMS';
        payload = {
          symbol: 'TATASTEEL',
          sector: 'Metals',
          concentration_percent: 34.2,
          threshold_percent: 25.0,
        };
        break;

      // SIP & Investment
      case 'SIPX-001':
        sourceSystem = 'SIP_ENGINE';
        payload = {
          fund_name: 'Parag Parikh Flexi Cap Fund - Direct Growth',
          amount: 10000.0,
          due_date: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
          mandate_bank: 'HDFC Bank (Acct ...4921)',
        };
        break;
      case 'SIPX-002':
        sourceSystem = 'SIP_ENGINE';
        payload = {
          fund_name: 'Mirae Asset Large Cap Fund',
          amount: 5000.0,
          nav: 108.45,
          units_allotted: 46.104,
        };
        break;
      case 'SIPX-003':
        sourceSystem = 'SIP_ENGINE';
        payload = {
          fund_name: 'SBI Small Cap Fund',
          amount: 7500.0,
          failure_reason: 'INSUFFICIENT_FUNDS',
          retry_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        };
        break;
      case 'SIPX-004':
        sourceSystem = 'SIP_ENGINE';
        payload = {
          fund_name: 'Parag Parikh Flexi Cap Fund',
          current_amount: 10000.0,
          suggested_amount: 11000.0,
        };
        break;
      case 'SIPX-005':
        sourceSystem = 'SIP_ENGINE';
        payload = {
          goal_name: 'Retirement Corpus 2040',
          target_amount: 20000000.0,
          achieved_amount: 5000000.0,
          percentage_achieved: 25.0,
        };
        break;

      // Market
      case 'MKTX-001':
        sourceSystem = 'MARKET_FEED';
        payload = {
          symbol: 'TATAMOTORS',
          target_price: 1000.0,
          current_price: 1002.5,
          change_percentage: 3.4,
        };
        break;
      case 'MKTX-002':
        sourceSystem = 'MARKET_FEED';
        payload = {
          symbol: 'ZOMATO',
          circuit_type: 'UPPER',
          band_percentage: 10.0,
          halt_duration_minutes: 45,
        };
        break;
      case 'MKTX-003':
        sourceSystem = 'MARKET_FEED';
        payload = {
          session: 'MARKET_OPEN',
          indices: { NIFTY50: 24350.2, SENSEX: 80120.45 },
        };
        break;
      case 'MKTX-004':
        sourceSystem = 'MARKET_FEED';
        payload = {
          symbol: 'BHARTIARTL',
          milestone: '52_WEEK_HIGH',
          price: 1640.0,
        };
        break;
      case 'MKTX-005':
        sourceSystem = 'MARKET_FEED';
        payload = {
          symbol: 'ICICIBANK',
          q_period: 'Q3 FY26',
          revenue_growth: 18.2,
          pat_growth: 22.4,
        };
        break;

      // Regulatory
      case 'REGX-001':
        sourceSystem = 'COMPLIANCE';
        payload = {
          kyc_expiry_date: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
          rekyc_portal_url: 'https://kyc.brokerage.in/re-verify',
          days_remaining: 15,
        };
        break;
      case 'REGX-002':
        sourceSystem = 'COMPLIANCE';
        payload = {
          deadline_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          opt_out_available: true,
        };
        break;
      case 'REGX-003':
        sourceSystem = 'COMPLIANCE';
        payload = {
          trade_date: timestamp,
          contract_note_number: `CN-${Math.floor(1000000 + Math.random() * 9000000)}`,
          download_url: 'https://reports.brokerage.in/cn/download',
          net_payable_receivable: 147525.0,
        };
        break;
      case 'REGX-004':
        sourceSystem = 'COMPLIANCE';
        payload = {
          financial_year: 'FY 2025-26',
          statement_type: 'CAPITAL_GAINS',
          download_url: 'https://tax.brokerage.in/reports/download',
        };
        break;
      case 'REGX-005':
        sourceSystem = 'COMPLIANCE';
        payload = {
          circular_number: 'RBI/2026-27/09',
          issuing_authority: 'RBI',
          title: 'Revised Prudential Norms for Retail Lending and Exposure Limits',
          effective_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          summary: 'Emergency policy update revising systemic risk reserve and lending collateral rules.',
        };
        break;

      default:
        sourceSystem = 'TRADING_ENGINE';
        payload = { note: 'Generic test event', rawType: eventType };
    }

    const idempotencyKey =
      overrides.idempotencyKey || `${eventType}:${userId}:${Math.floor(Date.now() / 60000)}`;

    return {
      eventId,
      eventType,
      userId,
      timestamp,
      sourceSystem,
      idempotencyKey,
      correlationId,
      payload: { ...payload, ...(overrides.payload || {}) },
      metadata: overrides.metadata || { generatedBy: 'EventFactory' },
      ...overrides,
    };
  }
}
