import mark from '../assets/brand/mark.svg';
import inverseMark from '../assets/brand/mark-inverse.svg';

/** One source asset for the app mark across light and dark surfaces. */
export function BrandMark({ inverse = false, size = 24, className = '', label }: { inverse?: boolean; size?: number; className?: string; label?: string }) {
  return <img className={`ovd-brand-mark${className ? ` ${className}` : ''}`} src={inverse ? inverseMark : mark} width={size} height={size} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} />;
}
