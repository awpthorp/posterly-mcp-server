/**
 * Preview text for Google Business location edits, shared by the hosted and
 * npm MCP servers. An hours or attribute edit replaces what is on the public
 * profile, so the preview lists what is there now next to what will be set.
 */

export type GbpPreviewPeriod = {
  open_day?: unknown;
  open_time?: unknown;
  close_day?: unknown;
  close_time?: unknown;
};

export type GbpPreviewAttribute = {
  name?: unknown;
  value_type?: unknown;
  values?: unknown;
};

export const GBP_CLOSED_DAYS_NOTE = 'A day with no opening period shows as closed on Google.';

export function gbpPeriodLines(periods: GbpPreviewPeriod[] | null | undefined, empty: string): string {
  const rows = Array.isArray(periods) ? periods : [];
  if (!rows.length) return empty;
  return rows
    .map((period) => `- ${String(period?.open_day ?? '?')} ${String(period?.open_time ?? '?')} to ${String(period?.close_day ?? '?')} ${String(period?.close_time ?? '?')}`)
    .join('\n');
}

export function gbpAttributeLines(attributes: GbpPreviewAttribute[] | null | undefined, empty: string): string {
  const rows = Array.isArray(attributes) ? attributes : [];
  if (!rows.length) return empty;
  return rows
    .map((attribute) => `- ${String(attribute?.name ?? '?')} (${String(attribute?.value_type ?? '?')}): ${Array.isArray(attribute?.values) ? attribute.values.join(', ') : ''}`)
    .join('\n');
}

/** The current values of only the attributes this edit names. */
export function gbpCurrentAttributesFor(
  current: GbpPreviewAttribute[] | null | undefined,
  requested: GbpPreviewAttribute[] | null | undefined,
): GbpPreviewAttribute[] {
  const names = new Set((Array.isArray(requested) ? requested : []).map((attribute) => String(attribute?.name ?? '')));
  return (Array.isArray(current) ? current : []).filter((attribute) => names.has(String(attribute?.name ?? '')));
}
