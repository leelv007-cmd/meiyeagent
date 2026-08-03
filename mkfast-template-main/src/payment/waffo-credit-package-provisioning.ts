import {
  TaxCategory,
  type CreateOnetimeProductParams,
  type GraphQLResponse,
} from '@waffo/pancake-ts';
import {
  WAFFO_CREDIT_PACKAGE_OFFERS,
  type WaffoCreditPackageOfferId,
} from './waffo-credit-package-catalog';

export type WaffoCreditPackageProvisioningMode = 'dry-run' | 'apply';

export interface WaffoCreditPackageProvisioningInput {
  storeId: string;
  environment?: 'test';
  mode?: WaffoCreditPackageProvisioningMode;
}

export type WaffoCreditPackageProductPlan = {
  offerId: WaffoCreditPackageOfferId;
  createInput: CreateOnetimeProductParams;
};

export type WaffoCreditPackageProvisioningPlan = {
  environment: 'test';
  products: WaffoCreditPackageProductPlan[];
  storeId: string;
};

export interface WaffoCreditPackageProvisioningClient {
  graphql: {
    query<T>(input: {
      query: string;
      variables?: Record<string, unknown>;
    }): Promise<GraphQLResponse<T>>;
  };
  onetimeProducts: {
    create(
      input: CreateOnetimeProductParams
    ): Promise<{ product: { id: string } }>;
  };
}

export class WaffoCreditPackageProvisioningError extends Error {
  constructor(message: string) {
    super(`Waffo Test credit-package provisioning blocked: ${message}`);
    this.name = 'WaffoCreditPackageProvisioningError';
  }
}

type GraphQLPrice = {
  currency: string;
  priceInfo: { amount: string; taxCategory: string };
};

type GraphQLProduct = {
  hasProdVersion: boolean;
  id: string;
  metadata: Record<string, unknown> | string | null;
  name: string;
  prices: GraphQLPrice[];
  status: string;
};

type ExistingCatalog = {
  onetimeProducts: GraphQLProduct[];
};

export function buildWaffoCreditPackageProvisioningPlan(
  storeId: string
): WaffoCreditPackageProvisioningPlan {
  const normalizedStoreId = requiredValue('storeId', storeId);

  return {
    environment: 'test',
    products: WAFFO_CREDIT_PACKAGE_OFFERS.map((sku) => ({
      offerId: sku.offerId,
      createInput: {
        storeId: normalizedStoreId,
        name: `Credits ${sku.credits} ${sku.currency}`,
        prices: {
          [sku.currency]: {
            amount: sku.amount,
            taxCategory: TaxCategory.SaaS,
          },
        },
        metadata: {
          commerceScene: 'credit_package',
          commerceSku: sku.offerId,
          credits: sku.credits,
          expireDays: sku.expireDays,
        },
      },
    })),
    storeId: normalizedStoreId,
  };
}

export async function provisionWaffoCreditPackageCatalog(
  client: WaffoCreditPackageProvisioningClient | undefined,
  input: WaffoCreditPackageProvisioningInput
) {
  if (input.environment !== undefined && input.environment !== 'test') {
    throw new WaffoCreditPackageProvisioningError(
      'environment must be explicitly test.'
    );
  }
  const mode = input.mode ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new WaffoCreditPackageProvisioningError(
      'mode must be dry-run or apply.'
    );
  }
  if (mode === 'apply' && input.environment !== 'test') {
    throw new WaffoCreditPackageProvisioningError(
      'apply requires an explicit test environment.'
    );
  }
  const plan = buildWaffoCreditPackageProvisioningPlan(input.storeId);
  if (mode === 'dry-run') {
    return { mode, plan } as const;
  }
  if (!client) {
    throw new WaffoCreditPackageProvisioningError(
      'an SDK client is required for apply.'
    );
  }

  const existing = await readExistingCatalog(client, plan.storeId);
  const productIds = {} as Record<WaffoCreditPackageOfferId, string>;
  let createdProducts = 0;

  for (const product of plan.products) {
    const existingProduct = findProduct(existing.onetimeProducts, product);
    const productId =
      existingProduct?.id ??
      (await client.onetimeProducts.create(product.createInput)).product.id;
    requireCreatedId('product', productId);
    if (!existingProduct) createdProducts += 1;
    productIds[product.offerId] = productId;
  }

  return {
    created: { products: createdProducts },
    mode: 'applied' as const,
    productIds,
  } as const;
}

async function readExistingCatalog(
  client: WaffoCreditPackageProvisioningClient,
  storeId: string
): Promise<ExistingCatalog> {
  const response = await client.graphql.query<ExistingCatalog>({
    query: `query WaffoCreditPackageProvisioningCatalog($storeId: String!) {
      onetimeProducts(storeId: $storeId) {
        id
        name
        prices { currency priceInfo { amount taxCategory } }
        status
        metadata
        hasProdVersion
      }
    }`,
    variables: { storeId },
  });
  if (response.errors?.length || !response.data) {
    throw new WaffoCreditPackageProvisioningError('catalog read failed.');
  }
  if (!Array.isArray(response.data.onetimeProducts)) {
    throw new WaffoCreditPackageProvisioningError(
      'catalog response is malformed.'
    );
  }
  return response.data;
}

function findProduct(
  products: GraphQLProduct[],
  expected: WaffoCreditPackageProductPlan
): GraphQLProduct | undefined {
  const candidates = products.filter((product) => {
    const metadata = normalizeMetadata(product.metadata);
    return (
      product.name === expected.createInput.name ||
      metadata?.commerceSku === expected.offerId
    );
  });
  if (candidates.length > 1) {
    throw new WaffoCreditPackageProvisioningError(
      `ambiguous canonical product ${expected.offerId}.`
    );
  }
  const product = candidates[0];
  if (!product) return undefined;

  assertProductMatches(product, expected);
  return product;
}

function assertProductMatches(
  product: GraphQLProduct,
  expected: WaffoCreditPackageProductPlan
): void {
  const expectedPrices = Object.entries(expected.createInput.prices);
  const [expectedCurrency, expectedPrice] = expectedPrices[0] ?? [];
  if (
    expectedPrices.length !== 1 ||
    !expectedCurrency ||
    !expectedPrice ||
    product.name !== expected.createInput.name ||
    product.status !== 'active' ||
    product.hasProdVersion !== false ||
    product.prices.length !== 1 ||
    product.prices[0]?.currency !== expectedCurrency ||
    product.prices[0].priceInfo.amount !== expectedPrice.amount ||
    product.prices[0].priceInfo.taxCategory !== expectedPrice.taxCategory ||
    !metadataEqual(product.metadata, expected.createInput.metadata)
  ) {
    throw new WaffoCreditPackageProvisioningError(
      `catalog drift for product ${expected.offerId}.`
    );
  }
}

function metadataEqual(
  actual: Record<string, unknown> | string | null,
  expected: Record<string, unknown> | undefined
): boolean {
  const normalizedActual = normalizeMetadata(actual);
  if (!normalizedActual || !expected) return normalizedActual === expected;
  const actualKeys = Object.keys(normalizedActual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    sameStringArray(actualKeys, expectedKeys) &&
    actualKeys.every((key) => normalizedActual[key] === expected[key])
  );
}

function normalizeMetadata(
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requireCreatedId(
  kind: string,
  value: string | undefined
): asserts value is string {
  if (!value?.trim()) {
    throw new WaffoCreditPackageProvisioningError(
      `${kind} create returned no ID.`
    );
  }
}

function requiredValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new WaffoCreditPackageProvisioningError(`${name} is required.`);
  }
  return normalized;
}
