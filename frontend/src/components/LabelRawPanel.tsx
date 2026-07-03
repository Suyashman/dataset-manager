import type { LabelResponse } from "@/types/image";

export function LabelRawPanel({ label }: { label: LabelResponse }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium mb-1">Classes in frame</h3>
        <div className="text-sm text-muted-foreground">
          {label.boxes.length === 0 ? "No annotations" : label.boxes.map((b) => b.class_name).join(", ")}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-1">Raw YOLO label</h3>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
          {label.raw_text || "(empty)"}
        </pre>
      </div>
    </div>
  );
}
