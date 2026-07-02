import { cn } from '@/lib/utils';

// Material Symbols icon. Renders the ligature name inside a span styled with the
// Material Symbols Outlined font (loaded in app/layout.tsx). Use the underscored
// symbol name, e.g. <Icon name="rocket_launch" />. `size` sets the optical size.
export function Icon({
  name,
  size,
  className,
  style,
  ...rest
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: any;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('ms', className)}
      style={size ? { fontSize: size, ...style } : style}
      {...rest}
    >
      {name}
    </span>
  );
}

export default Icon;
