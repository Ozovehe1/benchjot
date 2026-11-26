// The app's icons: one family, drawn on a 20-unit grid with a 1.6 stroke and round ends, in the
// text colour. Decorative by default (the words beside them carry the meaning); pass a `title`
// when an icon stands alone.
import { cn } from "@/lib/ui/format";

type IconProps = { className?: string; title?: string };

function Icon({ className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-[18px] shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

const make = (paths: React.ReactNode) =>
  function NamedIcon(p: IconProps) {
    return <Icon {...p}>{paths}</Icon>;
  };

export const IconPlus = make(<path d="M10 4.5v11M4.5 10h11" />);
export const IconUpload = make(<><path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" /><path d="M4 13.5v1A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-1" /></>);
export const IconSearch = make(<><circle cx="8.75" cy="8.75" r="5" /><path d="m12.5 12.5 3.5 3.5" /></>);
export const IconFolder = make(<path d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h2.6l1.6 1.75h5.3a1.75 1.75 0 0 1 1.75 1.75v6.25A1.75 1.75 0 0 1 14.75 16H5.25A1.75 1.75 0 0 1 3.5 14.25Z" />);
export const IconNote = make(<><path d="M6 3.5h6l3 3v9.25c0 .41-.34.75-.75.75h-8.5a.75.75 0 0 1-.75-.75V4.25c0-.41.34-.75.75-.75Z" /><path d="M11.75 3.5V7H15M7.75 10.5h4.5M7.75 13.25h3" /></>);
export const IconCode = make(<path d="m7 6.5-3.5 3.5L7 13.5M13 6.5l3.5 3.5-3.5 3.5" />);
export const IconPlay = make(<path d="M6.5 4.75v10.5L15 10Z" />);
export const IconServer = make(<><rect x="3.5" y="4" width="13" height="5" rx="1.25" /><rect x="3.5" y="11" width="13" height="5" rx="1.25" /><path d="M6.5 6.5h.01M6.5 13.5h.01" /></>);
export const IconStop = make(<rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />);
export const IconChat = make(<path d="M4 5.75C4 4.78 4.78 4 5.75 4h8.5C15.22 4 16 4.78 16 5.75v5.5c0 .97-.78 1.75-1.75 1.75H9.5L6 15.75V13h-.25C4.78 13 4 12.22 4 11.25Z" />);
export const IconEye = make(<><path d="M2.75 10S5.5 4.75 10 4.75 17.25 10 17.25 10 14.5 15.25 10 15.25 2.75 10 2.75 10Z" /><circle cx="10" cy="10" r="2.25" /></>);
export const IconPen = make(<path d="m12.5 4.5 3 3L7.75 15.25 4 16l.75-3.75Z" />);
export const IconMap = make(<><circle cx="5.5" cy="6" r="2" /><circle cx="14.5" cy="5.5" r="2" /><circle cx="10.5" cy="14.5" r="2" /><path d="M7.4 6.4 12.5 5.8M6.6 7.7l2.8 5.1M13.6 7.3l-2.1 5.4" /></>);
export const IconSettings = make(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.75v2M10 15.25v2M17.25 10h-2M4.75 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" /></>);
export const IconCopy = make(<><rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>);
export const IconDownload = make(<><path d="M10 4v9M6.5 9.5 10 13l3.5-3.5" /><path d="M4 13.5v1A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-1" /></>);
export const IconTrash = make(<><path d="M4 6h12M8 6V4.75c0-.41.34-.75.75-.75h2.5c.41 0 .75.34.75.75V6M5.5 6l.7 9.1c.06.79.72 1.4 1.5 1.4h4.6c.78 0 1.44-.61 1.5-1.4L14.5 6" /></>);
export const IconCheck = make(<path d="m4.75 10.5 3.25 3.25 7.25-7.5" />);
export const IconX = make(<path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />);
export const IconChevron = make(<path d="m8 5 5 5-5 5" />);
export const IconUndo = make(<><path d="M7 5.5 4 8.5l3 3" /><path d="M4 8.5h7.25a4.25 4.25 0 0 1 0 8.5H9" /></>);
export const IconMic = make(<><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" /></>);
export const IconSend = make(<path d="M4 10 16 4.5 12.5 16l-2.25-4.75Z" />);
export const IconLink = make(<><path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 0 0-4.24-4.24l-.7.7" /><path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.12 2.12a3 3 0 0 0 4.24 4.24l.7-.7" /></>);
export const IconBranch = make(<><circle cx="6" cy="5" r="1.75" /><circle cx="6" cy="15" r="1.75" /><circle cx="14" cy="8" r="1.75" /><path d="M6 6.75v6.5M14 9.75c0 2.5-3 2.75-8 3.75" /></>);
export const IconClock = make(<><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.25 1.5" /></>);
export const IconGlobe = make(<><circle cx="10" cy="10" r="7.25" /><path d="M2.75 10h14.5" /><path d="M10 2.75c2 2 3 4.4 3 7.25s-1 5.25-3 7.25c-2-2-3-4.4-3-7.25s1-5.25 3-7.25Z" /></>);
export const IconLock = make(<><rect x="4.25" y="9" width="11.5" height="8.25" rx="1.75" /><path d="M6.75 9V6.5a3.25 3.25 0 0 1 6.5 0V9" /></>);
// Topic icons for the reading pages' folders (one per subject, same grid and stroke).
export const IconShield = make(<><path d="M10 2.75 4.25 5v4.5c0 3.6 2.4 6.4 5.75 7.75 3.35-1.35 5.75-4.15 5.75-7.75V5Z" /><path d="m7.5 10 1.75 1.75L12.75 8" /></>);
export const IconCookie = make(<><path d="M16.9 10.6A7 7 0 1 1 9.4 3.1a2.5 2.5 0 0 0 3 3 2.5 2.5 0 0 0 4.5 4.5Z" /><path d="M7 8.5h.01M7.5 12.5h.01M11 13h.01M10 10h.01" /></>);
export const IconUsers = make(<><circle cx="7.5" cy="7" r="2.5" /><path d="M2.75 16c.4-2.6 2.3-4.25 4.75-4.25S11.85 13.4 12.25 16" /><path d="M13 4.75a2.25 2.25 0 0 1 0 4.5M14.5 11.9c1.5.55 2.5 1.9 2.75 4.1" /></>);
export const IconScale = make(<><path d="M10 3.5v13M6 16.5h8M4.25 6h11.5M10 4.5v1.5" /><path d="M5 6 2.75 11a2.25 2.25 0 0 0 4.5 0Z" /><path d="M15 6l-2.25 5a2.25 2.25 0 0 0 4.5 0Z" /></>);
export const IconMail = make(<><rect x="3" y="4.75" width="14" height="10.5" rx="1.75" /><path d="m3.5 5.75 6.5 5 6.5-5" /></>);
export const IconSparkle = make(<path d="M10 3c.5 3.2 1.8 4.5 5 5-3.2.5-4.5 1.8-5 5-.5-3.2-1.8-4.5-5-5 3.2-.5 4.5-1.8 5-5ZM15.25 13.25c.2 1.15.6 1.55 1.75 1.75-1.15.2-1.55.6-1.75 1.75-.2-1.15-.6-1.55-1.75-1.75 1.15-.2 1.55-.6 1.75-1.75Z" />);
export const IconDatabase = make(<><ellipse cx="10" cy="5" rx="5.75" ry="2.25" /><path d="M4.25 5v10c0 1.24 2.57 2.25 5.75 2.25s5.75-1.01 5.75-2.25V5M4.25 10c0 1.24 2.57 2.25 5.75 2.25s5.75-1.01 5.75-2.25" /></>);
export const IconCpu = make(<><rect x="5.5" y="5.5" width="9" height="9" rx="1.25" /><rect x="8.25" y="8.25" width="3.5" height="3.5" rx=".5" /><path d="M8 3v2.5M12 3v2.5M8 14.5V17M12 14.5V17M3 8h2.5M3 12h2.5M14.5 8H17M14.5 12H17" /></>);
export const IconRefresh = make(<><path d="M15.5 8.5A5.75 5.75 0 0 0 5 6.5" /><path d="M4.5 3.5v3h3" /><path d="M4.5 11.5A5.75 5.75 0 0 0 15 13.5" /><path d="M15.5 16.5v-3h-3" /></>);
export const IconWrench = make(<path d="M12.4 3.6a3.75 3.75 0 0 0-4.7 4.8l-4.2 4.2a1.6 1.6 0 1 0 2.3 2.3l4.2-4.2a3.75 3.75 0 0 0 4.8-4.7l-2.2 2.2-2.1-.4-.4-2.1Z" />);
export const IconPhone = make(<><rect x="5.75" y="2.75" width="8.5" height="14.5" rx="1.75" /><path d="M9 14.5h2" /></>);
export const IconShare = make(<><circle cx="14.5" cy="5" r="2" /><circle cx="5.5" cy="10" r="2" /><circle cx="14.5" cy="15" r="2" /><path d="m7.25 9 5.5-3M7.25 11l5.5 3" /></>);
export const IconChild = make(<><circle cx="10" cy="5.25" r="2.25" /><path d="M6.5 9.5h7M10 9.5v3.5M7.5 17l2.5-4 2.5 4" /></>);
export const IconInfinity = make(<path d="M10 10c-1.6-2.1-2.9-3.1-4.4-3.1a3.1 3.1 0 0 0 0 6.2c1.5 0 2.8-1 4.4-3.1Zm0 0c1.6 2.1 2.9 3.1 4.4 3.1a3.1 3.1 0 0 0 0-6.2c-1.5 0-2.8 1-4.4 3.1Z" />);
export const IconImage = make(<><rect x="3" y="4" width="14" height="12" rx="1.75" /><circle cx="7.5" cy="8.25" r="1.25" /><path d="m3.5 14 4-4 3 3 2-2 4 4" /></>);
