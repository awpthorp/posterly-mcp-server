import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

const AUDIT_SECTION_ORDER = ['basicInfo', 'hours', 'categories', 'description', 'media', 'attributes', 'reviews'];

export function formatGoogleBusinessAuditText(result: { audit?: any; fetchedAt?: string }): string {
  const audit = result.audit || {};
  const recommendations = Array.isArray(audit.recommendations) ? audit.recommendations : [];
  const sections = audit.sections && typeof audit.sections === 'object' ? audit.sections : {};
  const lines = [
    `Google Business audit: ${audit.businessName || 'Unknown business'}`,
    `Score: ${audit.overallScore ?? 'n/a'} (${audit.overallGrade || 'n/a'})`,
    `Fetched: ${result.fetchedAt || 'unknown'}`,
  ];
  const keys = [
    ...AUDIT_SECTION_ORDER.filter((key) => sections[key]),
    ...Object.keys(sections).filter((key) => !AUDIT_SECTION_ORDER.includes(key)),
  ];
  if (keys.length > 0) {
    lines.push('Sections:');
    for (const key of keys) {
      const section = sections[key] || {};
      const label = section.label || key;
      lines.push(`- ${label}: ${section.score ?? 'n/a'}/${section.maxScore ?? 'n/a'}`);
    }
  }
  if (recommendations.length > 0) {
    lines.push('Top recommendations:');
    for (const rec of recommendations.slice(0, 5)) {
      lines.push(`- ${rec.priority || 'medium'}: ${rec.description || rec.title || 'Recommendation'}`);
    }
  }
  return lines.join('\n');
}

export const auditGoogleBusinessProfileTool = {
  name: 'audit_google_business_profile',
  description:
    'Run a live local-profile audit for a connected Google Business Profile location. Returns the 0-100 completeness score, letter grade, a score for each section (profile basics, hours, categories, description, photos, attributes, review health), and recommendations.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe('Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      workspace_id?: string;
      account_id?: number;
      location_id?: string;
    },
  ) {
    const result = await client.auditGoogleBusinessProfile(input);
    return formatGoogleBusinessAuditText(result);
  },
};
