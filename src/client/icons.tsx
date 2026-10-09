import { HugeiconsIcon } from '@hugeicons/react';
import {
  FullScreenIcon,
  MinimizeScreenIcon,
  KanbanIcon,
  CheckListIcon,
  Comment01Icon,
  Flag01Icon,
  PlayIcon,
  MusicNote01Icon,
  PrinterIcon,
  Invoice01Icon,
  StopIcon,
  Clock01Icon,
  Timer02Icon,
  Tag01Icon,
  Folder02Icon,
  Dollar02Icon,
  FocusPointIcon,
  PencilEdit01Icon,
  Add01Icon,
  Cancel01Icon,
  Tick02Icon,
  Calendar03Icon,
  Delete02Icon,
  Settings02Icon,
  Download02Icon,
  Upload02Icon,
  ChartBarLineIcon,
  Search01Icon,
  Sun01Icon,
  Moon02Icon,
  KeyboardIcon,
  Notification01Icon,
  Coffee01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowDown01Icon,
  LeftToRightListBulletIcon,
  GridViewIcon,
  Table01Icon,
  PieChartIcon,
  Briefcase01Icon,
  Archive01Icon,
  HelpCircleIcon,
  FileImportIcon,
  ComputerIcon,
  Layout01Icon,
  MoreHorizontalIcon,
  Wallet01Icon,
  Copy01Icon,
  InformationCircleIcon,
  PauseIcon,
  RefreshIcon
} from '@hugeicons/core-free-icons';

interface IconProps {
  size?: number;
  className?: string;
  /** Filled glyph (for play / stop). */
  solid?: boolean;
  strokeWidth?: number;
}

type IconData = Parameters<typeof HugeiconsIcon>[0]['icon'];

const make =
  (icon: IconData) =>
  ({ size = 18, className, solid, strokeWidth = 1.7 }: IconProps) => (
    <HugeiconsIcon icon={icon} size={size} className={className} strokeWidth={strokeWidth} fill={solid ? 'currentColor' : 'none'} />
  );

export const Play = make(PlayIcon);
export const Printer = make(PrinterIcon);
export const Invoice = make(Invoice01Icon);
export const Music =make(MusicNote01Icon);
export const Square =make(StopIcon);
export const Clock = make(Clock01Icon);
export const Timer = make(Timer02Icon);
export const Tag = make(Tag01Icon);
export const Folder = make(Folder02Icon);
export const Dollar = make(Dollar02Icon);
export const Focus = make(FocusPointIcon);
export const Pencil = make(PencilEdit01Icon);
export const Plus = make(Add01Icon);
export const X = make(Cancel01Icon);
export const Check = make(Tick02Icon);
export const Calendar = make(Calendar03Icon);
export const Trash = make(Delete02Icon);
export const Settings = make(Settings02Icon);
export const Download = make(Download02Icon);
export const Upload = make(Upload02Icon);
export const Chart = make(ChartBarLineIcon);
export const Search = make(Search01Icon);
export const Sun = make(Sun01Icon);
export const Moon = make(Moon02Icon);
export const Keyboard = make(KeyboardIcon);
export const Bell = make(Notification01Icon);
export const Coffee = make(Coffee01Icon);
export const ChevronLeft = make(ArrowLeft01Icon);
export const ChevronRight = make(ArrowRight01Icon);
export const ChevronDown = make(ArrowDown01Icon);
export const List = make(LeftToRightListBulletIcon);
export const Grid = make(GridViewIcon);
export const Table = make(Table01Icon);
export const Pie = make(PieChartIcon);
export const Briefcase = make(Briefcase01Icon);
export const Archive = make(Archive01Icon);
export const Help = make(HelpCircleIcon);
export const FileImport = make(FileImportIcon);
export const Computer = make(ComputerIcon);
export const Layout = make(Layout01Icon);
export const More = make(MoreHorizontalIcon);
export const Wallet = make(Wallet01Icon);
export const Copy = make(Copy01Icon);
export const Info = make(InformationCircleIcon);
export const Pause = make(PauseIcon);
export const Refresh = make(RefreshIcon);

export const Kanban = make(KanbanIcon);
export const CheckList = make(CheckListIcon);
export const Comment = make(Comment01Icon);
export const Flag = make(Flag01Icon);
export const Expand = make(FullScreenIcon);
export const Collapse = make(MinimizeScreenIcon);
