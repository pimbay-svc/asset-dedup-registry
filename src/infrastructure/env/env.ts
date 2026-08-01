/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { z } from 'zod';
import { EnvError } from './errors.js';

export const NodeEnv = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  TEST: 'test',
} as const;

export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];

const EnvSchema = z.object({
  NODE_ENV: z.enum([NodeEnv.PRODUCTION, NodeEnv.DEVELOPMENT, NodeEnv.TEST]).default(NodeEnv.PRODUCTION),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  PORT: z.coerce.number().int().positive().default(3100),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw EnvError.invalidConfiguration(result.error.toString());
  }

  return result.data;
}
