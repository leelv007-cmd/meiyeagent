import postgres from 'postgres';
import {
  buildStripeRetirementAuditReport,
  STRIPE_RETIREMENT_AUDIT_SQL,
  type StripeRetirementAuditRow,
} from '../src/payment/stripe-retirement-audit';

function databaseConnectionString() {
  const value =
    process.env.DATABASE_URL?.trim() ||
    process.env.HYPERDRIVE_CONNECTION_STRING?.trim();
  if (!value) {
    throw new Error(
      'DATABASE_URL or HYPERDRIVE_CONNECTION_STRING must be configured.'
    );
  }
  return value;
}

const sql = postgres(databaseConnectionString(), { max: 1, prepare: false });

try {
  const rows = await sql.begin(async (transaction) => {
    await transaction.unsafe('SET TRANSACTION READ ONLY');
    return transaction.unsafe<StripeRetirementAuditRow[]>(
      STRIPE_RETIREMENT_AUDIT_SQL
    );
  });
  process.stdout.write(
    `${JSON.stringify(buildStripeRetirementAuditReport([...rows]), null, 2)}\n`
  );
} finally {
  await sql.end();
}
