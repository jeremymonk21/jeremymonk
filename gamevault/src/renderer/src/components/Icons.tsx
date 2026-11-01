import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function base(size = 18, props: P, children: React.ReactNode): JSX.Element {
  const { size: _s, ...rest } = props
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export const IconGrid = (p: P): JSX.Element => base(p.size, p, <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>)
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }): JSX.Element =>
  base(p.size, p, <path fill={filled ? 'currentColor' : 'none'} d="M12 20.5s-7.5-4.6-9.5-9.3C1.2 8 3.2 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.5 0 5.5 3.5 4.2 6.7-2 4.7-9.5 9.3-9.5 9.3z" />)
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }): JSX.Element =>
  base(p.size, { ...p, strokeWidth: 1.6 }, <path fill={filled ? 'currentColor' : 'none'} d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z" />)
export const IconPlus = (p: P): JSX.Element => base(p.size, p, <><path d="M12 5v14M5 12h14" /></>)
export const IconSearch = (p: P): JSX.Element => base(p.size, p, <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>)
export const IconX = (p: P): JSX.Element => base(p.size, p, <path d="M6 6l12 12M18 6L6 18" />)
export const IconBack = (p: P): JSX.Element => base(p.size, p, <path d="M15 18l-6-6 6-6" />)
export const IconPlay = (p: P): JSX.Element => base(p.size, p, <path fill="currentColor" stroke="none" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />)
export const IconEdit = (p: P): JSX.Element => base(p.size, p, <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></>)
export const IconTrash = (p: P): JSX.Element => base(p.size, p, <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>)
export const IconSettings = (p: P): JSX.Element =>
  base(p.size, p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const IconMonitor = (p: P): JSX.Element => base(p.size, p, <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>)
export const IconGamepad = (p: P): JSX.Element =>
  base(p.size, p, <><path d="M6 8h12a4 4 0 0 1 3.9 4.9l-1 4.2a2.5 2.5 0 0 1-4.3 1.1L14.5 16h-5l-2.1 2.2a2.5 2.5 0 0 1-4.3-1.1l-1-4.2A4 4 0 0 1 6 8z" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="16" cy="11.5" r=".6" fill="currentColor" /><circle cx="17.5" cy="13.5" r=".6" fill="currentColor" /></>)
export const IconHandheld = (p: P): JSX.Element => base(p.size, p, <><rect x="2" y="6" width="20" height="12" rx="4" /><rect x="7" y="9" width="10" height="6" rx="1" /></>)
export const IconDisc = (p: P): JSX.Element => base(p.size, p, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></>)
export const IconCloud = (p: P): JSX.Element => base(p.size, p, <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5z" />)
export const IconImage = (p: P): JSX.Element => base(p.size, p, <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>)
export const IconUpload = (p: P): JSX.Element => base(p.size, p, <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>)
export const IconDownload = (p: P): JSX.Element => base(p.size, p, <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>)
export const IconFolder = (p: P): JSX.Element => base(p.size, p, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const IconCheck = (p: P): JSX.Element => base(p.size, p, <path d="M5 12.5l4.5 4.5L19 7.5" />)
export const IconAlert = (p: P): JSX.Element => base(p.size, p, <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></>)
export const IconInfo = (p: P): JSX.Element => base(p.size, p, <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>)
export const IconSort = (p: P): JSX.Element => base(p.size, p, <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />)
export const IconChevron = (p: P): JSX.Element => base(p.size, p, <path d="M6 9l6 6 6-6" />)
export const IconTag = (p: P): JSX.Element => base(p.size, p, <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>)
export const IconSteam = (p: P): JSX.Element =>
  base(p.size, p, <><circle cx="12" cy="12" r="9" /><circle cx="15.5" cy="9.5" r="2.5" /><circle cx="9" cy="15.5" r="1.8" /><path d="M13.5 11l-3 3" /></>)
export const IconRefresh = (p: P): JSX.Element => base(p.size, p, <><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4" /></>)
export const IconLink = (p: P): JSX.Element => base(p.size, p, <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>)
export const IconLock = (p: P): JSX.Element => base(p.size, p, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
export const IconFilter = (p: P): JSX.Element => base(p.size, p, <path d="M4 5h16l-6 8v5l-4 2v-7z" />)
