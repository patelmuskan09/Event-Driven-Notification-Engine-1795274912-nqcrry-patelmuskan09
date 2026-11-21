import { Channel, EnrichedEvent } from '../../events/models/event';
import { PreferencesService } from '../../preferences/preferences-service';
import { DndService } from '../../compliance/dnd/dnd-service';

export interface RouteDecision {
  selectedChannels: Channel[];
  fanOut: boolean;
  priorityLevel: 'REGULATORY_MANDATE' | 'USER_PREFERENCE' | 'OPTIMISED_DELIVERY';
  reason: string;
  channelScores: Record<Channel, number>;
}

const CHANNEL_COST_INR: Record<Channel, number> = {
  IN_APP: 0,
  PUSH: 0,
  EMAIL: 0.02,
  SMS: 0.12,
  WHATSAPP: 0.68,
};

const DAILY_USER_BUDGET_INR = 5.0;
const MONTHLY_USER_BUDGET_INR = 50.0;

export class NotificationRouter {
  private static instance: NotificationRouter;
  private preferencesService: PreferencesService;
  private dndService: DndService;

  private constructor() {
    this.preferencesService = PreferencesService.getInstance();
    this.dndService = DndService.getInstance();
  }

  public static getInstance(): NotificationRouter {
    if (!NotificationRouter.instance) {
      NotificationRouter.instance = new NotificationRouter();
    }
    return NotificationRouter.instance;
  }

  /**
   * Evaluates the 4-level routing hierarchy:
   * 1. Regulatory Mandate
   * 2. User Preferences (per-event & per-category + OTT consent)
   * 3. Delivery & Engagement Optimisation
   * 4. Cost Optimisation + Daily/Monthly User Budget
   */
  public route(event: EnrichedEvent): RouteDecision {
    const def = event.definition;
    const rawPrefs = this.preferencesService.getPreferences(event.userId, event.userContext.accountType);
    const userPrefs = this.preferencesService.applyRegulatoryOverride(
      rawPrefs,
      def.regulatoryClassification,
      def.mandatoryChannels
    );

    const channelScores: Record<Channel, number> = {
      IN_APP: 85,
      PUSH: 90,
      EMAIL: 78,
      SMS: 88,
      WHATSAPP: 82,
    };

    // Priority 1 — Regulatory Mandate
    if (def.regulatoryClassification === 'REGULATORY_MANDATORY') {
      return {
        selectedChannels: [...def.mandatoryChannels],
        fanOut: def.mandatoryChannels.length > 1,
        priorityLevel: 'REGULATORY_MANDATE',
        reason: `Mandatory regulatory compliance directive enforces delivery on ${def.mandatoryChannels.join(', ')} regardless of user settings.`,
        channelScores,
      };
    }

    // Priority 2 — Per-event & Per-category User Preferences
    const eventOverride = userPrefs.eventOverrides?.[event.eventType];
    if (eventOverride && !eventOverride.enabled) {
      return {
        selectedChannels: [],
        fanOut: false,
        priorityLevel: 'USER_PREFERENCE',
        reason: `User disabled notifications for event ${event.eventType}.`,
        channelScores,
      };
    }

    const categoryConfig = userPrefs.categorySettings[def.category];
    if (categoryConfig && !categoryConfig.enabled) {
      return {
        selectedChannels: [],
        fanOut: false,
        priorityLevel: 'USER_PREFERENCE',
        reason: `User disabled notifications for the "${def.category}" category.`,
        channelScores,
      };
    }

    let eligibleChannels = def.permittedChannels.filter((ch) => userPrefs.channelSettings[ch]);

    // Check separate OTT consent for WhatsApp & Email
    if (eligibleChannels.includes('WHATSAPP')) {
      const waCheck = this.dndService.verifyOttConsent(
        'WHATSAPP',
        def.regulatoryClassification,
        event.userContext.whatsappConsent
      );
      if (!waCheck.allowed) {
        eligibleChannels = eligibleChannels.filter((ch) => ch !== 'WHATSAPP');
      }
    }
    if (eligibleChannels.includes('EMAIL')) {
      const emailCheck = this.dndService.verifyOttConsent(
        'EMAIL',
        def.regulatoryClassification,
        event.userContext.emailConsent
      );
      if (!emailCheck.allowed) {
        eligibleChannels = eligibleChannels.filter((ch) => ch !== 'EMAIL');
      }
    }

    if (eventOverride?.channels && eventOverride.channels.length > 0) {
      eligibleChannels = eligibleChannels.filter((ch) => eventOverride.channels!.includes(ch));
    } else if (categoryConfig && categoryConfig.channels && categoryConfig.channels.length > 0) {
      eligibleChannels = eligibleChannels.filter((ch) => categoryConfig.channels.includes(ch));
    }

    // Priority 4 — Enforce daily & monthly cost budgets for non-critical events
    const withinBudget =
      event.userContext.dailyCostSpentInr < DAILY_USER_BUDGET_INR &&
      event.userContext.monthlyCostSpentInr < MONTHLY_USER_BUDGET_INR;

    if (!withinBudget && def.priority !== 'CRITICAL') {
      const freeOnly = eligibleChannels.filter((ch) => CHANNEL_COST_INR[ch] === 0);
      if (freeOnly.length > 0) eligibleChannels = freeOnly;
    }

    if (eligibleChannels.length === 0) {
      return {
        selectedChannels: ['IN_APP'],
        fanOut: false,
        priorityLevel: 'USER_PREFERENCE',
        reason: 'User disabled all channels or exceeded cost budget; routed to default In-App inbox.',
        channelScores,
      };
    }

    // Priority 3 — Delivery Optimisation for CRITICAL / HIGH
    if (def.priority === 'CRITICAL' || def.priority === 'HIGH') {
      return {
        selectedChannels: eligibleChannels,
        fanOut: eligibleChannels.length > 1,
        priorityLevel: 'OPTIMISED_DELIVERY',
        reason: `High urgency event fanning out to ${eligibleChannels.join(', ')} for guaranteed reach.`,
        channelScores,
      };
    }

    // Priority 4 — Cost Optimisation for MEDIUM / LOW
    const costRank: Channel[] = ['PUSH', 'IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'];
    const chosenChannel = costRank.find((ch) => eligibleChannels.includes(ch)) || eligibleChannels[0];

    return {
      selectedChannels: [chosenChannel],
      fanOut: false,
      priorityLevel: 'OPTIMISED_DELIVERY',
      reason: `Cost & engagement optimisation selected ${chosenChannel} for non-critical ${def.priority} event.`,
      channelScores,
    };
  }
}
