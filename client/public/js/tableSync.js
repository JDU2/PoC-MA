// Rebuild table UI from on-chain logs (first connect / occupancy mismatch).

import { switchTab } from './ui.js';
import * as TState from './tournamentState.js';
import { replayFromLogs } from './bootstrap.js';

export async function syncTableFromLogs({ goToTable = false, account } = {}) {
  await replayFromLogs(account || undefined);
  TState.render();
  if (goToTable) switchTab('table');
}
