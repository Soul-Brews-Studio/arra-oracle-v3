/**
 * Settings Routes — /api/settings (GET + POST)
 */

import type { Hono } from 'hono';
import { getSetting, setSetting } from '../db/index.ts';

export function registerSettingsRoutes(app: Hono) {
  // Get settings (no password hash exposed)
  app.get('/api/settings', (c) => {
    const authEnabled = getSetting('auth_enabled') === 'true';
    const localBypass = getSetting('auth_local_bypass') !== 'false';
    const hasPassword = !!getSetting('auth_password_hash');
    const vaultRepo = getSetting('vault_repo');

    return c.json({
      authEnabled,
      localBypass,
      hasPassword,
      vaultRepo
    });
  });

  // Update settings
  app.post('/api/settings', async (c) => {
    const body = await c.req.json();

    // Handle password change
    if (body.newPassword) {
      const existingHash = getSetting('auth_password_hash');
      if (existingHash) {
        if (!body.currentPassword) {
          return c.json({ error: 'Current password required' }, 400);
        }
        const valid = await Bun.password.verify(body.currentPassword, existingHash);
        if (!valid) {
          return c.json({ error: 'Current password is incorrect' }, 401);
        }
      }

      const hash = await Bun.password.hash(body.newPassword);
      setSetting('auth_password_hash', hash);
    }

    // Handle removing password
    if (body.removePassword === true) {
      const existingHash = getSetting('auth_password_hash');
      if (existingHash && body.currentPassword) {
        const valid = await Bun.password.verify(body.currentPassword, existingHash);
        if (!valid) {
          return c.json({ error: 'Current password is incorrect' }, 401);
        }
      }
      setSetting('auth_password_hash', null);
      setSetting('auth_enabled', 'false');
    }

    // Handle auth enabled toggle
    if (typeof body.authEnabled === 'boolean') {
      if (body.authEnabled && !getSetting('auth_password_hash')) {
        return c.json({ error: 'Cannot enable auth without password' }, 400);
      }
      setSetting('auth_enabled', body.authEnabled ? 'true' : 'false');
    }

    // Handle local bypass toggle
    if (typeof body.localBypass === 'boolean') {
      setSetting('auth_local_bypass', body.localBypass ? 'true' : 'false');
    }

    return c.json({
      success: true,
      authEnabled: getSetting('auth_enabled') === 'true',
      localBypass: getSetting('auth_local_bypass') !== 'false',
      hasPassword: !!getSetting('auth_password_hash')
    });
  });
}
