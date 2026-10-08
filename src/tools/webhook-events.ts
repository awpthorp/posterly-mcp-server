import { z } from 'zod';

export const WEBHOOK_EVENTS = [
  'webhook.test',
  'post.created',
  'post.updated',
  'post.deleted',
  'post.publishing',
  'post.published',
  'post.failed',
  'account.disconnected',
  'analytics.synced',
  'approval.requested',
  'approval.approved',
  'approval.changes_requested',
  'approval.rejected',
  'approval.commented',
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
