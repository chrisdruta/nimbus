/**
 * Icon set: thin wrappers over lucide-react keeping the app's Icon* names
 * and `size` prop. Transport glyphs render solid (filled) to match the
 * player's weight; everything else stays stroked.
 */

import {
  ArrowLeft,
  AudioWaveform,
  ChevronDown,
  ChevronUp,
  Cloud,
  Eye,
  EyeOff,
  Heart,
  LayoutGrid,
  ListMusic,
  ListStart,
  Maximize2,
  Menu,
  Minimize2,
  Pause,
  PanelRightClose,
  Play,
  Plus,
  Radio,
  Repeat,
  Rows3,
  Search,
  Share,
  Shuffle,
  SkipBack,
  SkipForward,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
  X,
  type LucideProps,
} from "lucide-react";

type IconProps = LucideProps & { size?: number };

const filled = (p: IconProps) => ({
  fill: "currentColor",
  strokeWidth: 1,
  ...p,
});

export const IconPlay = ({ size = 20, ...p }: IconProps) => (
  <Play size={size} {...filled(p)} />
);
export const IconPause = ({ size = 20, ...p }: IconProps) => (
  <Pause size={size} {...filled(p)} />
);
export const IconPrev = ({ size = 20, ...p }: IconProps) => (
  <SkipBack size={size} {...filled(p)} />
);
export const IconNext = ({ size = 20, ...p }: IconProps) => (
  <SkipForward size={size} {...filled(p)} />
);
export const IconCloud = ({ size = 20, ...p }: IconProps) => (
  <Cloud size={size} {...filled(p)} />
);

export const IconShuffle = ({ size = 20, ...p }: IconProps) => (
  <Shuffle size={size} {...p} />
);
export const IconSearch = ({ size = 20, ...p }: IconProps) => (
  <Search size={size} {...p} />
);
export const IconArrowLeft = ({ size = 20, ...p }: IconProps) => (
  <ArrowLeft size={size} {...p} />
);
export const IconRepeat = ({ size = 20, ...p }: IconProps) => (
  <Repeat size={size} {...p} />
);
export const IconVolume = ({ size = 20, ...p }: IconProps) => (
  <Volume2 size={size} {...p} />
);
export const IconMute = ({ size = 20, ...p }: IconProps) => (
  <VolumeX size={size} {...p} />
);
export const IconLevel = ({ size = 20, ...p }: IconProps) => (
  <AudioWaveform size={size} {...p} />
);
/** Pass `fill="currentColor"` for the liked (solid) state. */
export const IconHeart = ({ size = 20, ...p }: IconProps) => (
  <Heart size={size} {...p} />
);
export const IconFollow = ({ size = 20, ...p }: IconProps) => (
  <UserPlus size={size} {...p} />
);
export const IconFollowing = ({ size = 20, ...p }: IconProps) => (
  <UserCheck size={size} {...p} />
);
export const IconQueue = ({ size = 20, ...p }: IconProps) => (
  <ListMusic size={size} {...p} />
);
export const IconListStart = ({ size = 20, ...p }: IconProps) => (
  <ListStart size={size} {...p} />
);
export const IconExpand = ({ size = 20, ...p }: IconProps) => (
  <Maximize2 size={size} {...p} />
);
export const IconCollapse = ({ size = 20, ...p }: IconProps) => (
  <Minimize2 size={size} {...p} />
);
export const IconShare = ({ size = 20, ...p }: IconProps) => (
  <Share size={size} {...p} />
);
export const IconRadio = ({ size = 20, ...p }: IconProps) => (
  <Radio size={size} {...p} />
);
export const IconMenu = ({ size = 20, ...p }: IconProps) => (
  <Menu size={size} {...p} />
);
export const IconX = ({ size = 20, ...p }: IconProps) => (
  <X size={size} {...p} />
);
export const IconChevronUp = ({ size = 20, ...p }: IconProps) => (
  <ChevronUp size={size} {...p} />
);
export const IconChevronDown = ({ size = 20, ...p }: IconProps) => (
  <ChevronDown size={size} {...p} />
);
export const IconPlus = ({ size = 20, ...p }: IconProps) => (
  <Plus size={size} {...p} />
);
export const IconGrid = ({ size = 20, ...p }: IconProps) => (
  <LayoutGrid size={size} {...p} />
);
export const IconList = ({ size = 20, ...p }: IconProps) => (
  <Rows3 size={size} {...p} />
);
export const IconEye = ({ size = 20, ...p }: IconProps) => (
  <Eye size={size} {...p} />
);
export const IconEyeOff = ({ size = 20, ...p }: IconProps) => (
  <EyeOff size={size} {...p} />
);
export const IconPanelRight = ({ size = 20, ...p }: IconProps) => (
  <PanelRightClose size={size} {...p} />
);
