import { Elysia } from 'elysia';
import { getScopedSetting, setScopedSetting } from '../../db/scoped-settings.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import { UpdateSettingsBody } from './model.ts';

export const updateSettingsRoute = new Elysia().post('/', async ({ body, set }) => {
  if (body.newPassword) {
    const existingHash = getScopedSetting('auth_password_hash');
    if (existingHash) {
      if (!body.currentPassword) {
        set.status = 400;
        return { error: 'Current password required' };
      }
      const valid = await Bun.password.verify(body.currentPassword, existingHash);
      if (!valid) {
        set.status = 401;
        return { error: 'Current password is incorrect' };
      }
    }
    const hash = await Bun.password.hash(body.newPassword);
    setScopedSetting('auth_password_hash', hash);
  }

  if (body.removePassword === true) {
    const existingHash = getScopedSetting('auth_password_hash');
    if (existingHash && body.currentPassword) {
      const valid = await Bun.password.verify(body.currentPassword, existingHash);
      if (!valid) {
        set.status = 401;
        return { error: 'Current password is incorrect' };
      }
    }
    setScopedSetting('auth_password_hash', null);
    setScopedSetting('auth_enabled', 'false');
  }

  if (typeof body.authEnabled === 'boolean') {
    if (body.authEnabled && !getScopedSetting('auth_password_hash')) {
      set.status = 400;
      return { error: 'Cannot enable auth without password' };
    }
    setScopedSetting('auth_enabled', body.authEnabled ? 'true' : 'false');
  }

  if (typeof body.localBypass === 'boolean') {
    setScopedSetting('auth_local_bypass', body.localBypass ? 'true' : 'false');
  }

  return {
    success: true,
    authEnabled: getScopedSetting('auth_enabled') === 'true',
    localBypass: getScopedSetting('auth_local_bypass') !== 'false',
    hasPassword: !!getScopedSetting('auth_password_hash'),
    tenantId: activeTenantId(),
  };
}, {
  body: UpdateSettingsBody,
  detail: {
    tags: ['settings'],
    menu: { group: 'hidden' },
    summary: 'Update oracle settings',
  },
});
