import type { MenuItem } from '../routes/menu/model.ts';

const items: MenuItem[] = [
  { path: '/hub', label: 'Hub', group: 'main', order: 45, source: 'page' },
  { path: '/feed', label: 'Feed', group: 'tools', order: 74, source: 'page', studio: 'feed.buildwithoracle.com' },
  { path: '/schedule', label: 'Schedule', group: 'tools', order: 75, source: 'page', studio: 'schedule.buildwithoracle.com' },
  { path: '/canvas', label: 'Canvas', group: 'tools', order: 80, source: 'page', studio: 'canvas.buildwithoracle.com' },
  { path: '/planets', label: 'Planets', group: 'tools', order: 81, source: 'page', studio: 'canvas.buildwithoracle.com', query: { plugin: 'planets' } },
  { path: '/map', label: 'Map', group: 'tools', order: 82, source: 'page', studio: 'canvas.buildwithoracle.com', query: { plugin: 'map' } },
  { path: '/compare', label: 'Compare', group: 'tools', order: 83, source: 'page' },
  { path: '/evolution', label: 'Evolution', group: 'tools', order: 84, source: 'page' },
  { path: '/settings', label: 'Settings', group: 'hidden', order: 99, source: 'page' },
];

export default items;
