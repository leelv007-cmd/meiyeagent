import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  content_module_label_before_after,
  content_module_label_package_explainer,
  content_module_label_price_card,
  content_module_label_review_card,
  content_module_label_shooting_checklist,
  content_module_label_social_cover,
  content_module_label_store_intro,
  content_module_manual_description,
  content_module_material_requirement,
  content_module_persistence_note,
  content_module_preset_description,
  content_module_requirement_before_after,
  content_module_requirement_package_explainer,
  content_module_requirement_price_card,
  content_module_requirement_review_card,
  content_module_requirement_shooting_checklist,
  content_module_requirement_social_cover,
  content_module_requirement_store_intro,
  content_module_select_legend,
  content_module_selected_count,
  content_module_structure_title,
  content_module_title,
  content_module_unavailable,
  content_module_unavailable_entry,
  content_module_unavailable_preset,
} from '@/locale/paraglide/messages';
import {
  creativeContentModuleIds,
  type CreativeContentModuleId,
} from '@meiye/contracts';

export const CONTENT_MODULE_LABELS = {
  get before_after() {
    return content_module_label_before_after();
  },
  get package_explainer() {
    return content_module_label_package_explainer();
  },
  get price_card() {
    return content_module_label_price_card();
  },
  get review_card() {
    return content_module_label_review_card();
  },
  get shooting_checklist() {
    return content_module_label_shooting_checklist();
  },
  get social_cover() {
    return content_module_label_social_cover();
  },
  get store_intro() {
    return content_module_label_store_intro();
  },
} satisfies Record<CreativeContentModuleId, string>;

export const CONTENT_MODULE_REQUIREMENTS = {
  get before_after() {
    return content_module_requirement_before_after();
  },
  get package_explainer() {
    return content_module_requirement_package_explainer();
  },
  get price_card() {
    return content_module_requirement_price_card();
  },
  get review_card() {
    return content_module_requirement_review_card();
  },
  get shooting_checklist() {
    return content_module_requirement_shooting_checklist();
  },
  get social_cover() {
    return content_module_requirement_social_cover();
  },
  get store_intro() {
    return content_module_requirement_store_intro();
  },
} satisfies Record<CreativeContentModuleId, string>;

export function ContentModuleBuilder({
  availableModules,
  disabled,
  onChange,
  presetName,
  selectedModules,
}: {
  availableModules: CreativeContentModuleId[];
  disabled: boolean;
  onChange: (modules: CreativeContentModuleId[]) => void;
  presetName?: string;
  selectedModules: CreativeContentModuleId[];
}) {
  return (
    <section
      aria-labelledby="content-suite-title"
      className="space-y-4 overflow-hidden rounded-xl border bg-background p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="text-sm font-semibold text-foreground"
            id="content-suite-title"
          >
            {content_module_title()}
          </h3>
          <p className="mt-1 text-sm/6 text-muted-foreground">
            {presetName
              ? content_module_preset_description({ preset: presetName })
              : content_module_manual_description()}
          </p>
        </div>
        <Badge variant="secondary">
          {content_module_selected_count({ count: selectedModules.length })}
        </Badge>
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          {content_module_select_legend()}
        </legend>
        <div className="divide-y divide-border border-y border-border">
          {creativeContentModuleIds.map((moduleId, index) => {
            const checked = selectedModules.includes(moduleId);
            const available = availableModules.includes(moduleId);
            return (
              <div
                className="flex min-h-touch-target gap-3 py-3.5"
                key={moduleId}
              >
                <div className="flex h-6 shrink-0 items-center">
                  <Checkbox
                    aria-label={CONTENT_MODULE_LABELS[moduleId]}
                    checked={checked}
                    disabled={
                      disabled ||
                      !available ||
                      (checked && selectedModules.length === 1)
                    }
                    id={`content-module-${moduleId}`}
                    onCheckedChange={(nextChecked) => {
                      if (!available) return;
                      if (nextChecked) {
                        onChange([...selectedModules, moduleId]);
                      } else if (selectedModules.length > 1) {
                        onChange(
                          selectedModules.filter(
                            (candidate) => candidate !== moduleId
                          )
                        );
                      }
                    }}
                  />
                </div>
                <label
                  className="min-w-0 flex-1 text-sm/6"
                  htmlFor={`content-module-${moduleId}`}
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span>
                      {index + 1}. {CONTENT_MODULE_LABELS[moduleId]}
                    </span>
                    {!available ? (
                      <Badge variant="outline">
                        {content_module_unavailable()}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-muted-foreground">
                    {content_module_material_requirement({
                      requirement: CONTENT_MODULE_REQUIREMENTS[moduleId],
                    })}
                  </span>
                  {!available ? (
                    <span className="block text-xs text-muted-foreground">
                      {presetName
                        ? content_module_unavailable_preset({
                            preset: presetName,
                          })
                        : content_module_unavailable_entry()}
                    </span>
                  ) : null}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="text-sm">
        <p className="text-xs font-medium text-muted-foreground">
          {content_module_structure_title()}
        </p>
        <ol className="mt-2 flex flex-wrap items-center gap-2 border-y border-border py-3">
          {selectedModules.map((moduleId, index) => (
            <li className="flex items-center gap-2" key={moduleId}>
              {index > 0 ? <span aria-hidden="true">→</span> : null}
              <Badge variant="outline">{CONTENT_MODULE_LABELS[moduleId]}</Badge>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted-foreground">
        {content_module_persistence_note()}
      </p>
    </section>
  );
}
