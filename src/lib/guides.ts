/**
 * Static content for the informational /guides section.
 *
 * Plain data + a generic renderer rather than MDX — the project has no MDX
 * tooling, and four short articles don't justify adding any. Claims here are
 * deliberately kept to what the product's own report surfaces already assert
 * (see Disclaimer.tsx, ReportTeaser.tsx) rather than introducing new legal or
 * procedural specifics that would need a real-estate-attorney review (PRD §12).
 */

export interface GuideSection {
  heading?: string;
  paragraphs: string[];
}

export interface Guide {
  slug: string;
  title: string;
  /** Used as the meta description and the dek under the H1. */
  description: string;
  updated: string;
  sections: GuideSection[];
}

export const GUIDES: Guide[] = [
  {
    slug: "dob-violations-before-buying",
    title: "How to Check NYC DOB Violations Before Buying a Property",
    description:
      "What Department of Buildings violations are, why they matter before closing, and how to look them up for any NYC address.",
    updated: "2026-08-03",
    sections: [
      {
        paragraphs: [
          "The NYC Department of Buildings (DOB) enforces the city's construction and building codes. When an inspector finds a condition that doesn't comply — anything from illegal construction to a facade in disrepair — DOB issues a violation against the property. Some of these are administrative (paperwork, permits, filings); others point to a physical condition that needs correction. Both kinds attach to the property record, not just to whoever owned the building when the violation was issued.",
        ],
      },
      {
        heading: "Why this matters before you buy",
        paragraphs: [
          "Open DOB violations don't disappear at closing — they transfer with the property. A buyer who doesn't check for them can inherit outstanding penalties, a requirement to complete corrective work, or in some cases a docketed judgment that behaves like a lien. None of that shows up in a standard listing, and it's easy to miss unless you specifically pull the violation history.",
          "DOB violations that go through adjudication become ECB (Environmental Control Board) civil penalties, heard at OATH — a related but separate dataset from the original DOB violation record. A property can look clean in one system and still carry unresolved penalties in the other, which is why a useful check pulls from both.",
        ],
      },
      {
        heading: "What to look for",
        paragraphs: [
          "Three things matter most: whether a violation is still open or has been closed/dismissed, how severe it is, and whether any associated penalty has become a docketed judgment. A handful of old, closed, minor violations is normal for almost any building in New York City. A pattern of open, unresolved, or expensive violations — especially ones with judgments attached — is worth raising with the seller or your attorney before you're under contract.",
        ],
      },
      {
        heading: "Where to check",
        paragraphs: [
          "DOB violation data is public and searchable by address or BBL (borough-block-lot) through NYC Open Data, though matching records across DOB, ECB, and the related HPD and OATH datasets by hand takes time — the same summons can appear differently in each. ",
        ],
      },
    ],
  },
  {
    slug: "hpd-violations-explained",
    title: "HPD Violations Explained: Classes A, B, and C",
    description:
      "How NYC's Housing Preservation & Development agency classifies violations by hazard level, and what each class generally signals about a building's condition.",
    updated: "2026-08-03",
    sections: [
      {
        paragraphs: [
          "The NYC Department of Housing Preservation and Development (HPD) enforces the Housing Maintenance Code — the rules covering heat, hot water, pests, structural conditions, and general upkeep in residential buildings. When a tenant complaint or inspection turns up a problem, HPD issues a violation and assigns it a hazard class.",
        ],
      },
      {
        heading: "The three classes",
        paragraphs: [
          "Class A covers non-hazardous conditions — things like a missing smoke detector sign or a minor cosmetic issue. Class B covers hazardous conditions, such as a broken window or inadequate lighting in a common area. Class C is the most serious: immediately hazardous conditions like no heat or hot water, a rodent infestation, or vermin conditions. Each class generally carries a different expected timeframe for correction, with Class C conditions expected to be addressed the fastest.",
          "The class assigned at issuance does not change even after the underlying condition is fixed — it stays on the record as \"closed,\" so a building's violation history is really a timeline of what went wrong and when it was resolved, not just a live snapshot.",
        ],
      },
      {
        heading: "Why buyers and renters check this",
        paragraphs: [
          "A high volume of open Class C violations is a meaningfully different signal than a long list of old, closed Class A violations. The former suggests active, unresolved habitability problems; the latter is closer to routine wear-and-tear that most occupied buildings accumulate over the years. Looking at the mix — not just the total count — is what makes the HPD record useful.",
        ],
      },
      {
        heading: "One important caveat",
        paragraphs: [
          "HPD violations are filed against a building, and a single tax lot can contain multiple buildings (identified by BIN). A thorough check accounts for every building on the lot, not just the address that was searched — otherwise it's possible to miss violations filed against a different building on the same parcel.",
        ],
      },
    ],
  },
  {
    slug: "ecb-oath-judgments-explained",
    title: "ECB and OATH Judgments: Why They Matter at Closing",
    description:
      "What a docketed ECB/OATH judgment is, how it differs from an ordinary open violation, and why it deserves attention before a NYC real estate closing.",
    updated: "2026-08-03",
    sections: [
      {
        paragraphs: [
          "When a DOB violation is adjudicated, it's heard by the Environmental Control Board (ECB) at the Office of Administrative Trials and Hearings (OATH). If a penalty is imposed and goes unpaid, it can be docketed as a civil judgment. That's a meaningfully different status than a plain open violation.",
        ],
      },
      {
        heading: "Why a docketed judgment is different",
        paragraphs: [
          "Docketed OATH judgments accrue interest and can become liens. Unlike a violation that simply needs corrective work, an unpaid judgment is a financial obligation attached to the property that grows over time until it's satisfied. It's also part of the public record independent of whether the underlying physical condition was ever fixed.",
        ],
      },
      {
        heading: "Why this matters for a transaction",
        paragraphs: [
          "Outstanding penalties and judgments are the kind of thing that can complicate or delay a closing if they surface late — title issues, negotiation over who pays, or unexpected costs after the deal is done. Checking for them early, while there's still time to resolve or negotiate around them, is far better than discovering one during attorney review.",
        ],
      },
      {
        heading: "ECB and OATH aren't the same list",
        paragraphs: [
          "The same underlying summons can appear in both the ECB dataset and the OATH dataset, described from different angles — ECB carries severity and certification status, OATH carries the docketed judgment itself. Roughly four out of five ECB summonses also show up in OATH's records. Counting both without accounting for the overlap roughly doubles the apparent number of violations and the dollars owed, which is a common way manual lookups overstate a property's issues.",
        ],
      },
    ],
  },
  {
    slug: "pre-closing-due-diligence-checklist",
    title: "A Pre-Closing Due Diligence Checklist for NYC Property Buyers",
    description:
      "A practical checklist of the public-record items worth reviewing before closing on a New York City property, beyond the standard inspection.",
    updated: "2026-08-03",
    sections: [
      {
        paragraphs: [
          "A home inspection covers the physical condition of a unit. It doesn't cover what's sitting in city agency databases — open violations, outstanding penalties, and judgments filed against the property itself. Those are worth checking separately, and early, while there's still room to negotiate or walk away.",
        ],
      },
      {
        heading: "What to check",
        paragraphs: [
          "DOB violations — administrative and physical-condition issues filed by the Department of Buildings, including anything tied to illegal construction or non-compliant work.",
          "HPD violations — housing maintenance issues (heat, hot water, pests, structural conditions), classified by hazard level, filed by the Department of Housing Preservation and Development.",
          "ECB/OATH records — adjudicated penalties and, critically, any docketed judgments, which behave differently from an ordinary open violation and can accrue interest.",
          "Multi-building lots — if the tax lot contains more than one building, confirm violations are being checked against every building on the lot, not just one address.",
        ],
      },
      {
        heading: "A reasonable order of operations",
        paragraphs: [
          "Pull the violation history as early as possible — ideally before signing a contract, or at minimum during the attorney review period. Flag anything open, anything with a docketed judgment, and anything unusually recent. Bring specific findings to your attorney rather than a general question — \"there's a docketed OATH judgment from [date] for $X\" is far more actionable than \"can you check for violations.\"",
        ],
      },
      {
        heading: "What this doesn't replace",
        paragraphs: [
          "A violation history is informational, not a substitute for a title search, a licensed inspection, or legal advice from an attorney familiar with the transaction. It's one input among several — but it's a public-record input that's easy to check and easy to miss.",
        ],
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
