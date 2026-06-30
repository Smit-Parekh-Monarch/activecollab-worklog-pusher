import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// shadcn/ui theme. IMPORTANT: preflight is OFF so Tailwind's base reset never
// touches the app's existing hand-written CSS pages. Colors map to NAMESPACED
// --sd-* variables (defined in app/shadcn.css) so they never clash with the
// app's own --primary / --border / etc. tokens in globals.css.
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--sd-border))',
        input: 'hsl(var(--sd-input))',
        ring: 'hsl(var(--sd-ring))',
        background: 'hsl(var(--sd-background))',
        foreground: 'hsl(var(--sd-foreground))',
        primary: { DEFAULT: 'hsl(var(--sd-primary))', foreground: 'hsl(var(--sd-primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--sd-secondary))', foreground: 'hsl(var(--sd-secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--sd-destructive))', foreground: 'hsl(var(--sd-destructive-foreground))' },
        success: { DEFAULT: 'hsl(var(--sd-success))', foreground: 'hsl(var(--sd-success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--sd-warning))', foreground: 'hsl(var(--sd-warning-foreground))' },
        muted: { DEFAULT: 'hsl(var(--sd-muted))', foreground: 'hsl(var(--sd-muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--sd-accent))', foreground: 'hsl(var(--sd-accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--sd-card))', foreground: 'hsl(var(--sd-card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--sd-popover))', foreground: 'hsl(var(--sd-popover-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};
export default config;
