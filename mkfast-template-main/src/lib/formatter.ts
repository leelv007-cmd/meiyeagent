/**
 * Format a price for display
 *
 * Formatted for the audience that reads it. These prices are quoted to Chinese
 * shop owners, and `en-US` renders CNY as `CN¥399` — a disambiguation English
 * needs because `¥` could be yen, and one no merchant here expects on a price
 * tag. Every decision that set these numbers wrote them `¥399`, and the browser
 * contract on the landing page has always asked for `¥<digits>`; the template
 * default was quietly answering in a different alphabet.
 *
 * Currencies that are not the local one keep their disambiguating prefix under
 * this locale too — the Waffo catalog's HKD still reads `HK$522` — so the
 * change removes a foreign-language artifact without making any price
 * ambiguous.
 *
 * @param price Price amount in currency units (dollars, euros, etc.)
 * @param currency Currency code
 * @returns Formatted price string
 */
export function formatPrice(price: number, currency: string): string {
  const formatter = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  });

  return formatter.format(price / 100); // Convert from cents to dollars
}

/**
 * Format bytes to human readable format
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g. "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  year: 'numeric',
});

/**
 * Format a date for display
 * @param date Date to format
 * @returns Formatted date string in the format "Year/Month/Day"
 */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/**
 * Format a date and time for display
 * @param date Date and time to format
 * @returns Formatted date string in the format "Year/Month/Day HH:MM:SS"
 */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}
