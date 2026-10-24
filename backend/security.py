"""Small, bounded admission controls for the single-process local server."""
import threading
import time


class RateLimiter:
    def __init__(self, max_keys=4096, clock=time.monotonic):
        self.max_keys, self.clock = max_keys, clock
        self.buckets = {}
        self.lock = threading.Lock()

    def allow(self, key, rate, burst):
        with self.lock:
            stamp = self.clock()
            entry = self.buckets.get(key)
            if entry is None:
                if len(self.buckets) >= self.max_keys:
                    # Never evict a live attacker bucket and reset its allowance.
                    self.buckets = {k: v for k, v in self.buckets.items() if v[2] > stamp}
                    if len(self.buckets) >= self.max_keys:
                        return False
                tokens = burst
            else:
                tokens = min(burst, entry[0] + (stamp - entry[1]) * rate)
            allowed = tokens >= 1
            self.buckets[key] = (tokens - 1 if allowed else tokens, stamp, stamp + burst / rate)
            return allowed
