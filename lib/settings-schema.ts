import { z } from 'zod';

export const tones = ['friendly', 'professional', 'concise'] as const;
const text = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Remove control characters.');
export const settingsSchema = z.object({
  businessName: text(120).pipe(z.string().min(1)),
  greeting: text(500).pipe(z.string().min(1)),
  tone: z.enum(tones),
  instructions: text(12000).pipe(z.string().min(1)),
  supportEmail: text(254).refine(value => !value || z.email().safeParse(value).success, 'Enter a valid email or leave blank.'),
  supportPhone: text(40).refine(value => !value || (/^[+\d][\d () .-]{4,39}$/.test(value) && value.replace(/\D/g, '').length >= 5), 'Enter a phone number or leave blank.'),
  supportUrl: text(500).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, 'Enter an HTTPS support URL or leave blank.'),
}).strict();
export type BusinessSettings = z.infer<typeof settingsSchema>;
