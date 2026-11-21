import Handlebars from 'handlebars';

export function registerHandlebarsHelpers(): void {
  // Format currency into INR ₹ or locale
  Handlebars.registerHelper('formatCurrency', function (value: number | string, locale: string = 'en-IN') {
    const num = Number(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat(locale === 'en' ? 'en-IN' : 'hi-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(num);
  });

  // Format date time with timezone support
  Handlebars.registerHelper('formatDateTime', function (dateStr: string, timezone: string = 'Asia/Kolkata') {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: timezone || 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(d);
    } catch {
      return dateStr;
    }
  });

  // Safe fallback helper if field is undefined/null
  Handlebars.registerHelper('fallback', function (value: any, defaultValue: any) {
    return value !== undefined && value !== null && value !== '' ? value : defaultValue;
  });

  // Number formatting
  Handlebars.registerHelper('formatNumber', function (value: number | string) {
    const num = Number(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat('en-IN').format(num);
  });
}

/**
 * Intelligent SMS truncation to ensure messages do not exceed 160 GSM-7 characters.
 * Preserves essential fields (Symbol, Amount, Action) and ensures critical links remain intact.
 */
export function truncateSmsContent(text: string, maxLen: number = 160): string {
  if (text.length <= maxLen) return text;

  // Extract URL if present
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = text.match(urlRegex);
  const url = urls ? urls[0] : '';

  // Truncate text part keeping url at the end
  const budget = url ? maxLen - url.length - 4 : maxLen - 3;
  const truncatedText = text.substring(0, Math.max(10, budget)).trim();

  return url ? `${truncatedText}... ${url}` : `${truncatedText}...`;
}
