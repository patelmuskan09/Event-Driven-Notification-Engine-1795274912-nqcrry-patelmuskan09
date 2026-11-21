import Handlebars from 'handlebars';
import { Channel, SupportedLanguage, EnrichedEvent } from '../../events/models/event';
import { TEMPLATES_CATALOG, ChannelTemplate } from '../definitions/templates-catalog';
import { registerHandlebarsHelpers, truncateSmsContent } from './helpers';

export interface RenderResult {
  subject?: string;
  body: string;
  languageUsed: SupportedLanguage;
  wasFallbackToEnglish: boolean;
  templateVersion: string;
  abVariant: 'A' | 'B';
}

export class TemplateEngine {
  private static instance: TemplateEngine;
  private compiledCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  private constructor() {
    registerHandlebarsHelpers();
  }

  public static getInstance(): TemplateEngine {
    if (!TemplateEngine.instance) {
      TemplateEngine.instance = new TemplateEngine();
    }
    return TemplateEngine.instance;
  }

  /**
   * Computes derived contextual financial values (e.g. portfolio impact, margin deficit pct) safely.
   */
  private buildDerivedContext(event: EnrichedEvent): Record<string, unknown> {
    const p = event.payload as Record<string, any>;
    const derived: Record<string, unknown> = {};

    if (typeof p.required_margin === 'number' && typeof p.shortfall === 'number' && p.required_margin > 0) {
      derived.shortfall_percent = Number(((p.shortfall / p.required_margin) * 100).toFixed(1));
    }
    if (typeof p.quantity === 'number' && typeof p.price === 'number') {
      derived.computed_order_value = Number((p.quantity * p.price).toFixed(2));
    }
    return derived;
  }

  public render(
    event: EnrichedEvent,
    channel: Channel,
    targetLanguage?: SupportedLanguage,
    abVariant?: 'A' | 'B'
  ): RenderResult {
    const language = targetLanguage || event.userContext.language || 'en';
    const eventType = event.eventType;

    const eventTemplates = TEMPLATES_CATALOG[eventType];
    let templateObj: ChannelTemplate | undefined;
    let languageUsed: SupportedLanguage = language;
    let wasFallback = false;

    if (eventTemplates) {
      if (eventTemplates[language] && eventTemplates[language]![channel]) {
        templateObj = eventTemplates[language]![channel];
      } else if (eventTemplates['en'] && eventTemplates['en']![channel]) {
        templateObj = eventTemplates['en']![channel];
        languageUsed = 'en';
        wasFallback = language !== 'en';
      }
    }

    if (!templateObj) {
      templateObj = {
        version: '1.0',
        subject: `Notification: ${event.definition.name}`,
        body: `Dear {{user.fullName}}, update regarding ${event.definition.name}.`,
      };
      languageUsed = 'en';
      wasFallback = true;
    }

    const chosenVariant: 'A' | 'B' = abVariant || (event.metadata?.abVariant === 'B' ? 'B' : 'A');

    const activeBodyTemplate =
      chosenVariant === 'B' && templateObj.variantB?.body ? templateObj.variantB.body : templateObj.body;
    const activeSubjectTemplate =
      chosenVariant === 'B' && templateObj.variantB?.subject
        ? templateObj.variantB.subject
        : templateObj.subject;

    const context = {
      ...event.payload,
      ...this.buildDerivedContext(event),
      user: event.userContext,
      definition: event.definition,
      timestamp: event.timestamp,
    };

    const bodyDelegate = this.getOrCompile(
      `body:${eventType}:${channel}:${languageUsed}:${chosenVariant}`,
      activeBodyTemplate
    );
    let renderedBody = bodyDelegate(context);

    if (channel === 'SMS') {
      renderedBody = truncateSmsContent(renderedBody, 160);
    }

    let renderedSubject: string | undefined;
    if (activeSubjectTemplate) {
      const subjectDelegate = this.getOrCompile(
        `sub:${eventType}:${channel}:${languageUsed}:${chosenVariant}`,
        activeSubjectTemplate
      );
      renderedSubject = subjectDelegate(context);
    }

    return {
      subject: renderedSubject,
      body: renderedBody,
      languageUsed,
      wasFallbackToEnglish: wasFallback,
      templateVersion: templateObj.version || '1.0',
      abVariant: chosenVariant,
    };
  }

  public validateTemplateSyntax(templateSource: string): { valid: boolean; error?: string } {
    try {
      Handlebars.precompile(templateSource);
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  }

  public getRegisteredTemplatesSummary(): Array<{
    eventType: string;
    languages: string[];
    channels: string[];
  }> {
    return Object.entries(TEMPLATES_CATALOG).map(([eventType, langs]) => {
      const languages = Object.keys(langs);
      const channels = Array.from(
        new Set(Object.values(langs).flatMap((chMap) => (chMap ? Object.keys(chMap) : [])))
      );
      return { eventType, languages, channels };
    });
  }

  private getOrCompile(cacheKey: string, templateString: string): HandlebarsTemplateDelegate {
    if (this.compiledCache.has(cacheKey)) {
      return this.compiledCache.get(cacheKey)!;
    }
    const compiled = Handlebars.compile(templateString, { noEscape: false });
    this.compiledCache.set(cacheKey, compiled);
    return compiled;
  }
}
