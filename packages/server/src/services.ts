import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const ServiceAreaSchema = z.object({
  country: z.string().min(2).max(3),
  regions: z.array(z.string()).optional(),
  cities: z.array(z.string()).optional(),
  radius_km: z.number().positive().optional(),
});

const ServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  service_area: ServiceAreaSchema.optional(),
});

const ServicesFileSchema = z.object({
  services: z.array(ServiceSchema).min(1, 'At least one service must be defined'),
});

export type Service = z.infer<typeof ServiceSchema>;

// --- Deposit hold extensions (v1.1) ---

const ExtendedServiceSchema = ServiceSchema.extend({
  deposit_required: z.boolean().optional().default(false),
  deposit_amount_pence: z.number().int().positive().optional(),
}).refine(
  (s) => !s.deposit_required || (s.deposit_amount_pence !== undefined && s.deposit_amount_pence > 0),
  { message: 'deposit_amount_pence is required and must be positive when deposit_required is true' }
);

export { ExtendedServiceSchema };
export type ExtendedService = z.infer<typeof ExtendedServiceSchema>;

const ExtendedServicesFileSchema = z.object({
  services: z.array(ExtendedServiceSchema).min(1, 'At least one service must be defined'),
});

export function loadServicesWithDeposit(filePath?: string): ExtendedService[] {
  const resolvedPath = resolve(process.cwd(), filePath ?? 'services.yaml');

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read services file at ${resolvedPath}. ` +
        'Create a services.yaml file or set SERVICES_FILE env var.'
    );
  }

  const parsed = parse(raw) as unknown;
  const result = ExtendedServicesFileSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid services.yaml:\n${issues}`);
  }

  return result.data.services;
}

// --- Original loader (unchanged) ---

export function loadServices(filePath?: string): Service[] {
  const resolvedPath = resolve(process.cwd(), filePath ?? 'services.yaml');

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read services file at ${resolvedPath}. ` +
        'Create a services.yaml file or set SERVICES_FILE env var.'
    );
  }

  const parsed = parse(raw) as unknown;
  const result = ServicesFileSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid services.yaml:\n${issues}`);
  }

  return result.data.services;
}
