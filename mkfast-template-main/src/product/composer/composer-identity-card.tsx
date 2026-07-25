import { Button } from '@/components/ui/button';

import type { IdentitySelectionProjection } from './identity-selection';

export function ComposerIdentityCard({
  defaultPending,
  onRemember,
  onRetry,
  onSelect,
  selection,
}: {
  defaultPending: boolean;
  onRemember: (identityId: string) => void;
  onRetry: () => void;
  onSelect: (identityId: string | null) => void;
  selection: IdentitySelectionProjection;
}) {
  return (
    <section
      aria-label="本次表达身份"
      className="meiye-porcelain rounded-2xl p-4"
      data-identity-state={selection.state}
      data-testid="composer-identity-selection"
    >
      {selection.identities.length > 0 ? (
        <>
          <p className="text-foreground text-sm">
            这次想用谁的口吻？说一次就好，我会按你的选择继续。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => onSelect(null)}
              size="sm"
              type="button"
              variant={selection.selected === null ? 'default' : 'outline'}
            >
              门店官方口吻
            </Button>
            {selection.identities.map((identity) => (
              <Button
                key={identity.id}
                onClick={() => onSelect(identity.id)}
                size="sm"
                type="button"
                variant={
                  selection.selected?.id === identity.id
                    ? 'default'
                    : 'outline'
                }
              >
                {identity.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      <p
        className={
          selection.state === 'query_failed'
            ? 'mt-2 text-sm text-destructive'
            : 'text-muted mt-2 text-sm'
        }
        role={selection.state === 'query_failed' ? 'alert' : undefined}
      >
        {selection.state === 'loading'
          ? '正在读取表达身份…'
          : selection.state === 'query_failed'
            ? '暂时无法读取表达身份，本次仍可继续创作。'
            : selection.state === 'empty'
              ? '还没有表达身份，本次仍可继续创作。'
              : selection.state === 'unselected'
                ? '尚未选择本次身份，本次仍可继续创作。'
                : selection.source === 'default'
                  ? '已带上你上次记住的身份；这次仍可切换。'
                  : '已选择本次表达身份，不会改动默认身份。'}
      </p>

      {selection.state === 'query_failed' ? (
        <Button
          className="mt-3"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          重新读取身份
        </Button>
      ) : null}

      {selection.selected && selection.source !== 'default' ? (
        <Button
          className="mt-3"
          disabled={defaultPending}
          onClick={() => onRemember(selection.selected!.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          {defaultPending
            ? '正在记住…'
            : `以后也用${selection.selected.label}的口吻`}
        </Button>
      ) : null}
    </section>
  );
}
