import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Database,
  FolderPlus,
  GitMerge,
  LayoutDashboard,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Rocket,
  Wand2,
  ScanEye,
  PenTool,
  Bot,
  Sparkles,
  SprayCan,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

// Grouped by where each page sits in the dataset lifecycle: build/curate first, then
// train/infer on the result, with search/logs/settings as cross-cutting utilities last.
const navGroups: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [{ to: "/", label: "Home", icon: LayoutDashboard, end: true }],
  },
  {
    heading: "Datasets",
    items: [
      { to: "/create", label: "Create Dataset", icon: FolderPlus },
      { to: "/annotate", label: "Annotate", icon: PenTool },
      { to: "/sam3", label: "SAM3 Auto-Label", icon: Bot },
      { to: "/clean", label: "Clean Dataset", icon: SprayCan },
      { to: "/merge", label: "Merge Dataset", icon: GitMerge },
      { to: "/augment", label: "Augment Dataset", icon: Wand2 },
      { to: "/datasets", label: "Browse Datasets", icon: Database },
    ],
  },
  {
    heading: "Model",
    items: [
      { to: "/train", label: "Train Model", icon: Rocket },
      { to: "/inference", label: "Inference Studio", icon: ScanEye },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/search", label: "Search", icon: Search },
      { to: "/logs", label: "Logs", icon: ScrollText },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

export function AppShell() {
  const location = useLocation();
  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-40 dark:opacity-25"
        style={{
          background:
            "radial-gradient(600px circle at 0% 0%, var(--primary) 0%, transparent 60%), radial-gradient(500px circle at 100% 100%, var(--primary) 0%, transparent 55%)",
        }}
      />
      <aside className="w-60 shrink-0 border-r border-border flex flex-col bg-sidebar text-sidebar-foreground">
        <div className="px-4 py-4 border-b border-sidebar-border flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold text-sm tracking-tight">
            <Sparkles className="h-4 w-4 text-primary" />
            YOLO Dataset Manager
          </span>
          <ThemeToggle />
        </div>
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.heading && (
                <div className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {group.heading}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-all duration-150",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground translate-x-0.5"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground hover:translate-x-0.5"
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                        )}
                        <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 text-xs text-muted-foreground border-t border-sidebar-border">
          Local-only · no cloud sync
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div key={location.pathname} className="mx-auto max-w-6xl px-6 py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
