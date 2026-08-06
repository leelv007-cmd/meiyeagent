/**
 * 受控配置的结构化表单（U05 / D-107）。
 *
 * `admin-config-field-model.ts` 把配置契约读成字段树，这里把字段树摆成运营
 * 真正会用的控件：开关、下拉、步进器、优先级滑杆、成组的行编辑。
 * 后台因此不再出现「请输入与配置项匹配的 JSON」这类要求——
 * 长文字段（写作要点这种）仍是多行输入框，但那是散文，不是要人拼对的结构。
 *
 * 表单只负责改值；保存仍走原来的影响面确认 + 写入原因 + CAS，一步没少。
 */
import { Badge } from '@/components/reui/badge';
import { ListBox } from '@heroui/react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo } from 'react';

import type { DataGridColumn } from '@/components/heroui-pro';
import {
  CellSelect,
  CellSlider,
  CellSwitch,
  DataGrid,
  NativeSelect,
  NumberStepper,
} from '@/components/heroui-pro';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

/**
 * 选项在**当下**的运行时状态：哪个正在生效、哪个因为缺东西装不起来。
 * 这些不在契约里，由拿着配置行的控制器传进来；表单本身不认识运行时。
 */
export interface AdminConfigOptionMeta {
  /** 装不起来的原因（缺凭据之类），有值即置灰。 */
  blockedReason?: string;
  /** 「HTTP · 当前生效」这类小标签。 */
  chips?: string[];
}

interface FieldViewProps {
  configKey: string;
  /** 行内格子用更紧的控件，成表单的字段用常规控件。 */
  dense?: boolean;
  disabled?: boolean;
  field: AdminConfigField;
  onChange: (next: unknown) => void;
  optionMeta?: (optionValue: string) => AdminConfigOptionMeta;
  /** 解析后的真实路径（列表把模板里的下标换成行号）。 */
  path: AdminConfigFieldPath;
  root: unknown;
}

/**
 * 控件的 DOM id 一律按解析后的路径算，不用 `field.id`——后者来自列表的模板
 * 路径（下标恒为 0），直接用会让每一行顶着同一个 id，`<label for>` 也指错。
 */
function domId(props: Pick<FieldViewProps, 'configKey' | 'path'>) {
  return adminConfigFieldId(props.configKey, props.path);
}

/** 列表模板里的下标占位换成真实行号。 */
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
    <CellSwitch.Root
      data-testid={domId(props)}
      isDisabled={disabled}
      isSelected={checked}
      onChange={(next) => onChange(writeFieldValue(root, path, next))}
    >
      <CellSwitch.Trigger>
        <CellSwitch.Label>{field.label}</CellSwitch.Label>
        <CellSwitch.Control />
      </CellSwitch.Trigger>
    </CellSwitch.Root>
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

  // 整项就是一个枚举：几个选项并排，各自带解释与当下状态，让人能比较着选。
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

  if (dense) {
    return (
      <CellSelect.Root
        aria-label={field.label}
        isDisabled={disabled}
        onSelectionChange={(next) =>
          onChange(writeFieldValue(root, path, String(next)))
        }
        selectedKey={current}
      >
        <CellSelect.Trigger data-testid={domId(props)}>
          <CellSelect.Value />
          <CellSelect.Indicator />
        </CellSelect.Trigger>
        <CellSelect.Popover>
          <ListBox>
            {field.options.map((option) => (
              <ListBox.Item
                id={option.value}
                key={option.value}
                textValue={option.label}
              >
                {option.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </CellSelect.Popover>
      </CellSelect.Root>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={domId(props)}>{field.label}</Label>
      <NativeSelect.Root fullWidth>
        <NativeSelect.Trigger
          data-testid={domId(props)}
          disabled={disabled}
          id={domId(props)}
          onChange={(event) =>
            onChange(writeFieldValue(root, path, event.target.value))
          }
          value={current}
        >
          {field.options.map((option) => (
            <NativeSelect.Option key={option.value} value={option.value}>
              {option.label}
            </NativeSelect.Option>
          ))}
        </NativeSelect.Trigger>
      </NativeSelect.Root>
    </div>
  );
}

function NumberField(props: FieldViewProps) {
  const { disabled, field, onChange, path, root } = props;
  if (field.kind !== 'number') return null;
  const raw = readFieldValue(root, path);
  const current = typeof raw === 'number' ? raw : (field.min ?? 0);
  const commit = (next: number) => onChange(writeFieldValue(root, path, next));

  if (field.control === 'slider') {
    return (
      <div className="space-y-2" data-testid={domId(props)}>
        <CellSlider.Root
          aria-label={field.label}
          isDisabled={disabled}
          maxValue={field.max}
          minValue={field.min}
          onChange={(next) => commit(Array.isArray(next) ? next[0] : next)}
          step={field.integer ? 1 : undefined}
          value={current}
        >
          <CellSlider.Label>{field.label}</CellSlider.Label>
          <CellSlider.Output />
          <CellSlider.Track>
            <CellSlider.Fill />
            <CellSlider.Thumb />
          </CellSlider.Track>
        </CellSlider.Root>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={domId(props)}>
      <Label>{field.label}</Label>
      <NumberStepper.Root
        aria-label={field.label}
        isDisabled={disabled}
        maxValue={field.max}
        minValue={field.min}
        onChange={commit}
        step={field.integer ? 1 : undefined}
        value={current}
      >
        <NumberStepper.Group>
          <NumberStepper.DecrementButton />
          <NumberStepper.Value />
          <NumberStepper.IncrementButton />
        </NumberStepper.Group>
      </NumberStepper.Root>
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
  // 契约要求至少留几个，就真的关不掉最后那几个——只在下面写句提示、
  // 让人关掉再被后端打回来，是把校验当成了说明书。
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
        {field.options.map((option) => (
          <CellSwitch.Root
            data-testid={`${domId(props)}-${option.value}`}
            isDisabled={disabled || (atMin && selected.has(option.value))}
            isSelected={selected.has(option.value)}
            key={option.value}
            onChange={(next) => toggle(option.value, next)}
          >
            <CellSwitch.Trigger>
              <CellSwitch.Label>{option.label}</CellSwitch.Label>
              <CellSwitch.Control />
            </CellSwitch.Trigger>
          </CellSwitch.Root>
        ))}
      </div>
      {field.minItems ? (
        <p className="text-muted-foreground text-xs">
          {admin_config_toggle_set_hint()}
        </p>
      ) : null}
    </fieldset>
  );
}

interface GridRow {
  __index: number;
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
    const rows: GridRow[] = items.map((_, index) => ({ __index: index }));
    const columns: DataGridColumn<GridRow>[] = [
      ...field.itemFields.map((itemField, position) => ({
        cell: (row: GridRow) => (
          <FieldView
            configKey={configKey}
            dense
            disabled={disabled}
            field={itemField}
            onChange={onChange}
            path={rowPath(path, row.__index, itemField.path)}
            root={root}
          />
        ),
        header: itemField.label,
        id: itemField.id,
        isRowHeader: position === 0,
      })),
      {
        align: 'end' as const,
        cell: (row: GridRow) => (
          <Button
            data-testid={`${rowId(configKey, path, row.__index)}-remove`}
            disabled={disabled || atMin}
            onClick={() => removeRow(row.__index)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <IconTrash />
            <span className="sr-only">{admin_config_list_remove()}</span>
          </Button>
        ),
        header: '',
        id: `${domId(props)}-actions`,
      },
    ];

    return (
      <div className="space-y-3" data-testid={domId(props)}>
        {header}
        <DataGrid
          aria-label={field.label}
          columns={columns}
          data={rows}
          getRowId={(row) => row.__index}
          verticalAlign="middle"
        />
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
