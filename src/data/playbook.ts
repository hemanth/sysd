export interface PlaybookCard {
  id: string;
  category: 'tactics' | 'numbers' | 'patterns' | 'traps';
  title: string;
  summary: string;
  bullets: string[];
}

export const INTERVIEW_PLAYBOOK: PlaybookCard[] = [
  {
    id: 'pacing-rule',
    category: 'tactics',
    title: 'Time-Boxed Delivery Pacing (35–45m)',
    summary: 'Most candidates fail on clock management, not raw knowledge. Protect the final 20+ minutes for architecture and trade-offs.',
    bullets: [
      '0–5m Scope & SLAs: 3 core user capabilities, explicit out-of-scope cuts, quantified latency/scale/CAP targets.',
      '5–10m Entities & API: Core domain nouns + 1 clean endpoint per capability (REST 95% of the time; add WS/SSE only when bidirectional/push is required).',
      '10–22m Baseline Topology: Trace every endpoint end-to-end on the canvas first. Jot columns next to the DB once access patterns are visible.',
      '22–35m Deep Dives: Walk down your SLA list and harden bottlenecks (sharding, hot keys, failover, consistency).',
    ],
  },
  {
    id: 'inline-math-trick',
    category: 'tactics',
    title: 'Just-in-Time Math (Skip Upfront Arithmetic)',
    summary: 'Spending 10 minutes upfront multiplying DAU × bytes to conclude "it is big" burns valuable design time without proving signal.',
    bullets: [
      'Tell the interviewer: "I will skip upfront estimations and run targeted math right on the canvas whenever a number changes an architectural choice."',
      'Compute inline next to the box: e.g. 80M DAU × 250 post IDs × 8 B = 160 GB -> exceeds one node, shard Redis.',
      'Quick mental anchors: 1 day ≈ 10^5 sec -> 1M req/day ≈ 12 RPS; 100M req/day ≈ 1,200 RPS; 1B req/day ≈ 12,000 RPS.',
    ],
  },
  {
    id: 'whiteboard-legibility',
    category: 'tactics',
    title: 'The "Next-Morning Feedback" Board Rule & Check-In Pauses',
    summary: 'Interviewers often write hiring packet notes hours later from a screenshot of your Excalidraw canvas.',
    bullets: [
      'Label wire protocols on arrows (HTTPS, gRPC, Presigned PUT, Kafka key=userId, WS frame).',
      'Note bottlenecks aloud during Baseline ("Single DB will choke on celebrity fan-out; parking for Deep Dive") instead of stalling mid-flow.',
      'Senior/Staff+ calibration: proactively identify weak spots, then pause—"I see hot-partition skew and failover as top risks; prefer I tackle skew first?"',
    ],
  },
  {
    id: 'numbers-to-know',
    category: 'numbers',
    title: 'Practical Latency & Single-Node Throughput Anchors',
    summary: 'Order-of-magnitude ceilings tell you immediately whether one box suffices or horizontal sharding is mandatory.',
    bullets: [
      'RAM access ~100 ns · Redis LAN hit ~0.5 ms · NVMe SSD random read ~100 µs · Intra-region RPC ~0.5–1 ms · Cross-continent RTT ~80–150 ms.',
      'Stateless app server: ~10k–50k simple RPS · Stateful WebSocket gateway: ~50k–100k concurrent TCP sockets (~1–2 GB socket RAM).',
      'Single Postgres primary: ~5k–15k writes/sec, 50k+ reads/sec with read replicas; shard when write QPS or multi-TB index bloat exceeds one primary.',
      'Single Redis instance: ~100k ops/sec (single-threaded command loop) — hot single keys saturate 1 core even if cluster RAM is idle!',
      'Single Kafka partition: ~10–50 MB/sec sequential throughput; partition by entity key that preserves required ordering.',
    ],
  },
  {
    id: 'storage-access-patterns',
    category: 'patterns',
    title: 'Storage Selection by Access Pattern (Not SQL vs. NoSQL Dogma)',
    summary: 'Modern relational and non-relational stores both scale; pick the engine that makes your dominant read/write query trivial and safe.',
    bullets: [
      'Relational (Postgres/MySQL/Spanner): ACID multi-row transactions, strict invariants (seat booking, ledgers), flexible secondary indexes.',
      'Wide-Column / Key-Value (DynamoDB/Cassandra): Predictable single-digit ms lookups/range scans on PartitionKey + SortKey (chat messages: conv_id + seq_id).',
      'Blob Object Storage (S3/GCS) + Edge CDN: Always offload images, videos, chunks, and raw logs via Presigned URLs—never bloat SQL/NoSQL rows.',
      'Search / Inverted Index (Elasticsearch/OpenSearch): Async CDC pipeline from primary DB; never use Elasticsearch as your sole source of truth.',
    ],
  },
  {
    id: 'hot-keys-and-caching',
    category: 'patterns',
    title: 'Hot Keys, Celebrity Fan-Out & Cache Stampede Defenses',
    summary: 'Uniform average QPS rarely breaks distributed systems—skewed traffic on 0.01% of keys does.',
    bullets: [
      'Hybrid Fan-Out: Push/precompute inboxes for normal accounts; merge high-follower ("celebrity") posts on read.',
      'Key Salting / Write Sharding: Append random suffix 0..N-1 (campaign_42#7) to split hot writes across N partitions, then aggregate N shards on read.',
      'Tiny L1 Local Cache (1–2s TTL in app RAM) in front of Redis L2 absorbs millions of reads/sec on viral keys with zero network hop.',
      'Cache Stampede / Thundering Herd: Use request coalescing (Singleflight), jittered TTLs, or soft-expiry background refresh.',
    ],
  },
  {
    id: 'concurrency-consistency',
    category: 'patterns',
    title: 'Concurrency Locks, Idempotency & Dual-Write Elimination',
    summary: 'High-signal answers name exact failure races (client retry, crash mid-commit, expired lock) and close them deterministically.',
    bullets: [
      'Preventing Double-Booking: DB row lock (SELECT FOR UPDATE), optimistic conditional write (WHERE status="FREE" AND version=v), or Redis atomic Lua TTL hold + DB commit check.',
      'Idempotency Keys: Client sends UUID idempotency_key on POST; server stores key -> response so network retries never double-charge or duplicate records.',
      'Transactional Outbox + CDC: Never write to DB and publish to Kafka in two uncoordinated calls—write event to an Outbox table in the same ACID transaction and tail WAL.',
      'CAP Reality: Network partitions happen; explicitly choose CP (fail closed / block stale writes for seats & money) vs. AP (serve slightly stale feeds or fail-open rate limits).',
    ],
  },
  {
    id: 'realtime-and-geo',
    category: 'patterns',
    title: 'Real-Time Protocols & High-Churn Geospatial Indexing',
    summary: 'Match protocol statefulness and spatial index mutability to update frequency.',
    bullets: [
      'Polling (simple, >5s ok) vs. SSE (HTTP server->client push: live scores, job verdicts, LLM tokens) vs. WebSockets (full-duplex chat, multiplayer).',
      'Stateful WS Routing: Store userId -> gatewayHost in Redis (or consistent-hash ring) + Pub/Sub or gRPC hop between gateway nodes.',
      'Static Places (Yelp): PostGIS R-tree / Geohash column in DB (writes are rare).',
      'Moving Drivers (250k GPS pings/sec): Sharded in-memory Uber H3 / Geohash cells (O(1) cell transition without B-tree disk write amplification).',
    ],
  },
  {
    id: 'classic-traps',
    category: 'traps',
    title: '7 Instant Red Flags Interviewers Watch For',
    summary: 'Eliminating these common missteps immediately raises your evaluation floor.',
    bullets: [
      '1. Saying "the system should have low latency" without naming WHICH path and WHAT millisecond budget.',
      '2. Streaming multi-GB uploads/downloads through stateless API servers instead of Presigned Object Storage.',
      '3. Designing 20 login/auth/admin endpoints on a Ticketmaster or Uber prompt instead of the core concurrency/matching loop.',
      '4. Adding Kafka or microservices everywhere without naming what burst, latency, or failure domain it decouples.',
      '5. Introducing a Redis cache without explaining eviction/TTL, cache-aside vs. write-through, and cold-cache fallback.',
      '6. Using distributed 2-Phase Commit across external third-party APIs (like Stripe) instead of idempotency + async reconciliation.',
      '7. Treating stateful WebSocket tiers as stateless HTTP servers behind a naive round-robin load balancer without session routing.',
    ],
  },
];
