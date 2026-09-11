import { fetchTrending } from '../src/adapters/github.mjs';
for (const period of ['daily', 'weekly', 'monthly']) {
  try {
    const result = await fetchTrending({ period, limit: 3 });
    console.log(JSON.stringify({ period, discovered: result.discovered, selected: result.materials.length, hasStars: result.materials.every(m => m.metrics.stars !== null), hasPeriodStars: result.materials.every(m => m.metrics.periodStars !== null) }));
  } catch (error) { console.error(JSON.stringify({ period, error: error.code ?? error.name })); process.exitCode = 1; }
}
