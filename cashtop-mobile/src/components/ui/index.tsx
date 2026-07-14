import React from 'react';
import {
  TouchableOpacity, Text, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle, View,
  TextInput, TextInputProps,
} from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../types/theme';

// ══════════════════════════════════════════════════════════
//  Button
// ══════════════════════════════════════════════════════════

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title, onPress, variant = 'primary', size = 'md',
  loading, disabled, icon, style, fullWidth = false,
}) => {
  const bg: Record<string, string> = {
    primary:   Colors.primary,
    secondary: Colors.gray100,
    danger:    Colors.danger,
    ghost:     'transparent',
    success:   Colors.success,
  };

  const tc: Record<string, string> = {
    primary:   Colors.white,
    secondary: Colors.gray700,
    danger:    Colors.white,
    ghost:     Colors.primary,
    success:   Colors.white,
  };

  const pad: Record<string, { h: number; v: number }> = {
    sm:  { h: 12, v: 7 },
    md:  { h: 20, v: 12 },
    lg:  { h: 28, v: 16 },
  };

  const fs: Record<string, number> = { sm: 13, md: 15, lg: 17 };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        {
          backgroundColor: disabled ? Colors.gray300 : bg[variant],
          paddingHorizontal: pad[size].h,
          paddingVertical: pad[size].v,
          borderRadius: Radius.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          ...(fullWidth && { width: '100%' }),
          ...(variant === 'ghost' && { borderWidth: 1.5, borderColor: Colors.primary }),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tc[variant]} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ color: tc[variant], fontSize: fs[size], fontWeight: '700' }}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

// ══════════════════════════════════════════════════════════
//  Input
// ══════════════════════════════════════════════════════════

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
  label, error, leftIcon, rightIcon, containerStyle, style, ...props
}) => (
  <View style={[{ marginBottom: Spacing.md }, containerStyle]}>
    {label && (
      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.gray600,
                     marginBottom: 6, textAlign: 'right' }}>
        {label}
      </Text>
    )}
    <View style={{
      flexDirection: 'row-reverse',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: error ? Colors.danger : Colors.gray200,
      borderRadius: Radius.md,
      backgroundColor: Colors.white,
      paddingHorizontal: Spacing.md,
      ...Shadow.sm,
    }}>
      {leftIcon  && <View style={{ marginLeft: 8 }}>{leftIcon}</View>}
      <TextInput
        style={[{
          flex: 1,
          paddingVertical: Spacing.md,
          fontSize: Fonts.sizes.base,
          color: Colors.gray800,
          textAlign: 'right',
        }, style]}
        placeholderTextColor={Colors.gray400}
        {...props}
      />
      {rightIcon && <View style={{ marginRight: 8 }}>{rightIcon}</View>}
    </View>
    {error && (
      <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 4, textAlign: 'right' }}>
        {error}
      </Text>
    )}
  </View>
);

// ══════════════════════════════════════════════════════════
//  Card
// ══════════════════════════════════════════════════════════

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
}

export const Card: React.FC<CardProps> = ({ children, style, padding = Spacing.lg }) => (
  <View style={[{
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding,
    ...Shadow.sm,
  }, style]}>
    {children}
  </View>
);

// ══════════════════════════════════════════════════════════
//  Badge
// ══════════════════════════════════════════════════════════

interface BadgeProps {
  label: string;
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
  size?: 'sm' | 'md';
}

const badgeColors = {
  green:  { bg: Colors.successLight, text: Colors.success },
  red:    { bg: Colors.dangerLight,  text: Colors.danger  },
  yellow: { bg: Colors.warningLight, text: '#B45309'      },
  blue:   { bg: Colors.infoLight,    text: Colors.info    },
  gray:   { bg: Colors.gray100,      text: Colors.gray500 },
};

export const Badge: React.FC<BadgeProps> = ({ label, color = 'gray', size = 'sm' }) => {
  const c = badgeColors[color];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: Radius.full,
                   paddingHorizontal: size === 'sm' ? 8 : 12,
                   paddingVertical:   size === 'sm' ? 3 : 5 }}>
      <Text style={{ color: c.text, fontSize: size === 'sm' ? 11 : 13, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
};

// ══════════════════════════════════════════════════════════
//  StatCard
// ══════════════════════════════════════════════════════════

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  change?: number;    // نسبة التغيير %
  color?: string;
  style?: ViewStyle;
}

export const StatCard: React.FC<StatCardProps> = ({
  title, value, subtitle, change, color = Colors.primary, style,
}) => (
  <Card style={[{ flex: 1, minWidth: 140 }, style]}>
    <Text style={{ fontSize: 12, color: Colors.gray500, fontWeight: '500',
                   textAlign: 'right', marginBottom: 4 }}>
      {title}
    </Text>
    <Text style={{ fontSize: 22, fontWeight: '800', color, textAlign: 'right' }}>
      {value}
    </Text>
    {subtitle && (
      <Text style={{ fontSize: 11, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
        {subtitle}
      </Text>
    )}
    {change !== undefined && (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
                     marginTop: 4, gap: 3 }}>
        <Text style={{ fontSize: 12, fontWeight: '600',
                       color: change >= 0 ? Colors.success : Colors.danger }}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
        </Text>
        <Text style={{ fontSize: 11, color: Colors.gray400 }}>مقارنة بالأمس</Text>
      </View>
    )}
  </Card>
);

// ══════════════════════════════════════════════════════════
//  EmptyState
// ══════════════════════════════════════════════════════════

export const EmptyState: React.FC<{ icon: string; title: string; subtitle?: string }> = ({
  icon, title, subtitle,
}) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
    <Text style={{ fontSize: 56, marginBottom: 16 }}>{icon}</Text>
    <Text style={{ fontSize: 17, fontWeight: '700', color: Colors.gray700,
                   textAlign: 'center', marginBottom: 8 }}>
      {title}
    </Text>
    {subtitle && (
      <Text style={{ fontSize: 14, color: Colors.gray400, textAlign: 'center' }}>
        {subtitle}
      </Text>
    )}
  </View>
);

// ══════════════════════════════════════════════════════════
//  LoadingScreen
// ══════════════════════════════════════════════════════════

export const LoadingScreen: React.FC<{ message?: string }> = ({ message }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: Colors.background }}>
    <ActivityIndicator size="large" color={Colors.primary} />
    {message && (
      <Text style={{ marginTop: 16, color: Colors.gray500, fontSize: 15 }}>
        {message}
      </Text>
    )}
  </View>
);
