export interface PublishableStatus {
  id: string;
  status: string;
}

export function publishedTransitions(
  previous: Record<string, string> | undefined,
  values: PublishableStatus[]
) {
  const snapshot = Object.fromEntries(
    values.map((value) => [value.id, value.status])
  );
  if (!previous) return { newlyPublished: [] as string[], snapshot };
  const newlyPublished = values.flatMap((value) =>
    value.status === 'published' &&
    previous[value.id] !== undefined &&
    previous[value.id] !== 'published'
      ? [value.id]
      : []
  );
  return { newlyPublished, snapshot };
}
