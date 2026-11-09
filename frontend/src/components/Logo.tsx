import clsx from 'clsx';
import { BRAND } from '../lib/brand';

/** Logo do produto (arquivo em public/brand/logo.svg). */
export default function Logo({ className }: { className?: string }) {
  return <img src={BRAND.logo} alt={BRAND.name} className={clsx('shrink-0 rounded-xl object-contain', className)} draggable={false} />;
}
