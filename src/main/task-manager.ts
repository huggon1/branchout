import { randomUUID } from 'node:crypto';
import { workerEventSchema } from '../shared/worker-contracts';
import { Store } from './storage/store';
export interface WorkerHandle { postMessage(message: unknown): void; kill(): boolean; on(event: 'message', listener: (message: unknown) => void): unknown; on(event: 'exit', listener: (code: number) => void): unknown; }
export class TaskManager {
  private workers = new Map<string, WorkerHandle>();
  private starting = false;
  constructor(private store: Store, private spawn: () => WorkerHandle, private notify: () => void) {}
  async recover() {
    await this.store.update(state => { for (const task of state.tasks) if (task.state === 'queued' || task.state === 'running') { task.state = 'failed'; task.phase = '应用退出中断了检查，可以重新运行'; task.updatedAt = new Date().toISOString(); } });
  }
  async start() {
    if (this.starting || this.workers.size) throw new Error('基础检查正在运行');
    this.starting = true;
    const taskId = randomUUID();
    try {
      await this.store.update(state => state.tasks.push({ taskId, kind: 'foundation_check', state: 'queued', phase: '等待工作进程', progress: 0, updatedAt: new Date().toISOString() }));
      const worker = this.spawn(); this.workers.set(taskId, worker);
      worker.on('message', message => { void this.receive(taskId, message).catch(() => this.fail(taskId)); });
      worker.on('exit', () => { this.workers.delete(taskId); void this.fail(taskId); });
      await this.store.update(state => { const task = state.tasks.find(t => t.taskId === taskId)!; task.state = 'running'; task.phase = '检查进程与消息边界'; });
      worker.postMessage({ type: 'check', taskId }); this.notify(); return taskId;
    } catch { await this.fail(taskId); throw new Error('基础检查启动失败'); }
    finally { this.starting = false; }
  }
  async receive(taskId: string, input: unknown) {
    const parsed = workerEventSchema.safeParse(input);
    if (!parsed.success) return;
    const message = parsed.data;
    if ((message.type === 'result' ? message.result.taskId : message.taskId) !== taskId) return;
    await this.store.update(state => {
      const task = state.tasks.find(t => t.taskId === taskId);
      if (!task || task.state !== 'running') return;
      if (message.type === 'result') {
        if (!state.results.some(r => r.taskId === taskId && r.resultId === message.result.resultId)) state.results.push(message.result);
        task.progress = state.results.filter(r => r.taskId === taskId).length;
      } else { task.state = task.progress === 2 ? 'completed' : 'failed'; task.phase = task.progress === 2 ? '基础检查完成' : '工作进程结果不完整'; }
      task.updatedAt = new Date().toISOString();
    });
    this.notify();
    if (message.type === 'completed') this.stop(taskId);
  }
  private stop(taskId: string) { const worker = this.workers.get(taskId); this.workers.delete(taskId); worker?.kill(); }
  private async fail(taskId: string) {
    try { await this.store.update(state => { const task = state.tasks.find(t => t.taskId === taskId); if (task && ['queued', 'running'].includes(task.state)) { task.state = 'failed'; task.phase = '工作进程中断，请重新检查'; task.updatedAt = new Date().toISOString(); } }); this.notify(); }
    finally { this.stop(taskId); }
  }
  async cancel(taskId: string) {
    await this.store.update(state => { const task = state.tasks.find(t => t.taskId === taskId); if (task && ['queued', 'running'].includes(task.state)) { task.state = 'cancelled'; task.phase = '检查已取消'; task.updatedAt = new Date().toISOString(); } });
    this.stop(taskId); this.notify();
  }
  async shutdown() { await Promise.all([...this.workers.keys()].map(id => this.cancel(id))); }
}
