// ══════════════════════════════════════════════════════════
//  Design System — CashTop
// ══════════════════════════════════════════════════════════

export const Colors = {
  // Primary
  primary:      '#1E3A5F',
  primaryLight: '#2D5187',
  primaryDark:  '#152C4A',

  // Accent
  accent:       '#F59E0B',
  accentLight:  '#FCD34D',

  // Semantic
  success:      '#10B981',
  successLight: '#D1FAE5',
  danger:       '#EF4444',
  dangerLight:  '#FEE2E2',
  warning:      '#F59E0B',
  warningLight: '#FEF3C7',
  info:         '#3B82F6',
  infoLight:    '#DBEAFE',

  // Neutrals
  white:        '#FFFFFF',
  black:        '#000000',
  gray50:       '#F9FAFB',
  gray100:      '#F3F4F6',
  gray200:      '#E5E7EB',
  gray300:      '#D1D5DB',
  gray400:      '#9CA3AF',
  gray500:      '#6B7280',
  gray600:      '#4B5563',
  gray700:      '#374151',
  gray800:      '#1F2937',
  gray900:      '#111827',

  // Background
  background:   '#F8FAFC',
  card:         '#FFFFFF',
  border:       '#E5E7EB',

  // Tab bar
  tabActive:    '#1E3A5F',
  tabInactive:  '#9CA3AF',
} as const;

export const Fonts = {
  regular:      'System',
  medium:       'System',
  bold:         'System',
  sizes: {
    xs:   11,
    sm:   13,
    base: 15,
    lg:   17,
    xl:   20,
    '2xl': 24,
    '3xl': 30,
  },
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export const Radius = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   18,
  '2xl': 24,
  full: 9999,
} as const;

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;
