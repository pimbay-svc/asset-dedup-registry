/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../../infrastructure/container.js';
import { ApiScope } from '../../../domain/model/apiClient.model.js';
import { AddAsset, DeleteAsset } from '../../../application/command/asset.command.js';
import { Identity } from '../../../domain/model/asset.model.js';
import { requireScope } from '../auth.js';
import { sendErrorResponse } from '../errorResponse.js';
import { mapIdentity } from '../mapping.js';
import {
  addAssetBodySchema,
  deleteAssetBodySchema,
  assetRecipesQuerySchema,
  addAssetResponseSchema,
  assetRecipesResponseSchema,
} from './schema/asset.schema.js';
import type { MimeHintType } from '../../../domain/model/asset.model.js';

interface IdentityDto {
  id?: string;
  path?: string;
}

interface AddAssetBody {
  identity: IdentityDto;
  mime_hint: { type: MimeHintType; value: string };
  file_content: string;
}

interface DeleteAssetBody {
  identity: IdentityDto;
}

interface AssetRecipesQuery {
  id?: string;
  path?: string;
}

export function registerAssetsRoutes(app: FastifyInstance, cradle: Cradle): void {
  app.post<{ Body: AddAssetBody }>(
    '/assets',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_WRITE),
      schema: {
        body: addAssetBodySchema,
        response: { 200: addAssetResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { identity, mime_hint: mimeHint, file_content: fileContent } = request.body;

        const result = await cradle.commandGateway.dispatch(
          new AddAsset(request.projectId, identity.id ?? null, identity.path ?? null, mimeHint, fileContent),
        );

        return await reply.status(200).send({ identity: mapIdentity(result.identity), results: result.results });
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );

  app.delete<{ Body: DeleteAssetBody }>(
    '/assets',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_WRITE),
      schema: {
        body: deleteAssetBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const identity = new Identity(request.body.identity.id ?? null, request.body.identity.path ?? null);

        await cradle.commandGateway.dispatch(new DeleteAsset(request.projectId, identity));

        return await reply.status(204).send();
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );

  // Lets a caller (e.g. an admin UI) discover which recipes actually exist for a given asset
  // before calling /duplicates/matches — the registry has no way to predict this upfront (core
  // alone decides which recipes actually ran for a given file), so it's read back from what
  // was actually stored. Query params, not a `:id`-style path segment — `path` identities can
  // contain `/`, which a raw URL path segment can't safely carry.
  app.get<{ Querystring: AssetRecipesQuery }>(
    '/assets/recipes',
    {
      preHandler: requireScope(cradle.apiClients, ApiScope.ASSETS_READ),
      schema: {
        querystring: assetRecipesQuerySchema,
        response: { 200: assetRecipesResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const identity = new Identity(request.query.id ?? null, request.query.path ?? null);
        const recipes = await cradle.assets.listRecipes(request.projectId, identity);

        return await reply.status(200).send({ identity: mapIdentity(identity), recipes });
      } catch (err) {
        return await sendErrorResponse(request, reply, err);
      }
    },
  );
}
