import { describe, it, expect } from 'vitest';
import { DrizzleAlgorithmRepository } from '../../../../../src/infrastructure/drizzle/repository/algorithm.repository.js';
import { Comparison } from '../../../../../src/domain/model/algorithm.model.js';
import { useTestDb } from '../../../../helpers/db.js';

describe('DrizzleAlgorithmRepository', () => {
  const { db } = useTestDb();

  it('add creates a new algorithm row', async () => {
    const repo = new DrizzleAlgorithmRepository(db());

    const algorithm = await repo.add({ recipe: 'binary.sha256', comparison: Comparison.EXACT });

    expect(algorithm.id).toBeDefined();
    expect(algorithm.recipe).toBe('binary.sha256');
    expect(algorithm.comparison).toBe(Comparison.EXACT);
  });

  it('add is idempotent for the same recipe — returns the existing row instead of erroring', async () => {
    const repo = new DrizzleAlgorithmRepository(db());

    const first = await repo.add({ recipe: 'binary.sha256', comparison: Comparison.EXACT });
    const second = await repo.add({ recipe: 'binary.sha256', comparison: Comparison.EXACT });

    expect(second.id).toBe(first.id);
  });

  it('findByRecipe finds an existing algorithm, and returns null otherwise', async () => {
    const repo = new DrizzleAlgorithmRepository(db());
    const created = await repo.add({ recipe: 'image.phash16', comparison: Comparison.HAMMING });

    await expect(repo.findByRecipe('image.phash16')).resolves.toEqual(created);
    await expect(repo.findByRecipe('nope')).resolves.toBeNull();
  });
});

describe('DrizzleAlgorithmRepository — race condition on add()', () => {
  it('throws when the insert is skipped (conflict) and the immediate re-select also finds nothing', async () => {
    // Simulates the narrow window where a concurrent insert's row hasn't committed/become
    // visible yet: onConflictDoNothing() skips (no row), and the immediate re-select races it.
    interface FakeChain {
      insert: () => FakeChain;
      values: () => FakeChain;
      onConflictDoNothing: () => FakeChain;
      returning: () => Promise<never[]>;
      select: () => FakeChain;
      from: () => FakeChain;
      where: () => FakeChain;
      limit: () => Promise<never[]>;
    }

    const chain: FakeChain = {
      insert: (): FakeChain => chain,
      values: (): FakeChain => chain,
      onConflictDoNothing: (): FakeChain => chain,
      returning: (): Promise<never[]> => Promise.resolve([]),
      select: (): FakeChain => chain,
      from: (): FakeChain => chain,
      where: (): FakeChain => chain,
      limit: (): Promise<never[]> => Promise.resolve([]),
    };
    const repo = new DrizzleAlgorithmRepository(chain as never);

    await expect(repo.add({ recipe: 'binary.sha256', comparison: Comparison.EXACT })).rejects.toThrow(
      /failed to resolve or create algorithm row/,
    );
  });
});
