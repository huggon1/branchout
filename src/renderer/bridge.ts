import type { DesktopBridge } from '../shared/ipc-contracts';
declare global { interface Window { branchout: DesktopBridge } }
export const bridge = window.branchout;
