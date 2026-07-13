/**
 * Icon set: thin wrappers over lucide-react keeping the app's Icon* names
 * and `size` prop. Transport glyphs render solid (filled) to match the
 * player's weight; everything else stays stroked.
 */

import {
  ChevronUp,
  Cloud,
  ListMusic,
  Maximize2,
  Menu,
  Pause,
  PanelRightClose,
  Play,
  Radio,
  Repeat,
  Share,
  Shuffle,
  SkipBack,
  SkipForward,
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
export const IconRepeat = ({ size = 20, ...p }: IconProps) => (
  <Repeat size={size} {...p} />
);
export const IconVolume = ({ size = 20, ...p }: IconProps) => (
  <Volume2 size={size} {...p} />
);
export const IconMute = ({ size = 20, ...p }: IconProps) => (
  <VolumeX size={size} {...p} />
);
export const IconQueue = ({ size = 20, ...p }: IconProps) => (
  <ListMusic size={size} {...p} />
);
export const IconExpand = ({ size = 20, ...p }: IconProps) => (
  <Maximize2 size={size} {...p} />
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
export const IconPanelRight = ({ size = 20, ...p }: IconProps) => (
  <PanelRightClose size={size} {...p} />
);
