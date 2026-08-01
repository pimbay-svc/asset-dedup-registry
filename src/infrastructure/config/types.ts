/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { z } from 'zod';

export const ConfigSchema = z.object({
  core_base_url: z.url(),
  core_timeout_ms: z.number().int().positive().default(10000),
  // Fallback minimum similarity percentage (0-100) for hamming duplicate matching, used
  // whenever a project hasn't set its own `hamming_threshold`.
  default_hamming_threshold: z.number().min(0).max(100),
  default_rate_limit_per_minute: z.number().int().positive().default(300),
  database: z.object({
    pool_size: z.number().int().positive().default(10),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface DatabaseConfig {
  url: string;
  pool_size: number;
}
