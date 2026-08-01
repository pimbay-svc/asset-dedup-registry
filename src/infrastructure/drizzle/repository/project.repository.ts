/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { projectTable } from '../schema/project.schema.js';
import type { NewProject, Project } from '../../../domain/model/model.js';
import type { Projects } from '../../../domain/repo/project.repo.js';
import type { ProjectWriter, ProjectSettingsUpdate } from '../../../application/writer/project.writer.js';
import { NotFoundError, AlreadyExistsError } from '../../../domain/errors.js';
import { isUniqueError } from '../errors.js';

export class DrizzleProjectRepository implements Projects, ProjectWriter {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projectTable).where(eq(projectTable.id, id)).limit(1);

    return row ?? null;
  }

  async findBySlug(slug: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projectTable).where(eq(projectTable.slug, slug)).limit(1);

    return row ?? null;
  }

  async getBySlug(slug: string): Promise<Project> {
    const project = await this.findBySlug(slug);

    if (project === null) {
      throw NotFoundError.project(slug);
    }

    return project;
  }

  async list(): Promise<Project[]> {
    return this.db.select().from(projectTable).orderBy(projectTable.slug);
  }

  async create(params: NewProject): Promise<Project> {
    try {
      const [row] = await this.db.insert(projectTable).values(params).returning();

      /* v8 ignore next 3 -- unreachable: plain INSERT...RETURNING always returns the row or throws */
      if (row === undefined) {
        // Stryker disable next-line all: unreachable in practice — guards against the DB driver returning zero rows from an insert/upsert that Postgres guarantees returns exactly one; kept as a defensive invariant check, not a code path any test can trigger honestly.
        throw new Error('Project insert returned no rows');
      }

      return row;
    } catch (err) {
      if (isUniqueError(err)) {
        throw AlreadyExistsError.project(params.slug);
      }

      throw err;
    }
  }

  async updateSettings(id: string, update: ProjectSettingsUpdate): Promise<Project> {
    const [row] = await this.db
      .update(projectTable)
      .set({
        // Stryker disable all: drizzle-orm's own `.set()` already drops `undefined`-valued keys before
        // building the SQL, so forcing these spreads to always include the key (even as `undefined`)
        // produces byte-identical SQL to the guarded version — there's no observable difference to assert
        // on. The guards stay for readability/intent, not correctness.
        ...(update.name !== undefined && { name: update.name }),
        ...(update.recipes !== undefined && { recipes: update.recipes }),
        ...(update.hammingThreshold !== undefined && { hammingThreshold: update.hammingThreshold }),
        ...(update.rateLimitPerMinute !== undefined && { rateLimitPerMinute: update.rateLimitPerMinute }),
        // Stryker restore all
        updatedAt: new Date(),
      })
      .where(eq(projectTable.id, id))
      .returning();

    if (row === undefined) {
      throw NotFoundError.project(id);
    }

    return row;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(projectTable).where(eq(projectTable.id, id));
  }
}
