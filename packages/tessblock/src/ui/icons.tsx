/** 16px stroke icons. One shape each, no fills. */
import type { JSX } from 'preact';

type IconProps = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

function Icon({ size = 16, children, ...rest }: IconProps & { children: preact.ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </Icon>
);

export const EyeOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.2 4.3A6.9 6.9 0 0 1 8 4c4.1 0 6.5 4 6.5 4a11 11 0 0 1-2.2 2.6M4 5.4A11 11 0 0 0 1.5 8S3.9 12 8 12c.8 0 1.5-.1 2.2-.4" />
    <path d="M2.5 2.5l11 11" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.5 3.5l2 2L6 12H4v-2z" />
    <path d="M9.5 4.5l2 2" />
  </Icon>
);

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);

export const FilePlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" />
    <path d="M9 2v4h4M8 8v4M6 10h4" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
    <path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" />
  </Icon>
);

export const UnlockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
    <path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.6-.8" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const TextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 4.2V3h9v1.2M8 3v10M6 13h4" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 4.5h10M6.4 4.5V3.2h3.2v1.3M4.5 4.5l.6 8.3h5.8l.6-8.3" />
  </Icon>
);

export const GripIcon = (props: IconProps) => (
  <Icon {...props} stroke-width="1.8">
    <path d="M6 4.2h.01M6 8h.01M6 11.8h.01M10 4.2h.01M10 8h.01M10 11.8h.01" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor" stroke="none">
    <path d="M5.5 3.6a.6.6 0 0 1 .9-.5l6 4.4a.6.6 0 0 1 0 1l-6 4.4a.6.6 0 0 1-.9-.5V3.6Z" />
  </Icon>
);

export const StopIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor" stroke="none">
    <rect x="4" y="4" width="8" height="8" rx="1.6" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 10.5V3m0 0L5.4 5.6M8 3l2.6 2.6M3 10.5v1.4A1.6 1.6 0 0 0 4.6 13.5h6.8A1.6 1.6 0 0 0 13 11.9v-1.4" />
  </Icon>
);

export const CodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.8 5 3 8l2.8 3M10.2 5 13 8l-2.8 3" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 12.5v-9M4.6 6.9 8 3.5l3.4 3.4" />
  </Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.5v9M4.6 9.1 8 12.5l3.4-3.4" />
  </Icon>
);

export const CursorIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 3l7.5 9.2-3.4.5-1.5 3.1L4 3Z" />
  </Icon>
);

export const NodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 11.5c3-6 6-6 9 0" />
    <rect x="1.8" y="10" width="3.2" height="3.2" rx="0.6" />
    <rect x="11" y="10" width="3.2" height="3.2" rx="0.6" />
    <circle cx="8" cy="7.4" r="1.2" />
  </Icon>
);

export const BrushIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M11.4 2.9 13 4.5l-6 6-2.2.6.6-2.2 6-6Z" />
    <path d="M3.2 13.4c1.6.4 2.8-.3 2.6-1.8" />
  </Icon>
);

export const EraserIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.2 12.8 3 9.6a1.2 1.2 0 0 1 0-1.7l5-5a1.2 1.2 0 0 1 1.7 0l3.2 3.2a1.2 1.2 0 0 1 0 1.7l-4.2 4.2H6.2Z" />
    <path d="M5.6 6.4 9.9 10.7" />
  </Icon>
);

export const FillIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.6 2.6 12 8l-5 5-5-5 4.6-5.4Z" />
    <path d="M13.6 10.6c.7 1 .5 2.1-.5 2.6-1 .4-2-.2-2-1.3 0-.8 1.3-2.4 1.3-2.4s.8.7 1.2 1.1Z" />
  </Icon>
);

export const LineIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 13 13 3" />
  </Icon>
);

export const RectIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.8" y="3.8" width="10.4" height="8.4" rx="1.2" />
  </Icon>
);

export const CircleIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.2" />
  </Icon>
);

export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.2 7.4h6.2a3.2 3.2 0 0 1 0 6.4H6" />
    <path d="M5.6 4.6 3 7.4l2.6 2.8" />
  </Icon>
);

export const RedoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.8 7.4H6.6a3.2 3.2 0 0 0 0 6.4H10" />
    <path d="M10.4 4.6 13 7.4l-2.6 2.8" />
  </Icon>
);

export const GroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.6" y="2.6" width="6" height="6" rx="1" />
    <rect x="7.4" y="7.4" width="6" height="6" rx="1" />
  </Icon>
);

export const UngroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.4" y="2.4" width="5.2" height="5.2" rx="1" />
    <rect x="8.4" y="8.4" width="5.2" height="5.2" rx="1" stroke-dasharray="2 1.6" />
  </Icon>
);

export const FlipHIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.6v10.8" stroke-dasharray="2 1.6" />
    <path d="M6.2 5.2 3 8l3.2 2.8V5.2ZM9.8 5.2 13 8l-3.2 2.8V5.2Z" />
  </Icon>
);

export const FlipVIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.6 8h10.8" stroke-dasharray="2 1.6" />
    <path d="M5.2 6.2 8 3l2.8 3.2H5.2ZM5.2 9.8 8 13l2.8-3.2H5.2Z" />
  </Icon>
);

export const FrontIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.6" y="2.6" width="7" height="7" rx="1" />
    <path d="M6.4 13.4h7v-7" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="6.4" y="6.4" width="7" height="7" rx="1" />
    <path d="M9.6 2.6h-7v7" />
  </Icon>
);

export const ZoomInIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="M10.4 10.4 13.4 13.4M5.4 7.2h3.6M7.2 5.4v3.6" />
  </Icon>
);

export const ZoomOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="M10.4 10.4 13.4 13.4M5.4 7.2h3.6" />
  </Icon>
);

export const FitIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.8 6V3.6a.8.8 0 0 1 .8-.8H6M10 2.8h2.4a.8.8 0 0 1 .8.8V6M13.2 10v2.4a.8.8 0 0 1-.8.8H10M6 13.2H3.6a.8.8 0 0 1-.8-.8V10" />
  </Icon>
);

export const CenterIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3.2" />
    <path d="M8 1.6v2.6M8 11.8v2.6M1.6 8h2.6M11.8 8h2.6" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.4" />
    <path d="M10.6 5.4V3.8a1.4 1.4 0 0 0-1.4-1.4H3.8a1.4 1.4 0 0 0-1.4 1.4v5.4a1.4 1.4 0 0 0 1.4 1.4h1.6" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7.2" cy="7.2" r="4.4" />
    <path d="m10.6 10.6 3 3" />
  </Icon>
);

export const FlagIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor">
    <path d="M3.2 2.2a.6.6 0 0 1 .6.6v10.4a.6.6 0 1 1-1.2 0V2.8a.6.6 0 0 1 .6-.6Z" stroke="none" />
    <path d="M3.5 2.8c2.2-1 4.5.8 7 .1 1.2-.3 2.3-.1 2.3.8v5.5c0 .6-.6 1.1-1.2 1.2-2.3.5-4.5-1.1-7.1-.1V2.8Z" stroke="none" />
  </Icon>
);

/** The flag on fire: boost mode. */
export const FireFlagIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor">
    <path d="M3.2 2.2a.6.6 0 0 1 .6.6v10.4a.6.6 0 1 1-1.2 0V2.8a.6.6 0 0 1 .6-.6Z" stroke="none" />
    <path
      d="M3.5 9.9V3.3c.9.8 1.9-.3 2.4-1.5.4 1.3 1.4 1.4 2 0 .6 1.5 1.8 1.7 2.5.4.5 1.1 1.5 1.4 2.4 1.2v5.5c0 .6-.6 1.1-1.2 1.2-2.3.5-4.5-1.1-7.1-.1Z"
      stroke="none"
    />
  </Icon>
);

export const MaximizeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
);

export const MinimizeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 2.5v3.5H2.5M10 2.5v3.5h3.5M10 13.5V10h3.5M6 13.5V10H2.5" />
  </Icon>
);

export const RotateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6M2 2v4h4" />
  </Icon>
);

export const SignalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 4.5a6.4 6.4 0 0 1 9 0M5.2 6.5a4 4 0 0 1 5.6 0" />
    <circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor" stroke="none">
    <rect x="4" y="3.5" width="2.8" height="9" rx="0.8" />
    <rect x="9.2" y="3.5" width="2.8" height="9" rx="0.8" />
  </Icon>
);

