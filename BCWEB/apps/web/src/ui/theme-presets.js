// Accent presets for the site theme.
//
// ABOUT THE PANTONE NAMES: Pantone's colour libraries are proprietary and the exact sRGB
// coordinates are licensed data. These are the widely-published approximations of each
// Color of the Year, used here as NAMES and starting points — they are not, and must not be
// presented as, official Pantone values. Anything colour-critical (print, brand compliance)
// needs a real Pantone reference, not this file.
//
// Each preset carries two colours because .btn-primary and the page glows fill with a
// gradient of the pair. Where Pantone named a single colour, the second is a hand-picked
// neighbour of the same family rather than a second official colour.
export const THEME_PRESETS = [
  { id: 'bcw', name: 'BetterCommunity', sub: 'Default', accent: '#f97316', accent2: '#f59e0b' },

  { id: 'coty-2000', name: 'Cerulean', sub: 'Color of the Year 2000', accent: '#98b2d1', accent2: '#7f9ec4' },
  { id: 'coty-2005', name: 'Blue Turquoise', sub: '2005', accent: '#55b4b0', accent2: '#3f9e9a' },
  { id: 'coty-2012', name: 'Tangerine Tango', sub: '2012', accent: '#dd4124', accent2: '#c2361b' },
  { id: 'coty-2016', name: 'Rose Quartz + Serenity', sub: '2016', accent: '#f7cac9', accent2: '#92a8d1' },
  { id: 'coty-2019', name: 'Living Coral', sub: '2019', accent: '#ff6f61', accent2: '#ff8f7a' },
  { id: 'coty-2020', name: 'Classic Blue', sub: '2020', accent: '#0f4c81', accent2: '#1a6ba8' },
  { id: 'coty-2021', name: 'Illuminating + Ultimate Gray', sub: '2021', accent: '#f5df4d', accent2: '#939597' },
  { id: 'coty-2022', name: 'Very Peri', sub: '2022', accent: '#6667ab', accent2: '#8586c4' },
  { id: 'coty-2023', name: 'Viva Magenta', sub: '2023', accent: '#be3455', accent2: '#d9556f' },
  { id: 'coty-2024', name: 'Peach Fuzz', sub: '2024', accent: '#ffbe98', accent2: '#ffd0b3' },
  { id: 'coty-2025', name: 'Mocha Mousse', sub: '2025', accent: '#a47864', accent2: '#bf9483' },
];
