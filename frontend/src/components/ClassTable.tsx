import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ClassTable({ classes }: { classes: Record<string, string> }) {
  const entries = Object.entries(classes).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">ID</TableHead>
          <TableHead>Class Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([id, name]) => (
          <TableRow key={id}>
            <TableCell>{id}</TableCell>
            <TableCell>{name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
