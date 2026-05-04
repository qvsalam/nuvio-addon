import { HealthMonitor } from './monitor.js';
import { VoduProvider } from '../providers/vodu.js';
import { CinemaBoxProvider } from '../providers/cinemabox.js';
import { CinemanaProvider } from '../providers/cinemana.js';
import { AnimeProvider } from '../providers/anime.js';

async function main() {
  const providers = [
    new VoduProvider(),
    new CinemaBoxProvider(),
    new CinemanaProvider(),
    new AnimeProvider(),
  ];

  const monitor = new HealthMonitor(providers);
  console.log('Running health checks...\n');

  const results = await monitor.checkAll();

  for (const result of results) {
    const icon = result.healthy ? '✅' : '❌';
    console.log(
      `${icon} ${result.providerId}: ${result.healthy ? 'Healthy' : 'Unhealthy'} (${result.responseTimeMs}ms)`
    );
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  console.log('\nProvider statuses updated in manifest.json');
}

main().catch(console.error);
