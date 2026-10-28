import mark from '../assets/brand/ovd-symbol-primary.svg';
import inverseMark from '../assets/brand/ovd-symbol-inverse.svg';
import appMark from '../assets/brand/ovd-app-violet.svg';

/** One source asset for the app mark across light and dark surfaces. */
export function BrandMark({ inverse = false, variant = 'symbol', size = 48, className = '', label }: { inverse?: boolean; variant?: 'symbol' | 'app'; size?: number; className?: string; label?: string }) {
  const height = variant === 'app' ? size : size * 266 / 717;
  return <img className={`ovd-brand-mark${className ? ` ${className}` : ''}`} src={variant === 'app' ? appMark : inverse ? inverseMark : mark} width={size} height={height} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} />;
}
