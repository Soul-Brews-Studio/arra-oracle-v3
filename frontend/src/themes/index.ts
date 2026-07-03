import { registerTheme } from './registry';
import { oracleDefault } from './oracle-default';
import { midnightTeal } from './midnight-teal';
import { emeraldNoir } from './emerald-noir';
import { sakura } from './sakura';
import { lavenderMist } from './lavender-mist';

registerTheme(oracleDefault);
registerTheme(midnightTeal);
registerTheme(emeraldNoir);
registerTheme(sakura);
registerTheme(lavenderMist);

export { getThemes, getTheme, DEFAULT_THEME_ID } from './registry';
export type { ThemeDefinition, ThemeTokens } from './types';
