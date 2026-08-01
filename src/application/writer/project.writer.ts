/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { Project, NewProject } from '../../domain/model/model.js';

export interface ProjectSettingsUpdate {
  name?: string;
  recipes?: string[];
  hammingThreshold?: number | null;
  rateLimitPerMinute?: number | null;
}

export interface ProjectWriter {
  create(params: NewProject): Promise<Project>;
  updateSettings(id: string, update: ProjectSettingsUpdate): Promise<Project>;
  deleteById(id: string): Promise<void>;
}
