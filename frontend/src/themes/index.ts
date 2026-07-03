import { registerTheme } from './registry';
import { oracleDefault } from './oracle-default';
import { midnightTeal } from './midnight-teal';
import { emeraldNoir } from './emerald-noir';
import { sakura } from './sakura';
import { copperSlate } from './copper-slate';
import { forestMoss } from './forest-moss';
import { lavenderMist } from './lavender-mist';
import { neonSynthwave } from './neon-synthwave';
import { crimsonNight } from './crimson-night';
import { solarAmber } from './solar-amber';
import { oceanDepth } from './ocean-depth';

registerTheme(oracleDefault);
registerTheme(midnightTeal);
registerTheme(emeraldNoir);
registerTheme(sakura);
registerTheme(copperSlate);
registerTheme(forestMoss);
registerTheme(lavenderMist);
registerTheme(neonSynthwave);
registerTheme(crimsonNight);
registerTheme(solarAmber);
registerTheme(oceanDepth);

export { getThemes, getTheme, DEFAULT_THEME_ID } from './registry';
export type { ThemeDefinition, ThemeTokens } from './types';
