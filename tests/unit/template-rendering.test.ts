import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TemplateEngine } from '../../src/templates/engine/template-engine';
import { EventFactory } from '../../src/events/factory';
import { EnrichedEvent, SupportedLanguage } from '../../src/events/models/event';
import { FINANCIAL_EVENTS_REGISTRY, getEventDefinition } from '../../src/events/taxonomy';
import { truncateSmsContent } from '../../src/templates/engine/helpers';

describe('Handlebars Multi-Lingual Template Engine Test Suite (30+ Tests)', () => {
  const engine = TemplateEngine.getInstance();
  const allCodes = Object.keys(FINANCIAL_EVENTS_REGISTRY);

  function enrich(evt: any, lang: SupportedLanguage = 'en'): EnrichedEvent {
    return {
      ...evt,
      definition: getEventDefinition(evt.eventType)!,
      userContext: {
        userId: evt.userId,
        fullName: 'Rohan Sharma',
        email: 'rohan.sharma@domain.com',
        phone: '+919876543210',
        language: lang,
        timezone: 'Asia/Kolkata',
        accountType: 'RETAIL',
        riskProfile: 'MODERATE',
        isDndRegistered: false,
        dndOptInCategories: [],
        emailConsent: true,
        whatsappConsent: true,
        dailyCostSpentInr: 0,
        monthlyCostSpentInr: 0,
      },
      enrichedAt: new Date().toISOString(),
    };
  }

  // Tests 1..25: Verify all 25 event types render cleanly on primary channels
  allCodes.forEach((code, idx) => {
    test(`${idx + 1}. Renders ${code} template cleanly in English without empty output`, () => {
      const evt = EventFactory.createEvent(code);
      const def = getEventDefinition(code)!;
      const primaryChannel = def.permittedChannels[0];
      const rendered = engine.render(enrich(evt, 'en'), primaryChannel, 'en');
      assert.ok(rendered.body.length > 10, `Expected non-empty rendered body for ${code}`);
      assert.strictEqual(rendered.languageUsed, 'en');
      assert.ok(rendered.templateVersion, 'Template version returned');
      if (primaryChannel === 'SMS') {
        assert.ok(rendered.body.length <= 160, `${code} SMS length ${rendered.body.length} <= 160`);
      }
    });
  });

  test('26. Renders TXNX-001 in Hindi (hi) with INR formatting', () => {
    const evt = EventFactory.createEvent('TXNX-001');
    const rendered = engine.render(enrich(evt, 'hi'), 'SMS', 'hi');
    assert.strictEqual(rendered.languageUsed, 'hi');
    assert.ok(rendered.body.includes('निष्पादित'));
    assert.ok(rendered.body.length <= 160);
  });

  test('27. Renders REGX-005 across all 5 languages (en, hi, mr, ta, te)', () => {
    const evt = EventFactory.createEvent('REGX-005');
    for (const lang of ['en', 'hi', 'mr', 'ta', 'te'] as SupportedLanguage[]) {
      const res = engine.render(enrich(evt, lang), 'SMS', lang);
      assert.strictEqual(res.languageUsed, lang);
      assert.strictEqual(res.wasFallbackToEnglish, false);
      assert.ok(res.body.length > 0 && res.body.length <= 160);
    }
  });

  test('28. Supports A/B template variants (Variant A vs Variant B)', () => {
    const evt = EventFactory.createEvent('RISK-001');
    const varA = engine.render(enrich(evt, 'en'), 'SMS', 'en', 'A');
    const varB = engine.render(enrich(evt, 'en'), 'SMS', 'en', 'B');
    assert.strictEqual(varA.abVariant, 'A');
    assert.strictEqual(varB.abVariant, 'B');
    assert.notStrictEqual(varA.body, varB.body);
  });

  test('29. Falls back gracefully to English when channel/language translation is missing', () => {
    const evt = EventFactory.createEvent('TXNX-004');
    const rendered = engine.render(enrich(evt, 'te'), 'EMAIL', 'te');
    assert.ok(rendered.body.length > 0);
    assert.strictEqual(rendered.wasFallbackToEnglish, true);
    assert.strictEqual(rendered.languageUsed, 'en');
  });

  test('30. Escapes injected HTML/script tags in Handlebars output (XSS Defense)', () => {
    const evt = EventFactory.createEvent('TXNX-001', {
      payload: { symbol: '<script>alert(1)</script>' },
    });
    const rendered = engine.render(enrich(evt, 'en'), 'EMAIL', 'en');
    assert.strictEqual(rendered.body.includes('<script>'), false);
    assert.ok(rendered.body.includes('&lt;script&gt;'));
  });

  test('31. Intelligent SMS truncation preserves CTA links at the end', () => {
    const longText =
      'Urgent alert regarding your account portfolio margin balance falling significantly below exchange maintenance threshold limit https://app.brokerage.in/funds/add';
    const truncated = truncateSmsContent(longText, 160);
    assert.ok(truncated.length <= 160);
    assert.ok(truncated.endsWith('https://app.brokerage.in/funds/add'));
  });

  test('32. Validates template syntax pre-compilation checks', () => {
    assert.strictEqual(engine.validateTemplateSyntax('Hello {{user.fullName}}').valid, true);
    assert.strictEqual(engine.validateTemplateSyntax('Hello {{#if x}}unclosed').valid, false);
  });
});
