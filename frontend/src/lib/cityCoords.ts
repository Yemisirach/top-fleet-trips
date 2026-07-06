export const CITY_COORDS: Record<string, [number, number]> = {
  "Topwater Ethiopia HQ, Addis Ababa": [9.0054, 38.7636],
  "Addis Ababa": [9.0054, 38.7636],
  "Dire Dawa": [9.6076, 41.8667],
  "Bahir Dar": [11.5926, 37.384],
  "Mekelle": [13.5034, 39.4753],
  "Hawassa": [7.0621, 38.4764],
  "Adama": [8.5411, 39.2682],
  "Jimma": [7.6805, 36.8324],
  "Arba Minch": [6.0389, 37.5509],
  "Jijiga": [9.3588, 42.7879],
  "Nekemte": [9.0908, 36.5475],
  "Djibouti City": [11.5721, 43.1456],
  "Nairobi": [-1.2921, 36.8219],
  "Mombasa": [-4.0435, 39.6682],
  "Khartoum": [15.5007, 32.5599],
  "Kampala": [0.3136, 32.5818],
  "Moyale": [3.5223, 39.0611],
  "Gondar": [12.603, 37.4521],
  "Axum": [14.1326, 38.7199],
  "Lalibela": [12.0355, 39.0463],
  "Harar": [9.3139, 42.1241],
  "Sodo": [6.8602, 37.7618],
};

const normalize = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const resolveCityCoords = (
  value?: string | null
): [number, number] | null => {
  if (!value) return null;
  if (CITY_COORDS[value]) return CITY_COORDS[value];
  const n = normalize(value);
  if (!n) return null;
  const direct = Object.entries(CITY_COORDS).find(
    ([name]) => normalize(name) === n
  );
  if (direct) return direct[1];
  const contains = Object.entries(CITY_COORDS).find(([name]) => {
    const city = normalize(name);
    return city && (n.includes(city) || city.includes(n));
  });
  if (contains) return contains[1];
  if (n.includes("topwater") || n.includes("top factory"))
    return CITY_COORDS["Addis Ababa"];
  return null;
};
