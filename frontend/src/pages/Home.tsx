import { Link } from "react-router-dom";
import { BarChart3, Database, FolderPlus, GitMerge, Settings as SettingsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const cards = [
  { to: "/create", title: "Create New Dataset", desc: "Build a fresh YOLO dataset from a downloaded Roboflow export.", icon: FolderPlus },
  { to: "/merge", title: "Merge Dataset", desc: "Combine another dataset into an existing one with automatic class remapping.", icon: GitMerge },
  { to: "/datasets", title: "View Datasets", desc: "Browse all datasets, classes, and split counts.", icon: Database },
  { to: "/datasets", title: "Dataset Statistics", desc: "Inspect counts, validation issues, and dataset health.", icon: BarChart3 },
  { to: "/settings", title: "Settings", desc: "Configure default folders, prefixes, and theme.", icon: SettingsIcon },
];

export function Home() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">YOLO Dataset Manager</h1>
      <p className="text-muted-foreground mb-6">Manage local YOLO datasets without the manual busywork.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ to, title, desc, icon: Icon }) => (
          <Link key={title} to={to}>
            <Card className="h-full hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="rounded-md bg-accent p-2 w-fit mb-2">
                  <Icon className="h-6 w-6 text-accent-foreground" />
                </div>
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
