import {
  // Files & Documents
  File, FileText, FilePlus, FileCheck, FileX, FileCode, FileJson,
  FileImage, FileVideo, FileAudio, FileArchive, FileSpreadsheet,
  Folder, FolderOpen, FolderPlus, FolderMinus, FolderCheck, FolderX,
  FolderHeart, FolderCog, FolderSearch, FolderInput, FolderOutput,
  FolderLock, FolderKey, FolderGit2, FolderTree, FolderDot,

  // Navigation
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  ChevronsDown, ChevronsUp, ChevronsLeft, ChevronsRight,
  ArrowDown, ArrowUp, ArrowLeft, ArrowRight,
  ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight,
  MoveLeft, MoveRight, MoveUp, MoveDown,
  CornerDownLeft, CornerDownRight, CornerUpLeft, CornerUpRight,
  Home, ExternalLink, Undo2, Redo2,

  // Actions
  Plus, Minus, X, Check, RefreshCw, RotateCcw,
  Search, Filter, SortAsc, SortDesc,
  Copy, Clipboard, ClipboardCheck, ClipboardList,
  Trash2, Download, Upload, Save, Share2,
  Edit3, Pencil, PenTool, Eraser, Scissors,
  Eye, EyeOff, Lock, Unlock,
  Settings, Sliders, SlidersHorizontal,
  MoreHorizontal, MoreVertical, Grip, GripVertical,

  // Layout
  PanelLeft, PanelRight, PanelTop, PanelBottom,
  Sidebar, Columns2, Rows2,
  Maximize2, Minimize2, Expand, Shrink,
  LayoutGrid, LayoutList, LayoutDashboard,
  SplitSquareHorizontal, SplitSquareVertical,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,

  // Communication
  Mail, MailOpen, Send, Inbox, Archive,
  MessageSquare, MessageCircle, Quote,
  Bell, BellOff, BellRing,
  Phone, PhoneCall,

  // Marks & Status
  Bookmark, BookmarkCheck, BookmarkMinus, BookmarkPlus,
  Star, Heart, ThumbsUp, ThumbsDown,
  Flag, AlertCircle, AlertTriangle, Info, HelpCircle,
  CheckCircle, XCircle, Ban, ShieldCheck,
  CircleDot, Circle, CircleOff,

  // Media
  Image, Camera, Video, Music, Mic, MicOff,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,

  // Code & Dev
  Code, Code2, Terminal, Bug, Braces, Hash,
  GitBranch, GitCommit, GitMerge, GitPullRequest, GitFork,
  Database, Server, Cloud, CloudOff, Wifi, WifiOff,
  Globe, Link, Link2, Unlink,

  // Objects & Things
  Calendar, CalendarDays, CalendarCheck, CalendarClock,
  Clock, Timer, TimerOff, Hourglass,
  MapPin, Map, Compass, Navigation,
  Key, KeyRound, Fingerprint,
  Lightbulb, Zap, Battery, BatteryCharging,
  Package, Box, Gift, ShoppingCart, ShoppingBag,
  Wallet, CreditCard, Receipt, Banknote,
  Cpu, HardDrive, Monitor, Smartphone, Tablet, Laptop,
  Printer, Headphones, Speaker,

  // People & Users
  User, Users, UserPlus, UserMinus, UserCheck, UserX,
  Crown, Award, Medal, Trophy,

  // Nature & Weather
  Sun, Moon, CloudSun, CloudRain, CloudSnow, Wind, Umbrella,
  Leaf, TreePine, Flower2, Mountain, Waves,

  // Lists & Checks
  CheckSquare, List, ListChecks, Tag,

  // Shapes & Misc
  Square, Triangle, Diamond, Hexagon, Octagon, Pentagon,
  Sparkles, Flame, Snowflake, Droplets,
  Palette, Paintbrush, Type, Keyboard,
  Gauge, Target, Crosshair, Scan,
  Rocket, Plane, Car, Bike, Train,
  Building, Building2, Factory, Store, Warehouse,
  GraduationCap, BookOpen, Library, Notebook, ScrollText,
  Microscope, FlaskConical, Atom, Dna,
  Scale, Gavel, Landmark, Handshake,
  Megaphone, Radio, Podcast,
  Clapperboard, Film, Tv, Gamepad2,
  Pizza, Coffee, UtensilsCrossed, Wine, Cake,
  Dog, Cat, Bird, Fish, Rabbit,
  Anchor, LifeBuoy, Ship,
  Tent, Backpack,
  Puzzle, Blocks, Shapes,

  type LucideIcon,
} from "lucide-react";

// ── Icon Map: kebab-case name → Lucide component ──

export const ICON_MAP: Record<string, LucideIcon> = {
  // Files
  "file": File, "file-text": FileText, "file-plus": FilePlus,
  "file-check": FileCheck, "file-x": FileX, "file-code": FileCode,
  "file-json": FileJson, "file-image": FileImage, "file-video": FileVideo,
  "file-audio": FileAudio, "file-archive": FileArchive, "file-spreadsheet": FileSpreadsheet,
  "folder": Folder, "folder-open": FolderOpen, "folder-plus": FolderPlus,
  "folder-minus": FolderMinus, "folder-check": FolderCheck, "folder-x": FolderX,
  "folder-heart": FolderHeart, "folder-cog": FolderCog, "folder-search": FolderSearch,
  "folder-input": FolderInput, "folder-output": FolderOutput,
  "folder-lock": FolderLock, "folder-key": FolderKey, "folder-git": FolderGit2,
  "folder-tree": FolderTree, "folder-dot": FolderDot,

  // Navigation
  "chevron-down": ChevronDown, "chevron-up": ChevronUp,
  "chevron-left": ChevronLeft, "chevron-right": ChevronRight,
  "chevrons-down": ChevronsDown, "chevrons-up": ChevronsUp,
  "chevrons-left": ChevronsLeft, "chevrons-right": ChevronsRight,
  "arrow-down": ArrowDown, "arrow-up": ArrowUp,
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight,
  "arrow-down-left": ArrowDownLeft, "arrow-down-right": ArrowDownRight,
  "arrow-up-left": ArrowUpLeft, "arrow-up-right": ArrowUpRight,
  "move-left": MoveLeft, "move-right": MoveRight,
  "move-up": MoveUp, "move-down": MoveDown,
  "corner-down-left": CornerDownLeft, "corner-down-right": CornerDownRight,
  "corner-up-left": CornerUpLeft, "corner-up-right": CornerUpRight,
  "home": Home, "external-link": ExternalLink,
  "undo": Undo2, "redo": Redo2,

  // Actions
  "plus": Plus, "minus": Minus, "x": X, "check": Check, "check-square": CheckSquare,
  "list": List, "list-checks": ListChecks, "tag": Tag,
  "refresh-cw": RefreshCw, "rotate-ccw": RotateCcw,
  "search": Search, "filter": Filter,
  "sort-asc": SortAsc, "sort-desc": SortDesc,
  "copy": Copy, "clipboard": Clipboard,
  "clipboard-check": ClipboardCheck, "clipboard-list": ClipboardList,
  "trash": Trash2, "download": Download, "upload": Upload,
  "save": Save, "share": Share2,
  "edit": Edit3, "pencil": Pencil, "pen-tool": PenTool,
  "eraser": Eraser, "scissors": Scissors,
  "eye": Eye, "eye-off": EyeOff,
  "lock": Lock, "unlock": Unlock,
  "settings": Settings, "sliders": Sliders,
  "sliders-horizontal": SlidersHorizontal,
  "more-horizontal": MoreHorizontal, "more-vertical": MoreVertical,
  "grip": Grip, "grip-vertical": GripVertical,

  // Layout
  "panel-left": PanelLeft, "panel-right": PanelRight,
  "panel-top": PanelTop, "panel-bottom": PanelBottom,
  "sidebar": Sidebar, "columns": Columns2, "rows": Rows2,
  "maximize": Maximize2, "minimize": Minimize2,
  "expand": Expand, "shrink": Shrink,
  "layout-grid": LayoutGrid, "layout-list": LayoutList,
  "layout-dashboard": LayoutDashboard,
  "split-horizontal": SplitSquareHorizontal, "split-vertical": SplitSquareVertical,
  "align-left": AlignLeft, "align-center": AlignCenter,
  "align-right": AlignRight, "align-justify": AlignJustify,

  // Communication
  "mail": Mail, "mail-open": MailOpen, "send": Send,
  "inbox": Inbox, "archive": Archive,
  "message-square": MessageSquare, "message-circle": MessageCircle, "quote": Quote,
  "bell": Bell, "bell-off": BellOff, "bell-ring": BellRing,
  "phone": Phone, "phone-call": PhoneCall,

  // Marks & Status
  "bookmark": Bookmark, "bookmark-check": BookmarkCheck,
  "bookmark-minus": BookmarkMinus, "bookmark-plus": BookmarkPlus,
  "star": Star, "heart": Heart,
  "thumbs-up": ThumbsUp, "thumbs-down": ThumbsDown,
  "flag": Flag, "alert-circle": AlertCircle, "alert-triangle": AlertTriangle,
  "info": Info, "help-circle": HelpCircle,
  "check-circle": CheckCircle, "x-circle": XCircle,
  "ban": Ban, "shield-check": ShieldCheck,
  "circle-dot": CircleDot, "circle": Circle, "circle-off": CircleOff,

  // Media
  "image": Image, "camera": Camera, "video": Video,
  "music": Music, "mic": Mic, "mic-off": MicOff,
  "play": Play, "pause": Pause,
  "skip-back": SkipBack, "skip-forward": SkipForward,
  "volume": Volume2, "volume-x": VolumeX,

  // Code & Dev
  "code": Code, "code-2": Code2, "terminal": Terminal,
  "bug": Bug, "braces": Braces, "hash": Hash,
  "git-branch": GitBranch, "git-commit": GitCommit,
  "git-merge": GitMerge, "git-pull-request": GitPullRequest, "git-fork": GitFork,
  "database": Database, "server": Server,
  "cloud": Cloud, "cloud-off": CloudOff,
  "wifi": Wifi, "wifi-off": WifiOff,
  "globe": Globe, "link": Link, "link-2": Link2, "unlink": Unlink,

  // Objects
  "calendar": Calendar, "calendar-days": CalendarDays,
  "calendar-check": CalendarCheck, "calendar-clock": CalendarClock,
  "clock": Clock, "timer": Timer, "timer-off": TimerOff, "hourglass": Hourglass,
  "map-pin": MapPin, "map": Map, "compass": Compass, "navigation": Navigation,
  "key": Key, "key-round": KeyRound, "fingerprint": Fingerprint,
  "lightbulb": Lightbulb, "zap": Zap,
  "battery": Battery, "battery-charging": BatteryCharging,
  "package": Package, "box": Box, "gift": Gift,
  "shopping-cart": ShoppingCart, "shopping-bag": ShoppingBag,
  "wallet": Wallet, "credit-card": CreditCard, "receipt": Receipt, "banknote": Banknote,
  "cpu": Cpu, "hard-drive": HardDrive,
  "monitor": Monitor, "smartphone": Smartphone, "tablet": Tablet, "laptop": Laptop,
  "printer": Printer, "headphones": Headphones, "speaker": Speaker,

  // People
  "user": User, "users": Users, "user-plus": UserPlus,
  "user-minus": UserMinus, "user-check": UserCheck, "user-x": UserX,
  "crown": Crown, "award": Award, "medal": Medal, "trophy": Trophy,

  // Nature
  "sun": Sun, "moon": Moon, "cloud-sun": CloudSun,
  "cloud-rain": CloudRain, "cloud-snow": CloudSnow,
  "wind": Wind, "umbrella": Umbrella,
  "leaf": Leaf, "tree-pine": TreePine, "flower": Flower2,
  "mountain": Mountain, "waves": Waves,

  // Shapes & Misc
  "square": Square, "triangle": Triangle, "diamond": Diamond,
  "hexagon": Hexagon, "octagon": Octagon, "pentagon": Pentagon,
  "sparkles": Sparkles, "flame": Flame, "snowflake": Snowflake, "droplets": Droplets,
  "palette": Palette, "paintbrush": Paintbrush, "type": Type, "keyboard": Keyboard,
  "gauge": Gauge, "target": Target, "crosshair": Crosshair, "scan": Scan,
  "rocket": Rocket, "plane": Plane, "car": Car, "bike": Bike, "train": Train,
  "building": Building, "building-2": Building2, "factory": Factory,
  "store": Store, "warehouse": Warehouse,
  "graduation-cap": GraduationCap, "book-open": BookOpen,
  "library": Library, "notebook": Notebook, "scroll-text": ScrollText,
  "microscope": Microscope, "flask": FlaskConical, "atom": Atom, "dna": Dna,
  "scale": Scale, "gavel": Gavel, "landmark": Landmark, "handshake": Handshake,
  "megaphone": Megaphone, "radio": Radio, "podcast": Podcast,
  "clapperboard": Clapperboard, "film": Film, "tv": Tv, "gamepad": Gamepad2,
  "pizza": Pizza, "coffee": Coffee, "utensils": UtensilsCrossed,
  "wine": Wine, "cake": Cake,
  "dog": Dog, "cat": Cat, "bird": Bird, "fish": Fish, "rabbit": Rabbit,
  "anchor": Anchor, "life-buoy": LifeBuoy, "ship": Ship,
  "tent": Tent, "backpack": Backpack,
  "puzzle": Puzzle, "blocks": Blocks, "shapes": Shapes,
};

// ── Categories ──

export interface IconCategory {
  name: string;
  icons: string[];
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    name: "Files",
    icons: [
      "file", "file-text", "file-plus", "file-check", "file-x", "file-code",
      "file-json", "file-image", "file-video", "file-audio", "file-archive", "file-spreadsheet",
      "folder", "folder-open", "folder-plus", "folder-minus", "folder-check", "folder-x",
      "folder-heart", "folder-cog", "folder-search", "folder-input", "folder-output",
      "folder-lock", "folder-key", "folder-git", "folder-tree", "folder-dot",
    ],
  },
  {
    name: "Navigation",
    icons: [
      "chevron-down", "chevron-up", "chevron-left", "chevron-right",
      "arrow-down", "arrow-up", "arrow-left", "arrow-right",
      "home", "external-link", "undo", "redo",
    ],
  },
  {
    name: "Actions",
    icons: [
      "plus", "minus", "x", "check", "refresh-cw", "rotate-ccw",
      "search", "filter", "sort-asc", "sort-desc",
      "copy", "clipboard", "clipboard-check", "clipboard-list",
      "trash", "download", "upload", "save", "share",
      "edit", "pencil", "pen-tool", "eraser", "scissors",
      "eye", "eye-off", "lock", "unlock",
      "settings", "sliders", "sliders-horizontal",
      "more-horizontal", "more-vertical",
    ],
  },
  {
    name: "Marks",
    icons: [
      "bookmark", "bookmark-check", "bookmark-minus", "bookmark-plus",
      "star", "heart", "thumbs-up", "thumbs-down", "flag",
      "alert-circle", "alert-triangle", "info", "help-circle",
      "check-circle", "x-circle", "ban", "shield-check",
    ],
  },
  {
    name: "Media",
    icons: [
      "image", "camera", "video", "music", "mic",
      "play", "pause", "skip-back", "skip-forward", "volume", "volume-x",
    ],
  },
  {
    name: "Code",
    icons: [
      "code", "code-2", "terminal", "bug", "braces", "hash",
      "git-branch", "git-commit", "git-merge", "git-pull-request", "git-fork",
      "database", "server", "cloud", "globe", "link", "link-2",
    ],
  },
  {
    name: "Objects",
    icons: [
      "calendar", "calendar-days", "calendar-check", "clock", "timer", "hourglass",
      "map-pin", "map", "compass", "key", "key-round", "fingerprint",
      "lightbulb", "zap", "package", "box", "gift",
      "wallet", "credit-card", "cpu", "hard-drive",
      "monitor", "smartphone", "laptop", "headphones",
    ],
  },
  {
    name: "People",
    icons: [
      "user", "users", "user-plus", "user-minus", "user-check",
      "crown", "award", "medal", "trophy",
    ],
  },
  {
    name: "Nature",
    icons: [
      "sun", "moon", "cloud-sun", "cloud-rain", "cloud-snow", "wind", "umbrella",
      "leaf", "tree-pine", "flower", "mountain", "waves",
    ],
  },
  {
    name: "Misc",
    icons: [
      "sparkles", "flame", "snowflake", "droplets",
      "palette", "paintbrush", "type", "keyboard",
      "rocket", "plane", "car", "bike", "train",
      "building", "building-2", "factory", "store", "warehouse",
      "graduation-cap", "book-open", "library", "notebook", "scroll-text",
      "microscope", "flask", "atom", "dna",
      "scale", "gavel", "landmark", "handshake",
      "megaphone", "radio", "podcast",
      "pizza", "coffee", "utensils", "wine", "cake",
      "dog", "cat", "bird", "fish", "rabbit",
      "anchor", "ship", "tent", "backpack",
      "puzzle", "blocks", "shapes", "diamond", "hexagon",
    ],
  },
];

// Validate category entries exist in ICON_MAP (dev-time safety net)
if (import.meta.env.DEV) {
  for (const cat of ICON_CATEGORIES) {
    for (const name of cat.icons) {
      if (!(name in ICON_MAP)) {
        console.warn(`[iconCatalog] Category "${cat.name}" references unknown icon "${name}"`);
      }
    }
  }
}

// All icon names (for search)
export const ALL_ICON_NAMES = Object.keys(ICON_MAP);
