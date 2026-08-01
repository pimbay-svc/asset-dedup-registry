/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
const THRESHOLD_PATTERN = '^[0-9]{1,3}(\\.[0-9]{1,2})?$';
const POSITIVE_INT_PATTERN = '^[0-9]+$';

const PAGE_QUERY_PROPS = {
  page: { type: 'string', pattern: POSITIVE_INT_PATTERN },
  page_size: { type: 'string', pattern: POSITIVE_INT_PATTERN },
} as const;

const IDENTITY_QUERY_PROPS = {
  id: { type: 'string', minLength: 1 },
  path: { type: 'string', minLength: 1 },
} as const;

/** Response identity — always both fields present, `null` on whichever side wasn't set. */
const IDENTITY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: ['string', 'null'] },
    path: { type: ['string', 'null'] },
  },
} as const;

const MATCH_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    identity: IDENTITY_RESPONSE_SCHEMA,
    distance: { type: 'number' },
    similarity: { type: 'number' },
  },
} as const;

function paginatedResponseSchema<T>(itemsSchema: T): {
  type: 'object';
  properties: {
    data: { type: 'array'; items: T };
    total_count: { type: 'number' };
    current_count: { type: 'number' };
    current_page: { type: 'number' };
    page_size: { type: 'number' };
    page_count: { type: 'number' };
    has_next_page: { type: 'boolean' };
    has_previous_page: { type: 'boolean' };
  };
} {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemsSchema },
      total_count: { type: 'number' },
      current_count: { type: 'number' },
      current_page: { type: 'number' },
      page_size: { type: 'number' },
      page_count: { type: 'number' },
      has_next_page: { type: 'boolean' },
      has_previous_page: { type: 'boolean' },
    },
  };
}

export const matchesQuerySchema = {
  type: 'object',
  required: ['recipe'],
  properties: {
    ...IDENTITY_QUERY_PROPS,
    recipe: { type: 'string', minLength: 1 },
    threshold: { type: 'string', pattern: THRESHOLD_PATTERN },
    ...PAGE_QUERY_PROPS,
  },
  anyOf: [{ required: ['id'] }, { required: ['path'] }],
} as const;

export const clustersQuerySchema = {
  type: 'object',
  required: ['recipe'],
  properties: {
    recipe: { type: 'string', minLength: 1 },
    threshold: { type: 'string', pattern: THRESHOLD_PATTERN },
    generation: { type: 'string', pattern: POSITIVE_INT_PATTERN },
    ...PAGE_QUERY_PROPS,
    ...IDENTITY_QUERY_PROPS,
  },
} as const;

export const rankingQuerySchema = {
  type: 'object',
  required: ['recipe'],
  properties: {
    recipe: { type: 'string', minLength: 1 },
    threshold: { type: 'string', pattern: THRESHOLD_PATTERN },
    ...PAGE_QUERY_PROPS,
    match_limit: { type: 'string', pattern: POSITIVE_INT_PATTERN },
    ...IDENTITY_QUERY_PROPS,
  },
} as const;

export const matchesResponseSchema = paginatedResponseSchema(MATCH_ITEM_SCHEMA);

const CLUSTER_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    cluster_id: { type: 'string' },
    max_similarity: { type: 'number' },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          identity: IDENTITY_RESPONSE_SCHEMA,
          avg_similarity_to_cluster: { type: 'number' },
        },
      },
    },
  },
} as const;

const CLUSTERS_BASE_RESPONSE_SCHEMA = paginatedResponseSchema(CLUSTER_ITEM_SCHEMA);

export const clustersResponseSchema = {
  ...CLUSTERS_BASE_RESPONSE_SCHEMA,
  properties: {
    ...CLUSTERS_BASE_RESPONSE_SCHEMA.properties,
    // Pass this back as `?generation=` on the next page's request to keep reading this exact snapshot —
    // see ClustersQuery.generation.
    generation: { type: 'number' },
  },
} as const;

export const rankingResponseSchema = paginatedResponseSchema({
  type: 'object',
  properties: {
    identity: IDENTITY_RESPONSE_SCHEMA,
    duplicate_count: { type: 'number' },
    matches: { type: 'array', items: MATCH_ITEM_SCHEMA },
  },
} as const);
