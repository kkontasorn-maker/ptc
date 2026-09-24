import express from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { requireItAdmin } from '../auth/access.js';
import {
  parseRouteId,
  validateLandingBlockCreate,
  validateLandingBlockPatch,
  validateLandingBlockReorder,
} from '../validate.js';

function presentBlock(block) {
  return {
    id: block.id,
    block_type: block.block_type,
    position: block.position,
    content: block.content,
    visible: block.visible,
    created_at: block.created_at,
    updated_at: block.updated_at,
  };
}

export function createLandingPageRoutes({ repos }) {
  const router = express.Router();

  router.get('/landing-page/blocks', (req, res) => {
    res.json({ blocks: repos.landingPage.listVisible().map(presentBlock) });
  });

  router.get('/admin/landing-page/blocks', requireItAdmin, (req, res) => {
    res.json({ blocks: repos.landingPage.listAll().map(presentBlock) });
  });

  router.post('/admin/landing-page/blocks', requireItAdmin, (req, res) => {
    const input = validateLandingBlockCreate(req.body);
    const position = Object.prototype.hasOwnProperty.call(input, 'position')
      ? input.position
      : repos.landingPage.nextPosition();
    try {
      const block = repos.landingPage.create({
        block_type: input.block_type,
        content: input.content,
        position,
        visible: input.visible,
      });
      res.status(201).json({ block: presentBlock(block) });
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('Another block already uses that position');
      }
      throw error;
    }
  });

  // Register before /:id so "reorder" is not parsed as an id.
  router.patch('/admin/landing-page/blocks/reorder', requireItAdmin, (req, res) => {
    const { ordered_ids: orderedIds } = validateLandingBlockReorder(req.body);
    const result = repos.landingPage.reorder(orderedIds);
    if (result.mismatch) {
      throw new ValidationError(
        'ordered_ids must list every landing-page block exactly once',
        [{ field: 'ordered_ids', message: 'ordered_ids must list every landing-page block exactly once' }],
      );
    }
    res.json({ blocks: result.blocks.map(presentBlock) });
  });

  router.patch('/admin/landing-page/blocks/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Block id');
    const existing = repos.landingPage.findById(id);
    if (!existing) throw new NotFoundError('Block not found');
    const patch = validateLandingBlockPatch(req.body, existing.block_type);
    try {
      const block = repos.landingPage.update(id, patch);
      if (!block) throw new NotFoundError('Block not found');
      res.json({ block: presentBlock(block) });
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('Another block already uses that position');
      }
      throw error;
    }
  });

  router.delete('/admin/landing-page/blocks/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Block id');
    if (!repos.landingPage.delete(id)) {
      throw new NotFoundError('Block not found');
    }
    res.json({ ok: true });
  });

  return router;
}
