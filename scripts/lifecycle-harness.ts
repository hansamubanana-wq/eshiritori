// Test-only entrypoint, excluded from uploaded assets and the production Worker.
import worker from '../src/worker/index';
import { Room as ProductionRoom } from '../src/worker/room';
import { LIMITS } from '../src/worker/wire';
export { Accounts } from '../src/worker/accounts';
export class Room extends ProductionRoom {
  async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path === '/test-expire') {
      (this as any).touched = Date.now() - LIMITS.ttl - 1;
      this.ctx.storage.sql.exec('UPDATE room SET touched = ?', (this as any).touched);
      await this.alarm();
      return Response.json({ cleared: (this as any).data === null });
    }
    if (path === '/test-alarm') {
      await this.alarm();
      return Response.json({ alive: !!(this as any).data, next: await this.ctx.storage.getAlarm() });
    }
    return super.fetch(req);
  }
}
export default worker;
