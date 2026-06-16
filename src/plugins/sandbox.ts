/**
 * @deprecated Use error-containment.ts. This module is NOT a sandbox or
 * security boundary; it only preserves the legacy import path.
 */
export {
  runPluginWithErrorContainment as runPluginSandbox,
  type PluginErrorContainmentOptions as PluginSandboxOptions,
  type PluginErrorContainmentResult as PluginSandboxResult,
} from './error-containment.ts';
