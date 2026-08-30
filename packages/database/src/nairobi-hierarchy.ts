export interface NairobiWardReference {
  code: string;
  name: string;
  iebcCode: number;
}

export interface NairobiSubcountyReference {
  code: string;
  name: string;
  iebcConstituencyCode: number;
  wards: readonly NairobiWardReference[];
}

/**
 * Nairobi City County's canonical electoral hierarchy. The numeric codes are
 * the IEBC constituency and County Assembly ward codes; the stable string
 * codes are MazingiraOps identifiers and are safe to use in integrations.
 */
export const NAIROBI_SUBCOUNTIES = [
  {
    code: "WESTLANDS", name: "Westlands", iebcConstituencyCode: 274,
    wards: [
      { code: "KITISURU", name: "Kitisuru", iebcCode: 1366 },
      { code: "PARKLANDS_HIGHRIDGE", name: "Parklands/Highridge", iebcCode: 1367 },
      { code: "KARURA", name: "Karura", iebcCode: 1368 },
      { code: "KANGEMI", name: "Kangemi", iebcCode: 1369 },
      { code: "MOUNTAIN_VIEW", name: "Mountain View", iebcCode: 1370 },
    ],
  },
  {
    code: "DAGORETTI_NORTH", name: "Dagoretti North", iebcConstituencyCode: 275,
    wards: [
      { code: "KILIMANI", name: "Kilimani", iebcCode: 1371 },
      { code: "KAWANGWARE", name: "Kawangware", iebcCode: 1372 },
      { code: "GATINA", name: "Gatina", iebcCode: 1373 },
      { code: "KILELESHWA", name: "Kileleshwa", iebcCode: 1374 },
      { code: "KABIRO", name: "Kabiro", iebcCode: 1375 },
    ],
  },
  {
    code: "DAGORETTI_SOUTH", name: "Dagoretti South", iebcConstituencyCode: 276,
    wards: [
      { code: "MUTU_INI", name: "Mutu-Ini", iebcCode: 1376 },
      { code: "NGANDO", name: "Ngando", iebcCode: 1377 },
      { code: "RIRUTA", name: "Riruta", iebcCode: 1378 },
      { code: "UTHIRU_RUTHIMITU", name: "Uthiru/Ruthimitu", iebcCode: 1379 },
      { code: "WAITHAKA", name: "Waithaka", iebcCode: 1380 },
    ],
  },
  {
    code: "LANGATA", name: "Lang'ata", iebcConstituencyCode: 277,
    wards: [
      { code: "KAREN", name: "Karen", iebcCode: 1381 },
      { code: "NAIROBI_WEST", name: "Nairobi West", iebcCode: 1382 },
      { code: "MUGUMU_INI", name: "Mugumu-Ini", iebcCode: 1383 },
      { code: "SOUTH_C", name: "South C", iebcCode: 1384 },
      { code: "NYAYO_HIGHRISE", name: "Nyayo Highrise", iebcCode: 1385 },
    ],
  },
  {
    code: "KIBRA", name: "Kibra", iebcConstituencyCode: 278,
    wards: [
      { code: "LAINI_SABA", name: "Laini Saba", iebcCode: 1386 },
      { code: "LINDI", name: "Lindi", iebcCode: 1387 },
      { code: "MAKINA", name: "Makina", iebcCode: 1388 },
      { code: "WOODLEY", name: "Woodley/Kenyatta Golf Course", iebcCode: 1389 },
      { code: "SARANGOMBE", name: "Sarangombe", iebcCode: 1390 },
    ],
  },
  {
    code: "ROYSAMBU", name: "Roysambu", iebcConstituencyCode: 279,
    wards: [
      { code: "GITHURAI", name: "Githurai", iebcCode: 1391 },
      { code: "KAHAWA_WEST", name: "Kahawa West", iebcCode: 1392 },
      { code: "ZIMMERMAN", name: "Zimmerman", iebcCode: 1393 },
      { code: "ROYSAMBU", name: "Roysambu", iebcCode: 1394 },
      { code: "KAHAWA", name: "Kahawa", iebcCode: 1395 },
    ],
  },
  {
    code: "KASARANI", name: "Kasarani", iebcConstituencyCode: 280,
    wards: [
      { code: "CLAY_CITY", name: "Clay City", iebcCode: 1396 },
      { code: "MWIKI", name: "Mwiki", iebcCode: 1397 },
      { code: "KASARANI", name: "Kasarani", iebcCode: 1398 },
      { code: "NJIRU", name: "Njiru", iebcCode: 1399 },
      { code: "RUAI", name: "Ruai", iebcCode: 1400 },
    ],
  },
  {
    code: "RUARAKA", name: "Ruaraka", iebcConstituencyCode: 281,
    wards: [
      { code: "BABA_DOGO", name: "Baba Dogo", iebcCode: 1401 },
      { code: "UTALII", name: "Utalii", iebcCode: 1402 },
      { code: "MATHARE_NORTH", name: "Mathare North", iebcCode: 1403 },
      { code: "LUCKY_SUMMER", name: "Lucky Summer", iebcCode: 1404 },
      { code: "KOROGOCHO", name: "Korogocho", iebcCode: 1405 },
    ],
  },
  {
    code: "EMBAKASI_SOUTH", name: "Embakasi South", iebcConstituencyCode: 282,
    wards: [
      { code: "IMARA_DAIMA", name: "Imara Daima", iebcCode: 1406 },
      { code: "KWA_NJENGA", name: "Kwa Njenga", iebcCode: 1407 },
      { code: "KWA_REUBEN", name: "Kwa Reuben", iebcCode: 1408 },
      { code: "PIPELINE", name: "Pipeline", iebcCode: 1409 },
      { code: "KWARE", name: "Kware", iebcCode: 1410 },
    ],
  },
  {
    code: "EMBAKASI_NORTH", name: "Embakasi North", iebcConstituencyCode: 283,
    wards: [
      { code: "KARIOBANGI_NORTH", name: "Kariobangi North", iebcCode: 1411 },
      { code: "DANDORA_AREA_I", name: "Dandora Area I", iebcCode: 1412 },
      { code: "DANDORA_AREA_II", name: "Dandora Area II", iebcCode: 1413 },
      { code: "DANDORA_AREA_III", name: "Dandora Area III", iebcCode: 1414 },
      { code: "DANDORA_AREA_IV", name: "Dandora Area IV", iebcCode: 1415 },
    ],
  },
  {
    code: "EMBAKASI_CENTRAL", name: "Embakasi Central", iebcConstituencyCode: 284,
    wards: [
      { code: "KAYOLE_NORTH", name: "Kayole North", iebcCode: 1416 },
      { code: "KAYOLE_CENTRAL", name: "Kayole Central", iebcCode: 1417 },
      { code: "KAYOLE_SOUTH", name: "Kayole South", iebcCode: 1418 },
      { code: "KOMAROCK", name: "Komarock", iebcCode: 1419 },
      { code: "MATOPENI_SPRING_VALLEY", name: "Matopeni/Spring Valley", iebcCode: 1420 },
    ],
  },
  {
    code: "EMBAKASI_EAST", name: "Embakasi East", iebcConstituencyCode: 285,
    wards: [
      { code: "UPPER_SAVANNAH", name: "Upper Savannah", iebcCode: 1421 },
      { code: "LOWER_SAVANNAH", name: "Lower Savannah", iebcCode: 1422 },
      { code: "EMBAKASI", name: "Embakasi", iebcCode: 1423 },
      { code: "UTAWALA", name: "Utawala", iebcCode: 1424 },
      { code: "MIHANGO", name: "Mihango", iebcCode: 1425 },
    ],
  },
  {
    code: "EMBAKASI_WEST", name: "Embakasi West", iebcConstituencyCode: 286,
    wards: [
      { code: "UMOJA_I", name: "Umoja I", iebcCode: 1426 },
      { code: "UMOJA_II", name: "Umoja II", iebcCode: 1427 },
      { code: "MOWLEM", name: "Mowlem", iebcCode: 1428 },
      { code: "KARIOBANGI_SOUTH", name: "Kariobangi South", iebcCode: 1429 },
    ],
  },
  {
    code: "MAKADARA", name: "Makadara", iebcConstituencyCode: 287,
    wards: [
      { code: "MARINGO_HAMZA", name: "Maringo/Hamza", iebcCode: 1430 },
      { code: "VIWANDANI", name: "Viwandani", iebcCode: 1431 },
      { code: "HARAMBEE", name: "Harambee", iebcCode: 1432 },
      { code: "MAKONGENI", name: "Makongeni", iebcCode: 1433 },
    ],
  },
  {
    code: "KAMUKUNJI", name: "Kamukunji", iebcConstituencyCode: 288,
    wards: [
      { code: "PUMWANI", name: "Pumwani", iebcCode: 1434 },
      { code: "EASTLEIGH_NORTH", name: "Eastleigh North", iebcCode: 1435 },
      { code: "EASTLEIGH_SOUTH", name: "Eastleigh South", iebcCode: 1436 },
      { code: "AIRBASE", name: "Airbase", iebcCode: 1437 },
      { code: "CALIFORNIA", name: "California", iebcCode: 1438 },
    ],
  },
  {
    code: "STAREHE", name: "Starehe", iebcConstituencyCode: 289,
    wards: [
      { code: "NAIROBI_CENTRAL", name: "Nairobi Central", iebcCode: 1439 },
      { code: "NGARA", name: "Ngara", iebcCode: 1440 },
      { code: "PANGANI", name: "Pangani", iebcCode: 1441 },
      { code: "ZIWANI_KARIOKOR", name: "Ziwani/Kariokor", iebcCode: 1442 },
      { code: "LANDIMAWE", name: "Landimawe", iebcCode: 1443 },
      { code: "NAIROBI_SOUTH", name: "Nairobi South", iebcCode: 1444 },
    ],
  },
  {
    code: "MATHARE", name: "Mathare", iebcConstituencyCode: 290,
    wards: [
      { code: "HOSPITAL", name: "Hospital", iebcCode: 1445 },
      { code: "MABATINI", name: "Mabatini", iebcCode: 1446 },
      { code: "HURUMA", name: "Huruma", iebcCode: 1447 },
      { code: "NGEI", name: "Ngei", iebcCode: 1448 },
      { code: "MLANGO_KUBWA", name: "Mlango Kubwa", iebcCode: 1449 },
      { code: "KIAMAIKO", name: "Kiamaiko", iebcCode: 1450 },
    ],
  },
] as const satisfies readonly NairobiSubcountyReference[];

export const NAIROBI_WARD_COUNT = NAIROBI_SUBCOUNTIES.reduce(
  (total, subcounty) => total + subcounty.wards.length,
  0,
);
