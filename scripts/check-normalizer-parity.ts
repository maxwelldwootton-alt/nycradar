/**
 * Verify the TypeScript address normalizer against real PLUTO addresses.
 *
 * Emits `address` / `ts_normalized` pairs as JSON so they can be compared with
 * the database's `normalize_address_text()` output. The two implementations
 * must agree exactly or address search silently returns nothing.
 *
 *   npx tsx scripts/check-normalizer-parity.ts > pairs.json
 */

import { normalizeAddress, splitHouseNumber, splitStreet } from "../src/lib/nyc/address";

const BOROS = ["MN", "BX", "BK", "QN", "SI"];

async function sample(boro: string, limit: number): Promise<string[]> {
  const params = new URLSearchParams({
    $select: "address",
    $where: `borough='${boro}' AND address IS NOT NULL`,
    // Spread the sample across the borough rather than taking one contiguous run.
    $order: "bbl",
    $limit: String(limit),
    $offset: String(Math.floor(Math.random() * 20000)),
  });
  const res = await fetch(
    `https://data.cityofnewyork.us/resource/64uk-42ks.json?${params}`,
  );
  const rows = (await res.json()) as { address?: string }[];
  return rows.map((r) => r.address).filter(Boolean) as string[];
}

async function main() {
  const addresses = new Set<string>();

  for (const boro of BOROS) {
    for (const a of await sample(boro, 40)) addresses.add(a);
  }

  // Force-include the shapes that have diverged before: apostrophes,
  // spelled-out ordinals, hyphenated Queens house numbers.
  const tricky = [
    "345 ST ANN'S AVENUE",
    "350 FIFTH AVENUE",
    "114-15 ROCKAWAY BEACH BOULEVARD",
    "530 EAST 169 STREET",
    "1 JOHN STREET",
    "10 BAY STREET LANDING",
    "2541 ADAM C POWELL BLVD",
    "700 ESPLANADE GDNS PLAZA",
    "86-27 122 STREET",
    "ST MARK'S PLACE",
    "WEST 231 STREET",
    "5 AVENUE",
    "5 STREET",
  ];
  for (const t of tricky) addresses.add(t);

  const pairs = [...addresses].map((address) => ({
    address,
    ts: normalizeAddress(address),
    house: splitHouseNumber(normalizeAddress(address)),
    street: splitStreet(normalizeAddress(address)),
  }));

  console.log(JSON.stringify(pairs));
  console.error(`${pairs.length} addresses normalized`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
