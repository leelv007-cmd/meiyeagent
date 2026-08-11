import type { RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
  }
}

export interface Option {
  label: string;
  value: string;
  count?: number;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}
