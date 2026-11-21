import { SupportedLanguage, Channel } from '../../events/models/event';

export interface ChannelTemplate {
  version?: string;
  subject?: string;
  body: string;
  variantB?: {
    subject?: string;
    body: string;
  };
}

export type EventLanguageTemplates = Partial<
  Record<SupportedLanguage, Partial<Record<Channel, ChannelTemplate>>>
>;

export const TEMPLATES_CATALOG: Record<string, EventLanguageTemplates> = {
  // ==========================================
  // A. TRANSACTION EVENTS (TXNX-001..005)
  // ==========================================
  'TXNX-001': {
    en: {
      SMS: {
        version: '1.1',
        body: 'Executed: Buy {{quantity}} {{symbol}} @ ₹{{price}} on {{exchange}}. Total: {{formatCurrency total_amount}}. View order: https://app.brokerage.in/o/{{order_id}}',
        variantB: {
          body: 'Trade Confirmed: {{quantity}} shares of {{symbol}} bought at ₹{{price}} ({{exchange}}). Value {{formatCurrency total_amount}}. Details: https://app.brokerage.in/o/{{order_id}}',
        },
      },
      EMAIL: {
        version: '1.1',
        subject: 'Trade Confirmation: Buy {{quantity}} {{symbol}} Executed',
        body: '<p>Dear {{user.fullName}},</p><p>Your buy order for <strong>{{quantity}} shares of {{symbol}}</strong> has been executed at ₹{{price}} per share on {{exchange}}.</p><p>Total Value: {{formatCurrency total_amount}}<br>Order ID: {{order_id}}<br>Execution Time: {{formatDateTime execution_time user.timezone}}</p>',
      },
      PUSH: {
        version: '1.0',
        subject: 'Order Executed: {{symbol}}',
        body: 'Bought {{quantity}} {{symbol}} at ₹{{price}}. Total: {{formatCurrency total_amount}}.',
      },
      WHATSAPP: {
        version: '1.0',
        body: '✅ *Buy Order Executed*\n\nHi {{user.fullName}},\nYour order to buy *{{quantity}}* shares of *{{symbol}}* was executed at *₹{{price}}*.\nTotal: *{{formatCurrency total_amount}}*\nTime: {{formatDateTime execution_time user.timezone}}',
      },
      IN_APP: {
        version: '1.0',
        subject: 'Order Executed',
        body: 'Bought {{quantity}} shares of {{symbol}} @ ₹{{price}} (Total {{formatCurrency total_amount}})',
      },
    },
    hi: {
      SMS: {
        body: 'निष्पादित: {{exchange}} पर {{symbol}} के {{quantity}} शेयर @ ₹{{price}} खरीदे गए। कुल: {{formatCurrency total_amount}}। विवरण: https://app.brokerage.in/o/{{order_id}}',
      },
      EMAIL: {
        subject: 'सौदा पुष्टि: {{symbol}} की खरीद सफल',
        body: '<p>नमस्ते {{user.fullName}},</p><p>आपके <strong>{{symbol}}</strong> के {{quantity}} शेयर ₹{{price}} प्रति शेयर पर सफलतापूर्वक खरीदे गए हैं। कुल राशि: {{formatCurrency total_amount}}</p>',
      },
      PUSH: {
        subject: 'ऑर्डर निष्पादित: {{symbol}}',
        body: '{{symbol}} के {{quantity}} शेयर ₹{{price}} पर खरीदे गए।',
      },
      WHATSAPP: {
        body: '✅ *खरीद ऑर्डर निष्पादित*\n\nनमस्ते {{user.fullName}},\n{{symbol}} के {{quantity}} शेयर ₹{{price}} पर खरीदे गए। कुल: {{formatCurrency total_amount}}',
      },
      IN_APP: { subject: 'ऑर्डर निष्पादित', body: '{{symbol}} के {{quantity}} शेयर ₹{{price}} में खरीदे गए' },
    },
    mr: {
      SMS: {
        body: 'खरेदी पूर्ण: {{exchange}} वर {{symbol}} चे {{quantity}} शेअर्स @ ₹{{price}}. एकूण: {{formatCurrency total_amount}}.',
      },
      PUSH: { subject: 'ऑर्डर पूर्ण: {{symbol}}', body: '{{symbol}} चे {{quantity}} शेअर्स @ ₹{{price}} खरेदी केले.' },
    },
    ta: {
      SMS: {
        body: 'நிறைவேற்றப்பட்டது: {{symbol}} இன் {{quantity}} பங்குகள் @ ₹{{price}} வாங்கப்பட்டது. மொத்தம்: {{formatCurrency total_amount}}.',
      },
      PUSH: {
        subject: 'ஆர்டர் நிறைவேறியது: {{symbol}}',
        body: '{{symbol}} பங்குகள் ₹{{price}} விலையில் வாங்கப்பட்டது.',
      },
    },
    te: {
      SMS: {
        body: 'పూర్తయింది: {{symbol}} యొక్క {{quantity}} షేర్లు @ ₹{{price}} వద్ద కొనుగోలు చేయబడ్డాయి. మొత్తం: {{formatCurrency total_amount}}.',
      },
      PUSH: {
        subject: 'ఆర్డర్ పూర్తయింది: {{symbol}}',
        body: '{{symbol}} యొక్క {{quantity}} షేర్లు ₹{{price}} వద్ద కొనుగోలు చేయబడ్డాయి.',
      },
    },
  },

  'TXNX-002': {
    en: {
      SMS: {
        body: 'Executed: Sell {{quantity}} {{symbol}} @ ₹{{price}} on {{exchange}}. Proceeds: {{formatCurrency total_amount}}. Order: https://app.brokerage.in/o/{{order_id}}',
      },
      EMAIL: {
        subject: 'Trade Confirmation: Sell {{quantity}} {{symbol}} Executed',
        body: '<p>Dear {{user.fullName}},</p><p>Your sell order for <strong>{{quantity}} shares of {{symbol}}</strong> executed at ₹{{price}} on {{exchange}}. Net Proceeds: {{formatCurrency total_amount}}.</p>',
      },
      PUSH: {
        subject: 'Sell Executed: {{symbol}}',
        body: 'Sold {{quantity}} {{symbol}} @ ₹{{price}}. Total: {{formatCurrency total_amount}}.',
      },
      WHATSAPP: {
        body: '💹 *Sell Order Executed*\n\n{{quantity}} shares of *{{symbol}}* sold @ ₹{{price}}.\nTotal: *{{formatCurrency total_amount}}*',
      },
      IN_APP: {
        subject: 'Sell Order Executed',
        body: 'Sold {{quantity}} shares of {{symbol}} @ ₹{{price}} ({{formatCurrency total_amount}})',
      },
    },
    hi: {
      SMS: {
        body: 'बिक्री पूर्ण: {{exchange}} पर {{symbol}} के {{quantity}} शेयर @ ₹{{price}} बेचे गए। कुल: {{formatCurrency total_amount}}।',
      },
      PUSH: {
        subject: 'बिक्री निष्पादित: {{symbol}}',
        body: '{{symbol}} के {{quantity}} शेयर ₹{{price}} पर बेचे गए।',
      },
    },
  },

  'TXNX-003': {
    en: {
      SMS: {
        body: 'Order Rejected: {{symbol}} ({{order_id}}). Reason: {{rejection_reason}} [{{rejection_code}}].',
      },
      EMAIL: {
        subject: 'Order Rejected: {{symbol}} ({{order_id}})',
        body: '<p>Dear {{user.fullName}},</p><p>Your order <strong>{{order_id}}</strong> for {{symbol}} was rejected. Reason: {{rejection_reason}} (Code: {{rejection_code}}).</p>',
      },
      PUSH: { subject: 'Order Rejected: {{symbol}}', body: '{{rejection_reason}} ({{rejection_code}})' },
      IN_APP: {
        subject: 'Order Rejected',
        body: 'Order {{order_id}} for {{symbol}} rejected: {{rejection_reason}}',
      },
    },
    hi: {
      PUSH: { subject: 'ऑर्डर अस्वीकृत: {{symbol}}', body: 'कारण: {{rejection_reason}}' },
      IN_APP: { subject: 'ऑर्डर अस्वीकृत', body: '{{symbol}} ऑर्डर अस्वीकृत: {{rejection_reason}}' },
    },
  },

  'TXNX-004': {
    en: {
      EMAIL: {
        subject: 'Dividend Credited: {{symbol}} ({{formatCurrency amount}})',
        body: '<p>Dear {{user.fullName}},</p><p>A dividend of <strong>{{formatCurrency amount}}</strong> for {{shares_count}} shares of {{symbol}} was credited on {{formatDateTime payout_date user.timezone}}.</p>',
      },
      PUSH: {
        subject: 'Dividend Credited: {{symbol}}',
        body: 'Received {{formatCurrency amount}} dividend for {{shares_count}} shares of {{symbol}}.',
      },
      WHATSAPP: {
        body: '💰 *Dividend Credited*\n\n{{symbol}}: *{{formatCurrency amount}}* for {{shares_count}} shares.',
      },
      IN_APP: {
        subject: 'Dividend Credited',
        body: '{{formatCurrency amount}} credited from {{symbol}} ({{shares_count}} shares)',
      },
    },
    hi: {
      IN_APP: { subject: 'लाभांश जमा', body: '{{symbol}} से {{formatCurrency amount}} लाभांश प्राप्त हुआ।' },
    },
  },

  'TXNX-005': {
    en: {
      SMS: {
        body: 'Funds Added: {{formatCurrency amount}} via {{payment_mode}} (Txn: {{transaction_id}}). Updated Balance: {{formatCurrency balance_after}}.',
      },
      EMAIL: {
        subject: 'Funds Deposit Confirmed: {{formatCurrency amount}}',
        body: '<p>Dear {{user.fullName}},</p><p>{{formatCurrency amount}} deposited via {{payment_mode}} (Ref: {{transaction_id}}). Available Balance: <strong>{{formatCurrency balance_after}}</strong>.</p>',
      },
      PUSH: {
        subject: 'Funds Added: {{formatCurrency amount}}',
        body: 'New trading balance: {{formatCurrency balance_after}} ({{payment_mode}}).',
      },
      IN_APP: {
        subject: 'Funds Deposited',
        body: '{{formatCurrency amount}} credited via {{payment_mode}}. Balance: {{formatCurrency balance_after}}',
      },
    },
    hi: {
      SMS: {
        body: 'फंड जमा: {{payment_mode}} द्वारा {{formatCurrency amount}} जमा हुए। नया बैलेंस: {{formatCurrency balance_after}}।',
      },
    },
  },

  // ==========================================
  // B. RISK & MARGIN EVENTS (RISK-001..005)
  // ==========================================
  'RISK-001': {
    en: {
      SMS: {
        version: '1.2',
        body: 'URGENT MARGIN CALL: Account {{account_id}} has a margin shortfall of {{formatCurrency shortfall}}. Add funds before {{formatDateTime deadline_time user.timezone}} to avoid square-off: https://app.brokerage.in/funds/add',
        variantB: {
          body: 'IMMEDIATE ACTION REQUIRED: {{account_id}} margin shortfall {{formatCurrency shortfall}}. Deposit before {{formatDateTime deadline_time user.timezone}} to stop liquidation: https://app.brokerage.in/funds/add',
        },
      },
      EMAIL: {
        subject: 'CRITICAL: Margin Call Notice - Immediate Action Required',
        body: '<h2 style="color:#7A353B;">URGENT: Margin Shortfall Warning</h2><p>Dear {{user.fullName}},</p><p>Your account <strong>{{account_id}}</strong> has breached the maintenance margin threshold.</p><ul><li>Required Margin: {{formatCurrency required_margin}}</li><li>Available Margin: {{formatCurrency available_margin}}</li><li><strong>Shortfall: {{formatCurrency shortfall}}</strong></li><li><strong>Deadline: {{formatDateTime deadline_time user.timezone}}</strong></li></ul>',
      },
      PUSH: {
        subject: '🚨 CRITICAL MARGIN CALL',
        body: 'Margin shortfall of {{formatCurrency shortfall}} detected. Deposit funds by {{formatDateTime deadline_time user.timezone}}.',
      },
      WHATSAPP: {
        body: '🚨 *URGENT MARGIN CALL NOTICE*\n\nAccount {{account_id}} shortfall: *{{formatCurrency shortfall}}*.\nDeadline: {{formatDateTime deadline_time user.timezone}}',
      },
      IN_APP: {
        subject: 'CRITICAL: Margin Call Warning',
        body: 'Margin shortfall: {{formatCurrency shortfall}}. Action required before {{formatDateTime deadline_time user.timezone}}.',
      },
    },
    hi: {
      SMS: {
        body: 'अति आवश्यक मार्जिन कॉल: खाता {{account_id}} में {{formatCurrency shortfall}} की कमी है। स्क्वेयर-ऑफ से बचने हेतु {{formatDateTime deadline_time user.timezone}} से पहले फंड जोड़ें: https://app.brokerage.in/funds/add',
      },
      EMAIL: {
        subject: 'अति आवश्यक: मार्जिन कॉल नोटिस',
        body: '<p>नमस्ते {{user.fullName}}, खाते {{account_id}} में {{formatCurrency shortfall}} की मार्जिन कमी है। तुरंत फंड जमा करें।</p>',
      },
      PUSH: {
        subject: '🚨 मार्जिन कॉल चेतावनी',
        body: '{{formatCurrency shortfall}} की मार्जिन कमी। तुरंत फंड जोड़ें।',
      },
      WHATSAPP: { body: '🚨 *मार्जिन कॉल नोटिस*\n\nखाता {{account_id}} कमी: *{{formatCurrency shortfall}}*।' },
      IN_APP: { subject: 'अति आवश्यक मार्जिन कॉल', body: 'खाते में {{formatCurrency shortfall}} की कमी है।' },
    },
    mr: {
      SMS: {
        body: 'तातडीचा मार्जिन कॉल: खाते {{account_id}} मध्ये {{formatCurrency shortfall}} ची तूट आहे. वेळेत पैसे भरा: https://app.brokerage.in/funds/add',
      },
    },
    ta: {
      SMS: {
        body: 'அவசர மார்ஜின் எச்சரிக்கை: கணக்கு {{account_id}} இல் {{formatCurrency shortfall}} பற்றாக்குறை உள்ளது. உடனே நிதி சேர்க்கவும்.',
      },
    },
    te: {
      SMS: {
        body: 'అత్యవసర మార్జిన్ కాల్: ఖాతా {{account_id}} లో {{formatCurrency shortfall}} లోటు ఉంది. వెంటనే నిధులను జోడించండి.',
      },
    },
  },

  'RISK-002': {
    en: {
      SMS: {
        body: 'MARGIN SHORTFALL: Shortfall of {{formatCurrency shortfall_amount}} in {{account_id}}. Penalty risk: {{formatCurrency penalty_risk_amount}}. Clear before {{formatDateTime deadline user.timezone}}.',
      },
      EMAIL: {
        subject: 'Notice of Margin Shortfall & Penalty Risk',
        body: '<p>Dear {{user.fullName}},</p><p>Regulatory margin shortfall of {{formatCurrency shortfall_amount}} recorded in {{account_id}}. Estimated penalty: {{formatCurrency penalty_risk_amount}}.</p>',
      },
      PUSH: {
        subject: 'Margin Shortfall Alert',
        body: 'Shortfall: {{formatCurrency shortfall_amount}}. Potential penalty: {{formatCurrency penalty_risk_amount}}.',
      },
      WHATSAPP: {
        body: '⚠️ *Margin Shortfall*: {{formatCurrency shortfall_amount}} in {{account_id}}. Penalty risk: {{formatCurrency penalty_risk_amount}}.',
      },
      IN_APP: {
        subject: 'Margin Shortfall',
        body: 'Shortfall {{formatCurrency shortfall_amount}} in {{account_id}}.',
      },
    },
    hi: {
      SMS: {
        body: 'मार्जिन कमी: खाते {{account_id}} में {{formatCurrency shortfall_amount}} की कमी। जुर्माना जोखिम: {{formatCurrency penalty_risk_amount}}।',
      },
    },
  },

  'RISK-003': {
    en: {
      SMS: {
        body: 'RMS ALERT: Positions squared off due to {{reason}}. Liquidation value: {{formatCurrency liquidation_value}}. Loss: {{formatCurrency loss_incurred}}.',
      },
      EMAIL: {
        subject: 'RMS Auto Square-Off Notification',
        body: '<p>Dear {{user.fullName}},</p><p>Positions squared off ({{reason}}). Liquidation value: {{formatCurrency liquidation_value}}, Loss: {{formatCurrency loss_incurred}}.</p>',
      },
      PUSH: {
        subject: 'Positions Squared Off',
        body: 'RMS squared off positions. Value: {{formatCurrency liquidation_value}}.',
      },
      IN_APP: {
        subject: 'Positions Squared Off',
        body: 'Auto square-off executed ({{formatCurrency liquidation_value}}).',
      },
    },
    hi: {
      SMS: {
        body: 'RMS चेतावनी: आपकी पोजीशन स्क्वेयर-ऑफ कर दी गई हैं। लिक्विडेशन मूल्य: {{formatCurrency liquidation_value}}।',
      },
    },
  },

  'RISK-004': {
    en: {
      EMAIL: {
        subject: 'Portfolio Risk Alert (VaR {{var_95}}%, Beta {{beta}})',
        body: '<p>Dear {{user.fullName}},</p><p>Portfolio 95% VaR is {{var_95}}% and Beta is {{beta}}. {{recommendation}}</p>',
      },
      PUSH: {
        subject: 'Portfolio Risk Elevated',
        body: 'VaR: {{var_95}}% | Beta: {{beta}}. {{recommendation}}',
      },
      IN_APP: {
        subject: 'Portfolio Risk Alert',
        body: 'VaR {{var_95}}%, Beta {{beta}} — {{recommendation}}',
      },
    },
  },

  'RISK-005': {
    en: {
      EMAIL: {
        subject: 'Sector Concentration Alert: {{symbol}} ({{sector}})',
        body: '<p>Dear {{user.fullName}},</p><p>Your {{sector}} exposure via {{symbol}} is {{concentration_percent}}% (threshold {{threshold_percent}}%).</p>',
      },
      PUSH: {
        subject: 'Concentration Alert: {{symbol}}',
        body: '{{sector}} allocation at {{concentration_percent}}% (threshold {{threshold_percent}}%).',
      },
      IN_APP: {
        subject: 'Concentration Alert',
        body: '{{symbol}} ({{sector}}) is at {{concentration_percent}}% of portfolio.',
      },
    },
  },

  // ==========================================
  // C. SIP & INVESTMENT EVENTS (SIPX-001..005)
  // ==========================================
  'SIPX-001': {
    en: {
      EMAIL: {
        subject: 'Upcoming SIP Due: {{fund_name}}',
        body: '<p>Dear {{user.fullName}},</p><p>Your SIP of <strong>{{formatCurrency amount}}</strong> for {{fund_name}} is due on {{formatDateTime due_date user.timezone}} via {{mandate_bank}}.</p>',
      },
      PUSH: {
        subject: 'SIP Due Reminder',
        body: '{{formatCurrency amount}} for {{fund_name}} due on {{formatDateTime due_date user.timezone}}.',
      },
      WHATSAPP: {
        body: '📅 *SIP Due Reminder*\nFund: {{fund_name}}\nAmount: *{{formatCurrency amount}}*\nBank: {{mandate_bank}}',
      },
      IN_APP: {
        subject: 'SIP Due Reminder',
        body: 'SIP of {{formatCurrency amount}} for {{fund_name}} is due shortly.',
      },
    },
    hi: {
      PUSH: { subject: 'SIP अनुस्मारक', body: '{{fund_name}} के लिए {{formatCurrency amount}} की SIP देय है।' },
    },
  },

  'SIPX-002': {
    en: {
      EMAIL: {
        subject: 'SIP Executed: {{fund_name}}',
        body: '<p>Dear {{user.fullName}},</p><p>Your SIP of {{formatCurrency amount}} in {{fund_name}} succeeded at NAV ₹{{nav}}. Units allotted: {{units_allotted}}.</p>',
      },
      PUSH: {
        subject: 'SIP Executed: {{fund_name}}',
        body: 'Allotted {{units_allotted}} units @ NAV ₹{{nav}} ({{formatCurrency amount}}).',
      },
      WHATSAPP: { body: '✅ *SIP Executed*\n{{fund_name}}: {{units_allotted}} units allotted @ ₹{{nav}}.' },
      IN_APP: {
        subject: 'SIP Executed',
        body: '{{formatCurrency amount}} invested in {{fund_name}} ({{units_allotted}} units)',
      },
    },
  },

  'SIPX-003': {
    en: {
      SMS: {
        body: 'SIP Failed: {{fund_name}} ({{formatCurrency amount}}) failed due to {{failure_reason}}. Next retry: {{formatDateTime retry_date user.timezone}}.',
      },
      EMAIL: {
        subject: 'Action Needed: SIP Failed for {{fund_name}}',
        body: '<p>Dear {{user.fullName}},</p><p>Your SIP installment of {{formatCurrency amount}} for {{fund_name}} failed ({{failure_reason}}). Retry scheduled on {{formatDateTime retry_date user.timezone}}.</p>',
      },
      PUSH: {
        subject: 'SIP Failed: {{fund_name}}',
        body: 'Reason: {{failure_reason}}. Amount: {{formatCurrency amount}}.',
      },
      WHATSAPP: {
        body: '⚠️ *SIP Installment Failed*\n{{fund_name}} ({{formatCurrency amount}}): {{failure_reason}}.',
      },
      IN_APP: { subject: 'SIP Failed', body: '{{fund_name}} SIP failed ({{failure_reason}}).' },
    },
  },

  'SIPX-004': {
    en: {
      EMAIL: {
        subject: 'Boost Wealth with SIP Step-Up: {{fund_name}}',
        body: '<p>Dear {{user.fullName}},</p><p>Consider stepping up your {{fund_name}} SIP from {{formatCurrency current_amount}} to {{formatCurrency suggested_amount}}.</p>',
      },
      PUSH: {
        subject: 'SIP Step-Up Tip',
        body: 'Increase {{fund_name}} SIP from {{formatCurrency current_amount}} to {{formatCurrency suggested_amount}}.',
      },
      WHATSAPP: {
        body: '📈 *SIP Step-Up Suggestion*: Upgrade {{fund_name}} from {{formatCurrency current_amount}} to {{formatCurrency suggested_amount}}.',
      },
      IN_APP: {
        subject: 'SIP Step-Up Reminder',
        body: 'Upgrade {{fund_name}} SIP to {{formatCurrency suggested_amount}}.',
      },
    },
  },

  'SIPX-005': {
    en: {
      EMAIL: {
        subject: 'Milestone Reached: {{goal_name}} ({{percentage_achieved}}%)',
        body: '<p>Congratulations {{user.fullName}}!</p><p>You have achieved {{percentage_achieved}}% ({{formatCurrency achieved_amount}} of {{formatCurrency target_amount}}) toward {{goal_name}}.</p>',
      },
      PUSH: {
        subject: '🎯 Goal Milestone: {{goal_name}}',
        body: 'Reached {{percentage_achieved}}% ({{formatCurrency achieved_amount}})!',
      },
      WHATSAPP: {
        body: '🎯 *Goal Milestone*: {{goal_name}} is {{percentage_achieved}}% complete ({{formatCurrency achieved_amount}})!',
      },
      IN_APP: {
        subject: 'Goal Milestone Reached',
        body: '{{goal_name}}: {{percentage_achieved}}% achieved ({{formatCurrency achieved_amount}}).',
      },
    },
  },

  // ==========================================
  // D. MARKET & PRICE EVENTS (MKTX-001..005)
  // ==========================================
  'MKTX-001': {
    en: {
      SMS: {
        body: 'Price Alert: {{symbol}} hit target of ₹{{target_price}}! Current: ₹{{current_price}} ({{change_percentage}}%). Trade now: https://app.brokerage.in/t/{{symbol}}',
      },
      PUSH: {
        subject: 'Price Alert: {{symbol}}',
        body: '{{symbol}} hit ₹{{target_price}} (Current ₹{{current_price}}, {{change_percentage}}%).',
      },
      WHATSAPP: {
        body: '🔔 *Price Alert*: {{symbol}} reached ₹{{current_price}} (Target ₹{{target_price}}, {{change_percentage}}%).',
      },
      IN_APP: {
        subject: 'Price Alert Triggered',
        body: '{{symbol}} reached target ₹{{target_price}} (Now ₹{{current_price}})',
      },
    },
    hi: {
      SMS: { body: 'मूल्य अलर्ट: {{symbol}} लक्ष्य मूल्य ₹{{target_price}} पर पहुंचा! वर्तमान: ₹{{current_price}}।' },
      PUSH: { subject: 'प्राइस अलर्ट: {{symbol}}', body: '{{symbol}} ₹{{target_price}} के लक्ष्य पर पहुंच गया है।' },
    },
  },

  'MKTX-002': {
    en: {
      PUSH: {
        subject: '⚡ Circuit Breaker: {{symbol}}',
        body: '{{symbol}} hit {{circuit_type}} circuit ({{band_percentage}}%). Trading halted for {{halt_duration_minutes}} mins.',
      },
      IN_APP: {
        subject: 'Circuit Breaker Hit',
        body: '{{symbol}} hit {{circuit_type}} {{band_percentage}}% circuit breaker (Halt: {{halt_duration_minutes}}m).',
      },
    },
  },

  'MKTX-003': {
    en: {
      PUSH: {
        subject: 'Market Status: {{session}}',
        body: 'NIFTY50: {{indices.NIFTY50}} | SENSEX: {{indices.SENSEX}}',
      },
      IN_APP: {
        subject: 'Market {{session}}',
        body: 'NIFTY50 at {{indices.NIFTY50}}, SENSEX at {{indices.SENSEX}}.',
      },
    },
  },

  'MKTX-004': {
    en: {
      PUSH: { subject: '{{symbol}} {{milestone}}', body: '{{symbol}} reached ₹{{price}} ({{milestone}}).' },
      IN_APP: { subject: '52-Week Milestone', body: '{{symbol}} hit {{milestone}} at ₹{{price}}.' },
    },
  },

  'MKTX-005': {
    en: {
      EMAIL: {
        subject: 'Earnings Update: {{symbol}} ({{q_period}})',
        body: '<p>{{symbol}} reported {{q_period}} revenue growth of {{revenue_growth}}% and PAT growth of {{pat_growth}}%.</p>',
      },
      PUSH: {
        subject: '{{symbol}} {{q_period}} Results',
        body: 'Revenue +{{revenue_growth}}% | PAT +{{pat_growth}}%.',
      },
      IN_APP: {
        subject: 'Earnings Announcement',
        body: '{{symbol}} ({{q_period}}): Rev {{revenue_growth}}%, PAT {{pat_growth}}%.',
      },
    },
  },

  // ==========================================
  // E. REGULATORY EVENTS (REGX-001..005)
  // ==========================================
  'REGX-001': {
    en: {
      SMS: {
        body: 'KYC EXPIRY NOTICE: Your KYC expires on {{formatDateTime kyc_expiry_date user.timezone}} ({{days_remaining}} days left). Re-verify: {{rekyc_portal_url}}',
      },
      EMAIL: {
        subject: 'Mandatory Action: KYC Expiring in {{days_remaining}} Days',
        body: '<p>Dear {{user.fullName}},</p><p>Your KYC expires on {{formatDateTime kyc_expiry_date user.timezone}} ({{days_remaining}} days remaining). Complete Re-KYC at <a href="{{rekyc_portal_url}}">{{rekyc_portal_url}}</a>.</p>',
      },
      PUSH: {
        subject: 'KYC Expiry Warning',
        body: 'Re-verify KYC within {{days_remaining}} days to keep trading uninterrupted.',
      },
      WHATSAPP: {
        body: '🪪 *KYC Expiry Notice*: {{days_remaining}} days left. Renew at {{rekyc_portal_url}}',
      },
      IN_APP: {
        subject: 'KYC Expiry Warning',
        body: 'KYC expires in {{days_remaining}} days. Complete Re-KYC now.',
      },
    },
  },

  'REGX-002': {
    en: {
      EMAIL: {
        subject: 'SEBI Mandate: Update Demat Nominee Before {{formatDateTime deadline_date user.timezone}}',
        body: '<p>Dear {{user.fullName}},</p><p>Please update or opt-out of nomination for your demat account before {{formatDateTime deadline_date user.timezone}}.</p>',
      },
      PUSH: {
        subject: 'Nominee Update Reminder',
        body: 'Update nominee details before {{formatDateTime deadline_date user.timezone}}.',
      },
      IN_APP: {
        subject: 'Nominee Update Reminder',
        body: 'Complete SEBI nominee declaration before {{formatDateTime deadline_date user.timezone}}.',
      },
    },
  },

  'REGX-003': {
    en: {
      SMS: {
        body: 'Contract Note {{contract_note_number}} for {{formatDateTime trade_date user.timezone}} ready. Net: {{formatCurrency net_payable_receivable}}. {{download_url}}',
      },
      EMAIL: {
        subject: 'Contract Note {{contract_note_number}} Generated',
        body: '<p>Dear {{user.fullName}},</p><p>Your Contract Note <strong>{{contract_note_number}}</strong> is ready. Net Payable/Receivable: {{formatCurrency net_payable_receivable}}. <a href="{{download_url}}">Download PDF</a></p>',
      },
      IN_APP: {
        subject: 'Contract Note Ready',
        body: 'Contract Note {{contract_note_number}} ({{formatCurrency net_payable_receivable}}) is available.',
      },
    },
  },

  'REGX-004': {
    en: {
      EMAIL: {
        subject: '{{financial_year}} {{statement_type}} Tax Statement Ready',
        body: '<p>Dear {{user.fullName}},</p><p>Your {{statement_type}} tax statement for {{financial_year}} is ready: <a href="{{download_url}}">Download</a></p>',
      },
      IN_APP: {
        subject: 'Tax Statement Available',
        body: '{{financial_year}} {{statement_type}} statement ready for download.',
      },
    },
  },

  'REGX-005': {
    en: {
      SMS: {
        body: 'IMPORTANT REGULATORY UPDATE: {{issuing_authority}} circular {{circular_number}}: "{{title}}". Effective {{formatDateTime effective_date user.timezone}}. Read: https://app.brokerage.in/reg/{{circular_number}}',
      },
      EMAIL: {
        subject: 'Regulatory Update: {{issuing_authority}} Circular - {{title}}',
        body: '<p>Dear Investor,</p><p>Important regulatory update from <strong>{{issuing_authority}}</strong> ({{circular_number}}): <strong>{{title}}</strong></p><p>{{summary}}</p><p>Effective: {{formatDateTime effective_date user.timezone}}</p>',
      },
      PUSH: {
        subject: 'Regulatory Notice: {{issuing_authority}}',
        body: '{{title}} (Effective {{formatDateTime effective_date user.timezone}}).',
      },
      WHATSAPP: {
        body: '🏛️ *Regulatory Policy Update - {{issuing_authority}}*\n\nCircular: {{circular_number}}\n*{{title}}*\n\n{{summary}}',
      },
      IN_APP: {
        subject: 'Regulatory Update ({{issuing_authority}})',
        body: '{{title}} - Effective {{formatDateTime effective_date user.timezone}}',
      },
    },
    hi: {
      SMS: {
        body: 'महत्वपूर्ण नियामक सूचना: {{issuing_authority}} सर्कुलर {{circular_number}}: "{{title}}"। पढ़ें: https://app.brokerage.in/reg/{{circular_number}}',
      },
      EMAIL: {
        subject: 'नियामक अपडेट: {{issuing_authority}} सर्कुलर - {{title}}',
        body: '<p>प्रिय निवेशक,</p><p><strong>{{issuing_authority}}</strong> द्वारा महत्वपूर्ण नियामक संशोधन: <strong>{{title}}</strong></p><p>{{summary}}</p>',
      },
      PUSH: { subject: 'नियामक सूचना: {{issuing_authority}}', body: '{{title}}। पूर्ण विवरण ऐप में देखें।' },
      WHATSAPP: {
        body: '🏛️ *नियामक नीति अपडेट - {{issuing_authority}}*\n\nसर्कुलर: {{circular_number}}\n*{{title}}*\n\n{{summary}}',
      },
      IN_APP: { subject: 'नियामक नीति अपडेट', body: '{{title}} - {{issuing_authority}}' },
    },
    mr: {
      SMS: {
        body: 'महत्त्वाची नियामक सूचना: {{issuing_authority}} चे परिपत्रक {{circular_number}}: "{{title}}". वाचा: https://app.brokerage.in/reg/{{circular_number}}',
      },
      PUSH: { subject: 'नियामक सूचना: {{issuing_authority}}', body: '{{title}}. तपशीलांसाठी टॅप करा.' },
    },
    ta: {
      SMS: {
        body: 'முக்கிய ஒழுங்குமுறை அறிவிப்பு: {{issuing_authority}} சுற்றறிக்கை {{circular_number}}: "{{title}}". படிக்க: https://app.brokerage.in/reg/{{circular_number}}',
      },
      PUSH: {
        subject: 'ஒழுங்குமுறை தகவல்: {{issuing_authority}}',
        body: '{{title}}. விவரங்களுக்கு இங்கே கிளிக் செய்யவும்.',
      },
    },
    te: {
      SMS: {
        body: 'ముఖ్యమైన రెగ్యులేటరీ అప్‌డేట్: {{issuing_authority}} సర్క్యులర్ {{circular_number}}: "{{title}}". వివరాలు: https://app.brokerage.in/reg/{{circular_number}}',
      },
      PUSH: { subject: 'రెగ్యులేటరీ నోటీస్: {{issuing_authority}}', body: '{{title}}. వివరాల కోసం చూడండి.' },
    },
  },
};
