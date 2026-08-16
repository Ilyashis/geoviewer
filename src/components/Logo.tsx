import { useId } from 'react';

interface Props {
  size?: number;
  className?: string;
}

/** Brand mark — three stacked, gradient-faded layers. Gradient ids are
 * per-instance (useId) since the mark renders twice at once (topbar +
 * welcome screen) and duplicate SVG ids would make both instances share
 * whichever <defs> the browser resolves first. */
export function Logo({ size = 24, className }: Props) {
  const uid = useId().replace(/:/g, '');
  const g0 = `logo-g0-${uid}`;
  const g1 = `logo-g1-${uid}`;
  const g2 = `logo-g2-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M2.20844 17.3634C1.19487 16.7384 1.19487 15.2647 2.20844 14.6397L11.1602 9.11945C11.675 8.80195 12.325 8.80195 12.8398 9.11945L21.7916 14.6397C22.8051 15.2647 22.8051 16.7384 21.7916 17.3634L12.8398 22.8837C12.325 23.2012 11.675 23.2012 11.1602 22.8837L2.20844 17.3634Z" fill={`url(#${g0})`} />
      <path d="M21.7916 13.3634C22.8051 12.7384 22.8051 11.2647 21.7916 10.6397L12.8398 5.11945C12.325 4.80195 11.675 4.80195 11.1602 5.11945L2.20844 10.6397C1.19487 11.2647 1.19487 12.7384 2.20844 13.3634L11.1602 18.8837C11.675 19.2012 12.325 19.2012 12.8398 18.8837L21.7916 13.3634Z" fill={`url(#${g1})`} />
      <path d="M2.20844 9.36344C1.19487 8.7384 1.19487 7.26473 2.20844 6.63969L11.1602 1.11945C11.675 0.80195 12.325 0.801951 12.8398 1.11945L21.7916 6.63969C22.8051 7.26473 22.8051 8.7384 21.7916 9.36344L12.8398 14.8837C12.325 15.2012 11.675 15.2012 11.1602 14.8837L2.20844 9.36344Z" fill={`url(#${g2})`} />
      <defs>
        <linearGradient id={g0} x1="18.6" y1="19.8516" x2="11.25" y2="8.20156" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D9D9D9" />
          <stop offset="1" stopColor="#D9D9D9" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={g1} x1="5.4" y1="15.8516" x2="12.75" y2="4.20156" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D9D9D9" />
          <stop offset="1" stopColor="#D9D9D9" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={g2} x1="18.6" y1="11.8516" x2="11.25" y2="0.201563" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D9D9D9" />
          <stop offset="1" stopColor="#D9D9D9" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
