import { STENCIL_PRESETS } from './methodology';
import type { ComponentKind } from '../types';

export interface ReferenceNodeSpec {
  id: string;
  kind: ComponentKind;
  label: string;
  col: number;
  row: number;
}

export interface ReferenceEdgeSpec {
  from: string;
  to: string;
  label?: string;
}

export interface ArchetypeSolution {
  challengeId: string;
  headline: string;
  nodes: ReferenceNodeSpec[];
  edges: ReferenceEdgeSpec[];
  writePath: string;
  readPath: string;
  storageNotes: string[];
  staffTradeoffs: string[];
}

export const ARCHETYPE_SOLUTIONS: Record<string, ArchetypeSolution> = {
  'seat-ticketing': {
    challengeId: 'seat-ticketing',
    headline: 'Virtual waiting room + Redis Lua seat-hold TTL + ACID Postgres order ledger',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Fan Client', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Edge / Waiting Room', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_booking', kind: 'service', label: 'Booking Service', col: 2, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Redis Hold Lock (TTL)', col: 3, row: 0 },
      { id: 'sol_pg', kind: 'database', label: 'Postgres Seat & Order DB', col: 3, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Payment Webhook Queue', col: 3, row: 2 },
      { id: 'sol_worker', kind: 'worker', label: 'Reconciler Worker', col: 4, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_cdn', label: 'Seat Map' },
      { from: 'sol_client', to: 'sol_gw', label: 'POST /holds' },
      { from: 'sol_gw', to: 'sol_booking', label: 'Idempotency-Key' },
      { from: 'sol_booking', to: 'sol_redis', label: 'SET NX EX 420s' },
      { from: 'sol_booking', to: 'sol_pg', label: 'ACID Tx' },
      { from: 'sol_booking', to: 'sol_q', label: 'Checkout Event' },
      { from: 'sol_q', to: 'sol_worker', label: 'Finalize / Expire' },
    ],
    writePath:
      'POST /holds checks idempotencyKey -> acquires atomic Redis key (seat:{event}:{id} NX EX 420) -> writes HELD state in Postgres -> Stripe payment webhook confirms BOOKED via fenced holdToken.',
    readPath:
      'GET /events/{id}/seats serves short-TTL (1–2s) Edge/Redis bitmask snapshot pushed via SSE deltas so 500k fans never query Postgres.',
    storageNotes: [
      'Postgres (CP): seats(event_id, seat_id, status, hold_token, version) with conditional UPDATE ... WHERE status = AVAILABLE OR expired.',
      'Redis Cluster: 20k seats × 64B ≈ 1.3 MB/event hot lock + section availability bitsets.',
    ],
    staffTradeoffs: [
      'Redis crash defense: Postgres conditional row update acts as ultimate CP fencing guard so zero double-selling occurs even if Redis restarts.',
      'Late webhook after 7m expiry: fenced hold_token mismatch triggers automatic refund rather than overwriting a new buyer.',
    ],
  },

  'social-timeline': {
    challengeId: 'social-timeline',
    headline: 'Hybrid push/pull fan-out: async inbox push for normal accounts + read-time merge for celebrities',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Mobile / Web App', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_post', kind: 'service', label: 'Post & Feed Service', col: 2, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Sharded Timeline Redis', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'Post & Graph Store', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Kafka Fan-Out Log', col: 2, row: 2 },
      { id: 'sol_worker', kind: 'worker', label: 'Fan-Out Workers', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'HTTPS' },
      { from: 'sol_gw', to: 'sol_post', label: 'GET / POST' },
      { from: 'sol_post', to: 'sol_cache', label: 'ZREVRANGE <180ms' },
      { from: 'sol_post', to: 'sol_db', label: 'Persist Post' },
      { from: 'sol_post', to: 'sol_kafka', label: 'post.created' },
      { from: 'sol_kafka', to: 'sol_worker', label: '<50k followers' },
      { from: 'sol_worker', to: 'sol_cache', label: 'ZADD Inbox' },
    ],
    writePath:
      'POST /posts persists to Post DB and emits post.created to Kafka. If author has < 50k followers, Fan-Out Workers push postId into active followers’ Redis ZSETs; > 50k celebrity authors skip fan-out-on-write.',
    readPath:
      'GET /timeline?cursor=... reads user’s precomputed Redis ZSET + merges recent posts from followed celebrity accounts at read time, hydrating post bodies from cache/DB.',
    storageNotes: [
      'Redis Timeline Cache: user_feed:{userId} capped to 500 recent (timestamp, postId) pairs; inactive >14d evicted.',
      'Cassandra / DynamoDB: posts keyed by (author_id, post_id DESC) for fast celebrity pull queries.',
    ],
    staffTradeoffs: [
      'Avoids 15M-follower write amplification storm while keeping p99 GET /timeline under 180ms.',
      'Media uploads bypass Post Service via presigned S3 PUT + CloudFront CDN.',
    ],
  },

  'cloud-file-sync': {
    challengeId: 'cloud-file-sync',
    headline: '4 MB content-addressed SHA-256 chunking + direct presigned S3 transfer + transactional metadata journal',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Sync Desktop / Mobile', col: 0, row: 1 },
      { id: 'sol_blob', kind: 'blob', label: 'S3 Chunk Object Store', col: 2, row: 0 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Edge Download CDN', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_meta', kind: 'service', label: 'Metadata & Sync Service', col: 2, row: 1 },
      { id: 'sol_db', kind: 'database', label: 'Transactional Metadata DB', col: 3, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Workspace Change Stream', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_blob', label: 'Presigned PUT 4MB' },
      { from: 'sol_cdn', to: 'sol_client', label: 'Chunk GET' },
      { from: 'sol_blob', to: 'sol_cdn', label: 'Origin' },
      { from: 'sol_client', to: 'sol_gw', label: 'Manifest + Cursor' },
      { from: 'sol_gw', to: 'sol_meta', label: 'HTTPS / SSE' },
      { from: 'sol_meta', to: 'sol_db', label: 'CAS baseVersion' },
      { from: 'sol_meta', to: 'sol_q', label: 'Notify Devices' },
    ],
    writePath:
      'Client splits file into 4 MB SHA-256 chunks -> asks Metadata Service which hashes are missing -> uploads ONLY new chunks directly to S3 via presigned URLs -> commits new FileVersion via optimistic concurrency (WHERE version = baseVersion).',
    readPath:
      'Online devices listen on SSE/WebSocket cursor stream -> fetch updated chunk manifest -> pull only changed 4 MB blocks from CDN/S3.',
    storageNotes: [
      'S3 Object Store (11 nines): immutable blobs named /chunks/{sha256} enabling instant dedup & resumable retries.',
      'Postgres / Spanner: files(file_id, head_version), versions(file_id, ver, chunk_list_json).',
    ],
    staffTradeoffs: [
      'Control-plane vs. data-plane separation keeps stateless API servers tiny even during multi-GB uploads.',
      'Offline edit conflict (two devices commit v7 -> v8): second writer receives 409 Conflict and saves conflicted copy cleanly without data loss.',
    ],
  },

  'ride-dispatch': {
    challengeId: 'ride-dispatch',
    headline: 'Sharded in-memory H3 spatial index for 250k GPS pings/sec + fenced atomic driver offer locks',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Rider & Driver Apps', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'WS + REST Gateway', col: 1, row: 1 },
      { id: 'sol_loc', kind: 'service', label: 'Location Ingest Service', col: 2, row: 0 },
      { id: 'sol_match', kind: 'service', label: 'Dispatch Match Engine', col: 2, row: 1 },
      { id: 'sol_h3', kind: 'cache', label: 'Sharded H3 Geo + Lock Redis', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'Trip State Ledger DB', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Telemetry & ETA Stream', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'WS Ping 4s / Trip' },
      { from: 'sol_gw', to: 'sol_loc', label: '250k pings/s' },
      { from: 'sol_gw', to: 'sol_match', label: 'POST /trips' },
      { from: 'sol_loc', to: 'sol_h3', label: 'Update H3 Cell' },
      { from: 'sol_match', to: 'sol_h3', label: 'k-Ring Query + NX Lock' },
      { from: 'sol_match', to: 'sol_db', label: 'Persist Trip' },
      { from: 'sol_loc', to: 'sol_kafka', label: 'Async Analytics' },
    ],
    writePath:
      'Drivers stream GPS over WebSockets every 4s -> Location Service maps (lat, lng) to Uber H3 cell and updates sharded in-memory Redis state (skipping synchronous SQL writes) while teeing raw pings to Kafka.',
    readPath:
      'POST /trips queries nearby H3 k-ring cells -> ranks candidate drivers by road ETA -> acquires atomic driver_lock:{driverId} (12s TTL) before pushing WebSocket offer.',
    storageNotes: [
      'Regional H3 Redis Cluster: sharded by city/region; holds ephemeral driver cell membership + 12s dispatch offer locks.',
      'Postgres / CockroachDB: durable Trip state machine (REQUESTED -> OFFERED -> ACCEPTED -> COMPLETED) keyed by idempotencyKey.',
    ],
    staffTradeoffs: [
      'Cell-sharded memory handles 250k writes/sec without B-tree index thrashing.',
      'If driver enters tunnel and misses 10s ACK, lock TTL expires automatically and Dispatch Engine offers next ranked candidate.',
    ],
  },

  'edge-rate-limiter': {
    challengeId: 'edge-rate-limiter',
    headline: 'Inline Gateway filter + atomic Redis Lua token bucket + local in-memory fail-open fallback',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'API Clients', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'Edge API Gateway + Limiter', col: 1, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Sharded Redis Token Buckets', col: 2, row: 0 },
      { id: 'sol_svc', kind: 'service', label: 'Protected Upstream APIs', col: 2, row: 1 },
      { id: 'sol_cfg', kind: 'database', label: 'Policy Rules Store', col: 2, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'HTTPS' },
      { from: 'sol_gw', to: 'sol_redis', label: 'EVALSHA Lua <1ms' },
      { from: 'sol_gw', to: 'sol_svc', label: 'Allowed (200) / 429' },
      { from: 'sol_cfg', to: 'sol_gw', label: 'Push Rule Config' },
    ],
    writePath:
      'Every ingress call hashes (tenantId, routeId) -> runs single-roundtrip Redis EVALSHA Lua script computing token refill + atomic decrement -> sets X-RateLimit-Remaining or returns 429.',
    readPath:
      'Policy updates push from Rules Store via pub/sub watch into Gateway memory so zero DB reads sit on the request hot path.',
    storageNotes: [
      'Redis Cluster: hash-sharded keys rl:{tenant}:{route} storing (tokens, last_refill_ms) in ~32 bytes with automatic idle EXPIRE.',
      'Policy Config DB: versioned tenant quota tiers cached locally in gateway RAM.',
    ],
    staffTradeoffs: [
      'Hot single-tenant key (>100k RPS): Gateways lease small token batches (e.g. 50 tokens) in local memory to cut Redis QPS 50×.',
      'Redis outage resilience: strict 3ms socket timeout fails open to per-gateway local token bucket so API traffic stays online.',
    ],
  },

  'realtime-chat': {
    challengeId: 'realtime-chat',
    headline: 'Stateful WebSocket gateways + Redis session routing table + partitioned wide-column inbox store',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Chat Clients', col: 0, row: 1 },
      { id: 'sol_ws', kind: 'gateway', label: 'Stateful WS Gateways', col: 1, row: 1 },
      { id: 'sol_chat', kind: 'service', label: 'Chat & Routing Service', col: 2, row: 1 },
      { id: 'sol_route', kind: 'cache', label: 'Session & Presence Redis', col: 3, row: 0 },
      { id: 'sol_inbox', kind: 'database', label: 'Cassandra / Scylla Inbox DB', col: 3, row: 1 },
      { id: 'sol_push', kind: 'queue', label: 'Offline APNs / FCM Queue', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_ws', label: 'WSS Persistent' },
      { from: 'sol_ws', to: 'sol_chat', label: 'gRPC Internal' },
      { from: 'sol_chat', to: 'sol_route', label: 'Lookup user->GW' },
      { from: 'sol_chat', to: 'sol_inbox', label: 'Persist (convId, seq)' },
      { from: 'sol_chat', to: 'sol_push', label: 'If Offline' },
    ],
    writePath:
      'Alice sends send_msg(clientMsgId) -> WS Gateway forwards to Chat Service -> assigns monotonic per-conversation seqId -> writes durably to Inbox DB -> looks up Bob’s active WS Gateway in Redis and pushes frame (or enqueues mobile push if offline).',
    readPath:
      'On reconnect, client calls GET /inbox?sinceSeq=lastAckedSeq to replay missed envelopes in deterministic seqId order.',
    storageNotes: [
      'ScyllaDB / Cassandra: messages partitioned by conversation_id, clustered by seq_id ASC for sequential catch-up scans.',
      'Redis Session Store: user_sessions:{userId} -> gatewayHost + 30s heartbeat presence TTL.',
    ],
    staffTradeoffs: [
      'Presence storm control: only push live presence changes for small active conversations; pull presence on-demand for large contact lists.',
      '500-member groups fan out via Chat Service reading cached group membership list.',
    ],
  },

  'stream-aggregator': {
    challengeId: 'stream-aggregator',
    headline: 'Stateless edge collectors -> partitioned Kafka log -> stateful Flink window workers -> ClickHouse OLAP',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'SDK / Ad Beacons', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'Collector Gateway', col: 1, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Partitioned Kafka Log', col: 2, row: 1 },
      { id: 'sol_worker', kind: 'worker', label: 'Stateful Stream Aggregator', col: 3, row: 1 },
      { id: 'sol_olap', kind: 'database', label: 'ClickHouse / Druid OLAP', col: 4, row: 0 },
      { id: 'sol_s3', kind: 'blob', label: 'S3 Parquet Cold Lake', col: 4, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: '500k events/s' },
      { from: 'sol_gw', to: 'sol_kafka', label: '202 Ack' },
      { from: 'sol_kafka', to: 'sol_worker', label: 'Event-Time Windows' },
      { from: 'sol_worker', to: 'sol_olap', label: '1m Rollups (600x less)' },
      { from: 'sol_kafka', to: 'sol_s3', label: 'Raw Archive' },
    ],
    writePath:
      'Collector validates schema and appends batch to Kafka -> Stateful Flink/stream workers deduplicate eventId in RocksDB state, aggregate 1-minute event-time windows with watermarks, and flush compact rollups to ClickHouse.',
    readPath:
      'Advertiser dashboards query pre-aggregated 1-minute rollup tables in ClickHouse/Druid in < 80ms.',
    storageNotes: [
      'Kafka: retention 7d for replay; salted partition key (campaignId#0..7) for viral hot campaigns.',
      'ClickHouse OLAP: ReplacingMergeTree keyed by (campaign_id, window_minute) for idempotent upserts.',
    ],
    staffTradeoffs: [
      'Hot partition defense: two-phase local pre-aggregation with random key salting prevents one viral ad campaign from bottlenecking a single worker.',
      'Exactly-once billing: deterministic Kafka offset checkpoints + idempotent (campaign_id, window_start) OLAP upserts.',
    ],
  },

  'code-runner': {
    challengeId: 'code-runner',
    headline: 'Language-tagged job queues + ephemeral Firecracker microVM workers + Redis ZSET live leaderboard',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Contestant Browser', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_api', kind: 'service', label: 'Submission Service', col: 2, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Execution Job Queue', col: 3, row: 1 },
      { id: 'sol_vm', kind: 'worker', label: 'Firecracker Sandbox Pool', col: 4, row: 1 },
      { id: 'sol_db', kind: 'database', label: 'Submissions Postgres DB', col: 3, row: 0 },
      { id: 'sol_redis', kind: 'cache', label: 'Redis ZSET Leaderboard', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'POST / SSE' },
      { from: 'sol_gw', to: 'sol_api', label: 'Source Code' },
      { from: 'sol_api', to: 'sol_db', label: 'PENDING' },
      { from: 'sol_api', to: 'sol_q', label: 'Enqueue Job' },
      { from: 'sol_q', to: 'sol_vm', label: 'Pull + Visibility Timeout' },
      { from: 'sol_vm', to: 'sol_db', label: 'Write Verdict' },
      { from: 'sol_vm', to: 'sol_redis', label: 'ZADD Score' },
    ],
    writePath:
      'Submission Service writes PENDING record to Postgres -> enqueues job on SQS/Kafka -> isolated Firecracker microVM (no network, cgroup CPU/RAM/PID caps, read-only test mount) runs code -> persists verdict & updates Redis ZSET.',
    readPath:
      'Client receives verdict via SSE/pub-sub; GET /leaderboard reads O(log N) slice from Redis ZREVRANGE.',
    storageNotes: [
      'Postgres: submissions(id, user_id, problem_id, status, runtime_ms) with idempotent state transitions.',
      'Redis Sorted Set: contest:{id}:ranks scored by (solvedCount * 1e9 - penaltySeconds).',
    ],
    staffTradeoffs: [
      'Never run untrusted code in API pods; ephemeral microVMs destroy cleanly after each run.',
      'Poison-pill crash protection: queue visibility timeout + maxReceiveCount=3 routes kernel-crashing code to DLQ as Runtime Error.',
    ],
  },

  'url-shortener': {
    challengeId: 'url-shortener',
    headline: 'Range-leased Base62 ID generator + global Edge/Redis read-aside cache + sharded KV store',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Browser / Caller', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Global Edge PoP', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_svc', kind: 'service', label: 'Redirect & Write Service', col: 2, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Hot-Slug Redis Cache', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'DynamoDB / KV Slug Store', col: 3, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Async Click Analytics', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_cdn', label: 'GET /{slug}' },
      { from: 'sol_cdn', to: 'sol_gw', label: 'Cache Miss / POST' },
      { from: 'sol_gw', to: 'sol_svc', label: 'HTTPS' },
      { from: 'sol_svc', to: 'sol_redis', label: 'Read-Aside <2ms' },
      { from: 'sol_svc', to: 'sol_db', label: 'Slug -> URL' },
      { from: 'sol_svc', to: 'sol_q', label: 'Click Event' },
    ],
    writePath:
      'Write Service pulls next 64-bit integer from pre-leased counter block (or Snowflake ID), Base62-encodes to 7 chars with zero collision retries, and writes (slug -> targetUrl) to DynamoDB/Postgres.',
    readPath:
      'GET /{slug} checks Edge/Redis cache (~98% hit rate) -> returns HTTP 302 Location in < 20ms while firing non-blocking click telemetry.',
    storageNotes: [
      'DynamoDB / Cassandra: primary key slug (7B), target_url, expires_at (~250B/row -> ~2.5 TB for 10B links).',
      'Redis Cache: top 20% hot slugs (~50 GB) + short negative-cache TTL for invalid slugs.',
    ],
    staffTradeoffs: [
      '301 vs. 302: use 302 when click analytics or mutable destination URLs matter; use 301 + Edge cache for immutable ultra-low-latency links.',
      'Celebrity tweet spike: Edge PoP micro-caching (TTL 5s) + singleflight coalescing shields Redis hot key.',
    ],
  },

  'web-crawler': {
    challengeId: 'web-crawler',
    headline: 'Host-partitioned politeness frontier + local DNS/robots cache + SimHash dedup + S3 HTML archive',
    nodes: [
      { id: 'sol_frontier', kind: 'queue', label: 'Host-Partitioned Frontier', col: 0, row: 1 },
      { id: 'sol_worker', kind: 'worker', label: 'Fetcher & Parser Fleet', col: 1, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'DNS + robots.txt + Bloom Cache', col: 2, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'Crawl Metadata & SimHash DB', col: 2, row: 1 },
      { id: 'sol_blob', kind: 'blob', label: 'S3 Compressed HTML Store', col: 2, row: 2 },
    ],
    edges: [
      { from: 'sol_frontier', to: 'sol_worker', label: '1 host -> 1 queue' },
      { from: 'sol_worker', to: 'sol_cache', label: 'DNS / Seen URL' },
      { from: 'sol_worker', to: 'sol_db', label: 'SimHash Dedup' },
      { from: 'sol_worker', to: 'sol_blob', label: 'Archive HTML' },
      { from: 'sol_worker', to: 'sol_frontier', label: 'Discovered URLs' },
    ],
    writePath:
      'Politeness Router hashes hostname -> dedicated worker queue with nextAllowedAt heap -> Fetcher resolves via local caching DNS + cached robots.txt -> streams HTML (capped at 2 MB) -> computes SimHash -> writes raw body to S3 and enqueues canonicalized child URLs.',
    readPath:
      'Downstream indexers consume archived S3 WARC batches and metadata records sequentially.',
    storageNotes: [
      'Redis / RocksDB: Bloom filter of canonicalized URLs + cached robots.txt rules per domain.',
      'S3 WARC Archive: ~500 TB/month compressed raw HTML bodies.',
    ],
    staffTradeoffs: [
      'Consistent-hashing hostnames to single-consumer politeness queues strictly prevents parallel workers from DDoS-ing any origin.',
      'Spider-trap defense: max URL depth, query-param canonicalization, per-domain crawl budget, and SimHash near-duplicate rejection.',
    ],
  },

  'post-search': {
    challengeId: 'post-search',
    headline: 'CDC Kafka indexing pipeline + doc-partitioned inverted index shards + scatter-gather WAND coordinator',
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Search Caller', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', col: 1, row: 1 },
      { id: 'sol_coord', kind: 'service', label: 'Query Coordinator', col: 2, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Trending Query Redis', col: 3, row: 0 },
      { id: 'sol_idx', kind: 'search', label: 'Doc-Sharded Inverted Index', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Post CDC Kafka Stream', col: 1, row: 2 },
      { id: 'sol_ing', kind: 'worker', label: 'Tokenizer / Indexer', col: 2, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'GET /search' },
      { from: 'sol_gw', to: 'sol_coord', label: 'HTTPS' },
      { from: 'sol_coord', to: 'sol_cache', label: 'Hot Query Cache' },
      { from: 'sol_coord', to: 'sol_idx', label: 'Scatter-Gather Top-K' },
      { from: 'sol_kafka', to: 'sol_ing', label: '15k posts/s' },
      { from: 'sol_ing', to: 'sol_idx', label: 'Append Segment' },
    ],
    writePath:
      'Post mutations stream via Kafka -> Indexer tokenizes/stems text, routes by hash(docId) to shard -> appends lock-free to in-memory buffer flushed every 1–2s into immutable Lucene segments.',
    readPath:
      'Query Coordinator checks Redis for hot queries -> scatters query across N document shards with 90ms deadline -> shards intersect posting lists (ordered by recency/BM25) -> Coordinator heap-merges global top-K.',
    storageNotes: [
      'Inverted Index Shards (64 shards): local term -> [(docId, ts, positions)] posting lists; recent 7d hot tier in NVMe/RAM.',
      'Redis Query Cache: 5–15s TTL on trending news/hashtag searches absorbs burst QPS.',
    ],
    staffTradeoffs: [
      'Document-ID partitioning beats Term partitioning because multi-keyword intersections stay local inside each shard with zero cross-network posting-list joins.',
      'Straggler shard defense: hedged requests to shard replicas + partial-result return at 110ms deadline protects p99 < 150ms.',
    ],
  },
};

function clipRayToBoxEdge(
  box: { x: number; y: number; w: number; h: number },
  targetCx: number,
  targetCy: number,
  pad = 5,
): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = targetCx - cx;
  const dy = targetCy - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(scaleX, scaleY);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function buildSolutionExcalidrawSkeletons(
  solution: ArchetypeSolution,
  _isDark = false,
): Record<string, unknown>[] {
  const skeletons: Record<string, unknown>[] = [];
  const nodeBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const n of solution.nodes) {
    const preset = STENCIL_PRESETS.find((p) => p.kind === n.kind) ?? STENCIL_PRESETS[3];
    const w = 206;
    const h = preset.shape === 'diamond' ? 90 : 74;
    const x = 72 + n.col * 292;
    const y = 88 + n.row * 154;
    nodeBoxes.set(n.id, { x, y, w, h });

    // Excalidraw's dark theme automatically inverts standard light-surface hex colors
    skeletons.push({
      type: preset.shape,
      id: n.id,
      x,
      y,
      width: w,
      height: h,
      strokeColor: preset.strokeColor,
      backgroundColor: preset.backgroundColor,
      fillStyle: 'solid',
      strokeWidth: 1.5,
      roughness: 0,
      roundness: preset.shape === 'rectangle' ? { type: 3 } : null,
      customData: { kind: n.kind },
      label: {
        text: n.label,
        fontSize: 14,
        fontFamily: 2,
      },
    });
  }

  for (const e of solution.edges) {
    const a = nodeBoxes.get(e.from);
    const b = nodeBoxes.get(e.to);
    if (!a || !b) continue;
    const aCx = a.x + a.w / 2;
    const aCy = a.y + a.h / 2;
    const bCx = b.x + b.w / 2;
    const bCy = b.y + b.h / 2;

    const pStart = clipRayToBoxEdge(a, bCx, bCy, 4);
    const pEnd = clipRayToBoxEdge(b, aCx, aCy, 6);

    skeletons.push({
      type: 'arrow',
      x: pStart.x,
      y: pStart.y,
      points: [
        [0, 0],
        [pEnd.x - pStart.x, pEnd.y - pStart.y],
      ],
      strokeColor: '#334155',
      strokeWidth: 1.5,
      roughness: 0,
      start: { id: e.from },
      end: { id: e.to },
      ...(e.label ? { label: { text: e.label, fontSize: 12, fontFamily: 2 } } : {}),
    });
  }

  return skeletons;
}
