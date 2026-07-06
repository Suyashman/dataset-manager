import { Link } from "react-router-dom";
import { Database, FolderPlus, GitMerge, PenTool, Wand2, Rocket, ScanEye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const groups = [
  {
    heading: "Datasets",
    cards: [
      { to: "/create", title: "Create Dataset", desc: "Build a fresh YOLO dataset from a downloaded Roboflow export.", icon: FolderPlus },
      { to: "/annotate", title: "Annotate", icon: PenTool, desc: "Draw bounding boxes on your own images to build a dataset from scratch." },
      { to: "/merge", title: "Merge Dataset", desc: "Combine another dataset into an existing one with automatic class remapping.", icon: GitMerge },
      { to: "/augment", title: "Augment Dataset", icon: Wand2, desc: "Grow a dataset with flips, rotations, and color augmentations." },
      { to: "/datasets", title: "Browse Datasets", desc: "View classes, split counts, stats, and validation health for every dataset.", icon: Database },
    ],
  },
  {
    heading: "Model",
    cards: [
      { to: "/train", title: "Train Model", icon: Rocket, desc: "Train a YOLO model on any dataset, locally, on CPU or GPU." },
      { to: "/inference", title: "Inference Studio", icon: ScanEye, desc: "Test a trained model on an image, a video, or your live webcam." },
    ],
  },
];

export function Home() {
  let cardIndex = 0;
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">YOLO Dataset Manager</h1>
      <p className="text-muted-foreground mb-8">Manage local YOLO datasets without the manual busywork.</p>
      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.heading}>
            <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-3">{group.heading}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.cards.map(({ to, title, desc, icon: Icon }) => {
                const delay = cardIndex++ * 50;
                return (
                  <Link key={title} to={to}>
                    <Card
                      className="h-full animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
                      style={{ animationDelay: `${delay}ms` }}
                    >
                      <CardHeader>
                        <div className="rounded-md bg-accent p-2 w-fit mb-2">
                          <Icon className="h-6 w-6 text-accent-foreground" />
                        </div>
                        <CardTitle>{title}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
