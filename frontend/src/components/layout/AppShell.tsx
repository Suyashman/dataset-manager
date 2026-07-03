import { NavLink, Outlet } from "react-router-dom";
import { Database, FolderPlus, GitMerge, LayoutDashboard, ScrollText, Search, Settings as SettingsIcon, Rocket, Wand2, ScanEye, PenTool } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const navItems = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/create", label: "Create Dataset", icon: FolderPlus },
  { to: "/annotate", label: "Annotate", icon: PenTool },
  { to: "/merge", label: "Merge Dataset", icon: GitMerge },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/augment", label: "Augment Dataset", icon: Wand2 },
  { to: "/train", label: "Train Model", icon: Rocket },
  { to: "/inference", label: "Inference Studio", icon: ScanEye },
  { to: "/search", label: "Search", icon: Search },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-sm tracking-tight">YOLO Dataset Manager</span>
          <ThemeToggle />
        </div>
        <nav className="flex-1 px-2 py-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">Local-only · no cloud sync</div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
