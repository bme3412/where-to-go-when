// Run with vite-node or bundle for Node with esbuild.
import { ORIGINS } from '../src/data/origins';
import { rankCities, scoreCities } from '../src/scoring';
import { rankSeasonalAreas, seasonalScore, seasonalTitle } from '../src/seasonal';

const scenarios = ['2027-01-10', '2027-04-10', '2027-07-10', '2027-10-10'].flatMap(start =>
  [7, 14].map(days => ({ start, end: new Date(Date.parse(start) + (days - 1) * 86400000).toISOString().slice(0, 10) })));
const holiday = { start: '2026-12-20', end: '2027-01-03' };
for (const origin of ORIGINS.filter(o => ['Boston', 'London'].includes(o.name))) {
  for (const trip of [...scenarios, holiday]) {
    const scores = scoreCities(trip, origin);
    const old = rankCities(scores);
    const ranked = rankSeasonalAreas(scores.map(seasonalScore));
    console.log(origin.name, trip.start, trip.end);
    console.log('Previous:', old.slice(0, 10).map(r => r.city.name).join(', '));
    console.log('Seasonal:', ranked.slice(0, 10).map(seasonalTitle).join(', '));
    if (trip === holiday && origin.name === 'Boston') {
      console.table(ranked.filter(r => ['Andaman Coast','Palawan','Boracay','Guanacaste Coast','Maldives','Sri Lanka South Coast','Mexican Caribbean','Siem Reap','Ho Chi Minh City','Aruba','Sydney','Perth','Muscat','Dubai','Cape Town','Tenerife','Galápagos','Nouakchott'].includes(seasonalTitle(r))).map(r => ({
        region: seasonalTitle(r), base: r.city.name, rank: r.rank, old: old.find(x => x.city.name === r.city.name)?.rank,
        wetPct: Math.round(100 * r.wetFrequency), score: r.score.toFixed(1),
        ...Object.fromEntries(Object.entries(r.seasonal!.points).map(([k,v]) => [k,v.toFixed(1)]))
      })));
    }
  }
}
