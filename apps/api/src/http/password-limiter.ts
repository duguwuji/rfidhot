/** Rejected attempts neither grow storage nor keep other clients' window alive. */
export function passwordAttemptLimiter(now = Date.now): (ip: string) => boolean {
  const windowMs = 15 * 60_000;
  const clients = new Map<string, number[]>();
  let all: number[] = [];
  return (ip) => {
    const cutoff = now() - windowMs;
    for (const [key, times] of clients) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length) clients.set(key, recent);
      else clients.delete(key);
    }
    all = all.filter((t) => t > cutoff);
    const recent = clients.get(ip) ?? [];
    if (recent.length >= 10 || all.length >= 50) return true;
    const time = cutoff + windowMs;
    recent.push(time);
    all.push(time);
    clients.set(ip, recent);
    return false;
  };
}
