import { Elysia } from 'elysia';
import { getScopedSetting } from '../../db/scoped-settings.ts';
import { activeTenantId } from '../../middleware/tenant.ts';

export const getSettingsRoute = new Elysia().get('/', () => {
  const authEnabled = getScopedSetting('auth_enabled') === 'true';
  const localBypass = getScopedSetting('auth_local_bypass') !== 'false';
  const hasPassword = !!getScopedSetting('auth_password_hash');
  const vaultRepo = getScopedSetting('vault_repo');
  return { authEnabled, localBypass, hasPassword, vaultRepo, tenantId: activeTenantId() };
}, {
  detail: {
    tags: ['settings'],
    menu: { group: 'hidden' },
    summary: 'Read oracle settings',
  },
});
