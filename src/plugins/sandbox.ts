/**
 * @deprecated Use error-containment.ts.
 * Legacy compatibility module for plugin error containment only; it does not
 * create process isolation, VM boundaries, or any security boundary.
 */
export {
  runPluginWithErrorContainment as runPluginSandbox,
  type PluginErrorContainmentOptions as PluginSandboxOptions,
  type PluginErrorContainmentResult as PluginSandboxResult,
} from './error-containment.ts';
