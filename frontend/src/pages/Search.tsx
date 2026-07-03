import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { search } from "@/api/search";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export function Search() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  const { data } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => search(debounced),
    enabled: debounced.length > 0,
  });

  const debounceTimer = useRef<number | null>(null);
  const onChange = (value: string) => {
    setQ(value);
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => setDebounced(value), 300);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Search</h1>
      <p className="text-muted-foreground mb-4">Search across images, classes, filenames, and prefixes.</p>
      <Input
        placeholder="Search..."
        value={q}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-md mb-6"
      />

      {data && (
        <Tabs defaultValue="filenames">
          <TabsList>
            <TabsTrigger value="filenames">Filenames ({data.filenames.length})</TabsTrigger>
            <TabsTrigger value="classes">Classes ({data.classes.length})</TabsTrigger>
            <TabsTrigger value="prefixes">Prefixes ({data.prefixes.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="filenames" className="space-y-2">
            {data.filenames.map((f, i) => (
              <div key={i} className="text-sm flex items-center gap-2 border border-border rounded-md px-3 py-2">
                <Badge variant="secondary">{f.dataset}</Badge>
                <span>{f.split}/{f.filename}</span>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="classes" className="space-y-2">
            {data.classes.map((c, i) => (
              <div key={i} className="text-sm flex items-center gap-2 border border-border rounded-md px-3 py-2">
                <Badge variant="secondary">{c.dataset}</Badge>
                <span>#{c.class_id} {c.class_name}</span>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="prefixes" className="space-y-2">
            {data.prefixes.map((p, i) => (
              <div key={i} className="text-sm flex items-center gap-2 border border-border rounded-md px-3 py-2">
                <Badge variant="secondary">{p.dataset}</Badge>
                <span>{p.prefix} (last: {p.last_number})</span>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
