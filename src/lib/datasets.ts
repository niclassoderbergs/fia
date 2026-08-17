// eSett-strukturen som enda källa: navet, sidorna och förändringsflödets
// gruppering läser alla härifrån. Ordning, titlar och slugs är eSetts egna
// (extraherade ur opendata.esett.com:s meny 2026-08-17) — vyn ska kännas igen
// av den som redan använder deras sida, och varje vy ska gå att slå upp mot
// exakt en API-endpoint.
//
// Bara strukturdata. Priser, volymer och avgifter (EXP05, EXP08–EXP18) hålls
// medvetet utanför.

export interface DatasetDef {
  /** URL-slug, samma som eSetts (/dso, /mga, /rbr …). */
  slug: string;
  /** eSetts egen rubrik, oöversatt — det är så datat heter hos källan. */
  title: string;
  /** Exportgrupp hos eSett. Visas som badge tillsammans med titeln. */
  exp: string;
  /** Endpoint som fyller vyn, så som importern anropar den. */
  endpoint: string;
  /** Entity-värdet i RecordChange-poster som hör hemma här. null = RBR (egen difftyp). */
  entity: string | null;
  /** Kort etikett i flödets sammanfattningsrad. */
  short: string;
}

export const DATASETS: readonly DatasetDef[] = [
  {
    slug: 'brp',
    title: 'Balance Responsible Parties',
    exp: 'EXP01',
    endpoint: '/EXP01/BalanceResponsibleParties?country=SE',
    entity: 'brp_party',
    short: 'BRP',
  },
  {
    slug: 'bsp',
    title: 'Balancing Service Providers',
    exp: 'EXP01',
    endpoint: '/EXP01/BalanceServiceProviders?country=SE',
    entity: 'bsp',
    short: 'BSP',
  },
  {
    slug: 'dso',
    title: 'Distribution System Operators',
    exp: 'EXP01',
    endpoint: '/EXP01/DistributionSystemOperators?country=SE',
    entity: 'dso',
    short: 'DSO',
  },
  {
    slug: 'mga',
    title: 'Metering Grid Areas',
    exp: 'EXP03',
    endpoint: '/EXP03/MeteringGridAreas?mgaType=DISTRIBUTION',
    entity: 'grid_area',
    short: 'MGA',
  },
  {
    slug: 'rbr',
    title: 'Retailer Balance Responsibilities',
    exp: 'EXP04',
    endpoint: '/EXP04/RetailerBalanceResponsibility?mba=<EIC>',
    entity: null,
    short: 'RBR',
  },
  {
    slug: 'retailers',
    title: 'Retailers',
    exp: 'EXP01',
    endpoint: '/EXP01/Retailers?country=SE',
    entity: 'retailer',
    short: 'Retailers',
  },
  {
    slug: 'sb',
    title: 'Settlement Banks',
    exp: 'EXP06',
    endpoint: '/EXP06/Banks',
    entity: 'bank',
    short: 'SB',
  },
];

export const DATASET_BY_ENTITY: ReadonlyMap<string, DatasetDef> = new Map(
  DATASETS.filter((d) => d.entity !== null).map((d) => [d.entity as string, d]),
);

export function datasetBySlug(slug: string): DatasetDef | undefined {
  return DATASETS.find((d) => d.slug === slug);
}

/** RBR-datasetet — förändringarna med egen difftyp (BrpChange). */
export const RBR = DATASETS.find((d) => d.slug === 'rbr') as DatasetDef;