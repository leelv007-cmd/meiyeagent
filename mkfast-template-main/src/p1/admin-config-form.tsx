/**
 * Controlled config structured form (U05 / D-107).
 *
 * `admin-config-field-model.ts` reads the config contract into a field tree;
 * this module lays that tree out as operator controls: switches, selects,
 * steppers, priority sliders, and grouped row editors.
 * Presentation is shadcn/base-nova only (admin restyle residual #387) —
 * no heroui cell editors.
 *
 * The form only mutates values; save still goes through impact review +
 * reason + CAS.
 */
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  admin_config_list_add,
  admin_config_list_count,
  admin_config_list_empty,
  admin_config_list_max_reached,
  admin_config_list_min_reached,
  admin_config_list_remove,
  admin_config_list_row,
  admin_config_toggle_set_hint,
} from '@/locale/paraglide/messages';
import {
  type AdminConfigField,
  adminConfigFieldId,
  type AdminConfigFieldPath,
  buildAdminConfigFields,
  listItemTemplate,
  readFieldValue,
  writeFieldValue,
} from '@/p1/admin-config-field-model';
import { IconMinus, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo } from 'react';

/**
 * Runtime-only option state: which option is active, which cannot mount.
 * Not part of the contract; the owning controller passes this in.
 */
export interface AdminConfigOptionMeta {
  /** Block reason (missing credentials, etc.); present → disabled. */
  blockedReason?: string;
  /** Chips like "HTTP · active". */
  chips?: string[];
}

interface FieldViewProps {
  configKey: string;
  /** Dense controls for grid cells; full-size controls for form fields. */
  dense?: boolean;
  disabled?: boolean;
  field: AdminConfigField;
  onChange: (next: unknown) => void;
  optionMeta?: (optionValue: string) => AdminConfigOptionMeta;
  /** Resolved path (list rows replace the template index with the row index). */
  path: AdminConfigFieldPath;
  root: unknown;
}

/**
 * DOM ids always use the resolved path, never `field.id` — list templates
 * pin index 0, so reusing field.id would collide across rows.
 */
function domId(props: Pick<FieldViewProps, 'configKey' | 'path'>) {
  return adminConfigFieldId(props.configKey, props.path);
}

/** Replace list template index placeholders with the real row index. */
function rowPath(
  listPath: AdminConfigFieldPath,
  index: number,
  templatePath: AdminConfigFieldPath
): AdminConfigFieldPath {
  return [...listPath, index, ...templatePath.slice(listPath.length + 1)];
}

function rowId(
  configKey: string,
  listPath: AdminConfigFieldPath,
  index: number
) {
  return `${adminConfigFieldId(configKey, listPath)}-${index}`;
}

function BooleanField(props: FieldViewProps) {
  const { disabled, field, onChange, path, root } = props;
  const checked = readFieldValue(root, path) === true;
  return (
    <label className="flex items-center gap-2" htmlFor={domId(props)}>
      <Switch
        checked={checked}
        data-testid={domId(props)}
        disabled={disabled}
        id={domId(props)}
        onCheckedChange={(next) =>
          onChange(writeFieldValue(root, path, next === true))
        }
      />
      <span className="text-sm font-medium">{field.label}</span>
    </label>
  );
}

function EnumField(props: FieldViewProps) {
  const {
    configKey,
    dense,
    disabled,
    field,
    onChange,
    optionMeta,
    path,
    root,
  } = props;
  if (field.kind !== 'enum') return null;
  const current = String(readFieldValue(root, path) ?? '');

  // Whole-field enum: options side-by-side with descriptions for comparison.
  if (field.presentation === 'radio' && !dense) {
    return (
      <fieldset className="space-y-3" data-testid={domId(props)}>
        <legend className="px-1 font-medium">{field.label}</legend>
        <RadioGroup
          aria-label={field.label}
          onValueChange={(next) => onChange(writeFieldValue(root, path, next))}
          value={current}
        >
          {field.options.map((option) => {
            const meta = optionMeta?.(option.value);
            const blocked = Boolean(option.disabled || meta?.blockedReason);
            return (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                htmlFor={`${configKey}-${option.value}`}
                key={option.value}
              >
                <RadioGroupItem
                  className="mt-0.5"
                  disabled={disabled || blocked}
                  id={`${configKey}-${option.value}`}
                  value={option.value}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {option.label}
                    {(meta?.chips ?? []).map((chip) => (
                      <Badge key={chip} variant="secondary">
                        {chip}
                      </Badge>
                    ))}
                  </span>
                  {option.description ? (
                    <span className="mt-1 block text-muted-foreground text-xs">
                      {option.description}
                    </span>
                  ) : null}
                  {(meta?.blockedReason ?? option.disabledReason) ? (
                    <span className="mt-1 block text-destructive text-xs">
                      {meta?.blockedReason ?? option.disabledReason}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </fieldset>
    );
  }

  const select = (
    <Select
      disabled={disabled}
      onValueChange={(next) => {
        if (next == null) return;
        onChange(writeFieldValue(root, path, String(next)));
      }}
      value={current || undefined}
    >
      <SelectTrigger
        aria-label={field.label}
        className={dense ? 'h-8 w-full min-w-28 data-size:h-8' : 'w-full'}
        data-testid={domId(props)}
        id={dense ? undefined : domId(props)}
        size={dense ? 'sm' : 'default'}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {field.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (dense) return select;

  return (
    <div className="space-y-2">
      <Label htmlFor={domId(props)}>{field.label}</Label>
      {select}
    </div>
  );
}

function NumberField(props: FieldViewProps) {
  const { disabled, field, onChange, path, root } = props;
  if (field.kind !== 'number') return null;
  const raw = readFieldValue(root, path);
  const current = typeof raw === 'number' ? raw : (field.min ?? 0);
  const step = field.integer ? 1 : 0.1;
  const commit = (next: number) => {
    let value = next;
    if (field.min !== undefined) value = Math.max(field.min, value);
    if (field.max !== undefined) value = Math.min(field.max, value);
    if (field.integer) value = Math.round(value);
    onChange(writeFieldValue(root, path, value));
  };

  if (field.control === 'slider') {
    return (
      <div className="space-y-2" data-testid={domId(props)}>
        <div className="flex items-center justify-between gap-2">
          <Label>{field.label}</Label>
          <span className="tabular-nums text-muted-foreground text-sm">
            {current}
          </span>
        </div>
        <Slider
          aria-label={field.label}
          disabled={disabled}
          max={field.max}
          min={field.min}
          onValueChange={(next) => {
            const value = Array.isArray(next) ? next[0] : next;
            if (typeof value === 'number') commit(value);
          }}
          step={field.integer ? 1 : undefined}
          value={[current]}
        />
      </div>
    );
  }

  const atMin = field.min !== undefined && current <= field.min;
  const atMax = field.max !== undefined && current >= field.max;

  return (
    <div className="space-y-2" data-testid={domId(props)}>
      <Label htmlFor={domId(props)}>{field.label}</Label>
      <div
        className="flex w-fit items-center gap-1"
        data-slot="config-number-field"
      >
        <Button
          aria-label="decrement"
          disabled={disabled || atMin}
          onClick={() => commit(current - step)}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <IconMinus />
        </Button>
        <Input
          aria-label={field.label}
          className="h-8 w-20 text-center tabular-nums"
          disabled={disabled}
          id={domId(props)}
          inputMode={field.integer ? 'numeric' : 'decimal'}
          max={field.max}
          min={field.min}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) commit(parsed);
          }}
          step={step}
          type="number"
          value={current}
        />
        <Button
          aria-label="increment"
          disabled={disabled || atMax}
          onClick={() => commit(current + step)}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <IconPlus />
        </Button>
      </div>
      {field.hint ? (
        <p className="text-muted-foreground text-xs">{field.hint}</p>
      ) : null}
    </div>
  );
}

function TextField(props: FieldViewProps) {
  const { disabled, field, onChange, path, root } = props;
  if (field.kind !== 'text') return null;
  const current = String(readFieldValue(root, path) ?? '');
  const commit = (next: string) => onChange(writeFieldValue(root, path, next));

  return (
    <div className="space-y-2">
      <Label htmlFor={domId(props)}>{field.label}</Label>
      {field.multiline ? (
        <Textarea
          className="min-h-24"
          data-testid={domId(props)}
          disabled={disabled}
          id={domId(props)}
          maxLength={field.maxLength}
          onChange={(event) => commit(event.target.value)}
          value={current}
        />
      ) : (
        <Input
          data-testid={domId(props)}
          disabled={disabled}
          id={domId(props)}
          maxLength={field.maxLength}
          onChange={(event) => commit(event.target.value)}
          value={current}
        />
      )}
    </div>
  );
}

function ToggleSetField(props: FieldViewProps) {
  const { disabled, field, onChange, path, root } = props;
  if (field.kind !== 'toggle-set') return null;
  const raw = readFieldValue(root, path);
  const selected = new Set(Array.isArray(raw) ? raw.map(String) : []);
  // Contract requires a minimum count — lock the last remaining options rather
  // than letting the operator clear them and hit a backend validation error.
  const atMin = selected.size <= (field.minItems ?? 0);
  const toggle = (value: string, next: boolean) => {
    if (!next && atMin && selected.has(value)) return;
    const kept = field.options
      .map((option) => option.value)
      .filter((option) => (option === value ? next : selected.has(option)));
    onChange(writeFieldValue(root, path, kept));
  };

  return (
    <fieldset className="space-y-2" data-testid={domId(props)}>
      <legend className="font-medium text-sm">{field.label}</legend>
      <div className="flex flex-wrap gap-3">
        {field.options.map((option) => {
          const locked = Boolean(atMin && selected.has(option.value));
          const testId = `${domId(props)}-${option.value}`;
          return (
            <label
              className="flex items-center gap-2"
              htmlFor={testId}
              key={option.value}
            >
              <Switch
                checked={selected.has(option.value)}
                data-testid={testId}
                disabled={Boolean(disabled) || locked}
                id={testId}
                onCheckedChange={(next) => toggle(option.value, next === true)}
              />
              <span className="text-sm">{option.label}</span>
            </label>
          );
        })}
      </div>
      {field.minItems ? (
        <p className="text-muted-foreground text-xs">
          {admin_config_toggle_set_hint()}
        </p>
      ) : null}
    </fieldset>
  );
}

function ListField(props: FieldViewProps) {
  const { configKey, disabled, field, onChange, path, root } = props;
  if (field.kind !== 'list') return null;
  const raw = readFieldValue(root, path);
  const items = Array.isArray(raw) ? raw : [];
  const atMin = items.length <= (field.minItems ?? 0);
  const atMax = field.maxItems !== undefined && items.length >= field.maxItems;

  const addRow = () =>
    onChange(writeFieldValue(root, path, [...items, listItemTemplate(field)]));
  const removeRow = (index: number) =>
    onChange(
      writeFieldValue(
        root,
        path,
        items.filter((_, position) => position !== index)
      )
    );

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="space-y-1">
        <p className="font-medium text-sm">{field.label}</p>
        <p className="text-muted-foreground text-xs">
          {admin_config_list_count({ count: items.length })}
          {atMax
            ? ` · ${admin_config_list_max_reached({ count: field.maxItems ?? 0 })}`
            : ''}
          {atMin && (field.minItems ?? 0) > 0
            ? ` · ${admin_config_list_min_reached({ count: field.minItems ?? 0 })}`
            : ''}
        </p>
      </div>
      <Button
        data-testid={`${domId(props)}-add`}
        disabled={disabled || atMax}
        onClick={addRow}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconPlus />
        {admin_config_list_add()}
      </Button>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-3" data-testid={domId(props)}>
        {header}
        <p className="text-muted-foreground text-sm">
          {admin_config_list_empty()}
        </p>
      </div>
    );
  }

  if (field.layout === 'grid') {
    return (
      <div className="space-y-3" data-testid={domId(props)}>
        {header}
        <Table aria-label={field.label}>
          <TableHeader>
            <TableRow>
              {field.itemFields.map((itemField) => (
                <TableHead key={itemField.id}>{itemField.label}</TableHead>
              ))}
              <TableHead className="w-12 text-right">
                <span className="sr-only">{admin_config_list_remove()}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((_, index) => (
              <TableRow key={rowId(configKey, path, index)}>
                {field.itemFields.map((itemField) => (
                  <TableCell
                    className="align-middle whitespace-normal"
                    key={itemField.id}
                  >
                    <FieldView
                      configKey={configKey}
                      dense
                      disabled={disabled}
                      field={itemField}
                      onChange={onChange}
                      path={rowPath(path, index, itemField.path)}
                      root={root}
                    />
                  </TableCell>
                ))}
                <TableCell className="text-right align-middle">
                  <Button
                    data-testid={`${rowId(configKey, path, index)}-remove`}
                    disabled={disabled || atMin}
                    onClick={() => removeRow(index)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <IconTrash />
                    <span className="sr-only">
                      {admin_config_list_remove()}
                    </span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={domId(props)}>
      {header}
      <div className="space-y-4">
        {items.map((_, index) => (
          <fieldset
            className="space-y-3 rounded-lg border p-4"
            data-testid={rowId(configKey, path, index)}
            key={rowId(configKey, path, index)}
          >
            <legend className="px-1 font-medium text-sm">
              {admin_config_list_row({ index: index + 1 })}
            </legend>
            {field.itemFields.map((itemField) => (
              <FieldView
                configKey={configKey}
                disabled={disabled}
                field={itemField}
                key={itemField.id}
                onChange={onChange}
                path={rowPath(path, index, itemField.path)}
                root={root}
              />
            ))}
            <Button
              data-testid={`${rowId(configKey, path, index)}-remove`}
              disabled={disabled || atMin}
              onClick={() => removeRow(index)}
              size="sm"
              type="button"
              variant="outline"
            >
              <IconTrash />
              {admin_config_list_remove()}
            </Button>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function FieldView(props: FieldViewProps) {
  const { field } = props;
  switch (field.kind) {
    case 'boolean':
      return <BooleanField {...props} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'number':
      return <NumberField {...props} />;
    case 'text':
      return <TextField {...props} />;
    case 'toggle-set':
      return <ToggleSetField {...props} />;
    case 'list':
      return <ListField {...props} />;
    case 'group':
      return (
        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 font-medium text-sm">{field.label}</legend>
          {field.fields.map((child) => (
            <FieldView
              configKey={props.configKey}
              disabled={props.disabled}
              field={child}
              key={child.id}
              onChange={props.onChange}
              path={child.path}
              root={props.root}
            />
          ))}
        </fieldset>
      );
    default:
      return (
        <p className="text-muted-foreground text-sm" data-testid={domId(props)}>
          {field.kind === 'unsupported' ? field.reason : null}
        </p>
      );
  }
}

export function AdminConfigForm({
  configKey,
  disabled,
  onChange,
  optionMeta,
  value,
}: {
  configKey: string;
  disabled?: boolean;
  onChange: (next: unknown) => void;
  optionMeta?: (optionValue: string) => AdminConfigOptionMeta;
  value: unknown;
}) {
  const fields = useMemo(() => buildAdminConfigFields(configKey), [configKey]);
  if (fields.length === 0) return null;

  return (
    <div
      className="grid gap-4 md:grid-cols-2"
      data-testid={`admin-config-form-${configKey}`}
    >
      {fields.map((field) => (
        <div
          className={
            field.kind === 'list' || field.kind === 'group'
              ? 'md:col-span-2'
              : undefined
          }
          key={field.id}
        >
          <FieldView
            configKey={configKey}
            disabled={disabled}
            field={field}
            onChange={onChange}
            optionMeta={optionMeta}
            path={field.path}
            root={value}
          />
        </div>
      ))}
    </div>
  );
}
