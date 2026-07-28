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
      aria-label="这次用谁的口吻"
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
                  selection.selected?.id === identity.id ? 'default' : 'outline'
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
        {/* 「身份」是后台叫法，店主读不出要不要管它。这张卡开头问的是「用谁的
            口吻」，下面每一句就都用「口吻」，并且明说不选会发生什么——默认落到
            门店官方口吻，创作照常。 */}
        {selection.state === 'loading'
          ? '正在看你登记过哪些口吻…'
          : selection.state === 'query_failed'
            ? '暂时读不到你登记过的口吻，这次先用门店官方口吻，创作不受影响。'
            : selection.state === 'empty'
              ? '你还没登记过别的口吻，这次就用门店官方口吻，不影响创作。'
              : selection.state === 'unselected'
                ? '这次还没选口吻，不选就用门店官方口吻。'
                : selection.source === 'default'
                  ? '已带上你上次记住的口吻；这次仍可切换。'
                  : '这次用你选的口吻，不会改掉你平时的默认。'}
      </p>

      {selection.state === 'query_failed' ? (
        <Button
          className="mt-3"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          再读一次
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
