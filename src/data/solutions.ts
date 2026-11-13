import { STENCIL_PRESETS } from './methodology';
import type { ComponentKind } from '../types';

export interface ReferenceNodeSpec {
  id: string;
  kind: ComponentKind;
  label: string;
  spec: string;
  col: number;
  row: number;
}

export interface ReferenceEdgeSpec {
  from: string;
  to: string;
  label?: string;
  async?: boolean;
}

export interface BlueprintPlaneSpec {
  title: string;
  startCol: number;
  endCol: number;
}

export interface ArchetypeSolution {
  challengeId: string;
  headline: string;
  planes: BlueprintPlaneSpec[];
  nodes: ReferenceNodeSpec[];
  edges: ReferenceEdgeSpec[];
  capacityMath: string[];
  schemaAndKeys: string[];
  writePath: string;
  readPath: string;
  storageNotes: string[];
  staffTradeoffs: string[];
}

export const ARCHETYPE_SOLUTIONS: Record<string, ArchetypeSolution> = {
  'seat-ticketing': {
    challengeId: 'seat-ticketing',
    headline: 'Edge waiting room + Redis Lua fenced seat-hold (7m TTL) + ACID Postgres CAS ledger',
    planes: [
      { title: '01 · CLIENT & EDGE SURGE', startCol: 0, endCol: 0 },
      { title: '02 · INGRESS & WEBHOOKS', startCol: 1, endCol: 1 },
      { title: '03 · STATELESS COMPUTE', startCol: 2, endCol: 2 },
      { title: '04 · HOT LOCKS, CP LEDGER & ASYNC', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Fan Web / Mobile', spec: 'HTTPS + SSE Seat Deltas', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Edge Waiting Room', spec: 'Queue Token · 1s Bitmask', col: 0, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'Envoy API Gateway', spec: 'JWT · Rate Limit · IdemKey', col: 1, row: 1 },
      { id: 'sol_psp', kind: 'gateway', label: 'PSP Webhook Ingress', spec: 'Stripe HMAC · Replay Guard', col: 1, row: 2 },
      { id: 'sol_sse', kind: 'service', label: 'Seat-Map Delta Push', spec: 'SSE Pub/Sub · 2.5KB Bitset', col: 2, row: 0 },
      { id: 'sol_booking', kind: 'service', label: 'Booking & Hold API', spec: 'Stateless · Fenced Token', col: 2, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Redis Hold Cluster', spec: 'Lua NX EX 420s · 1.3MB/evt', col: 3, row: 0 },
      { id: 'sol_pg', kind: 'database', label: 'Postgres Order Ledger', spec: 'CP · CAS fencing_token', col: 3, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Kafka Order & Hold Bus', spec: 'Key: event_id · RF=3', col: 3, row: 2 },
      { id: 'sol_worker', kind: 'worker', label: 'Expiry & Refund Worker', spec: '7m Sweep · Late-Pay Refund', col: 4, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_cdn', label: 'GET /seats' },
      { from: 'sol_sse', to: 'sol_cdn', label: '1s Bitmask', async: true },
      { from: 'sol_client', to: 'sol_gw', label: 'POST /holds' },
      { from: 'sol_gw', to: 'sol_booking', label: 'Idem-Key' },
      { from: 'sol_booking', to: 'sol_redis', label: 'Lua NX 420s' },
      { from: 'sol_booking', to: 'sol_pg', label: 'INSERT HELD' },
      { from: 'sol_redis', to: 'sol_sse', label: 'Delta PubSub', async: true },
      { from: 'sol_psp', to: 'sol_q', label: 'PSP Webhook', async: true },
      { from: 'sol_booking', to: 'sol_q', label: 'hold.created', async: true },
      { from: 'sol_q', to: 'sol_worker', label: 'Ordered Pull', async: true },
      { from: 'sol_worker', to: 'sol_pg', label: 'CAS Token' },
    ],
    capacityMath: [
      'Hot seat state: 20,000 seats × 64 B = 1.28 MB/event -> 1,000 simultaneous stadium drops fit in 1.3 GB Redis RAM.',
      'Read surge offload: 500k fans refreshing every 2s = 250k RPS absorbed by Edge 1s bitmask + SSE deltas (< 500 RPS reach DB).',
      'Write burst: 20k seats locked in 10s = ~2,000 atomic Redis Lua ops/sec (< 0.4ms p99 per hash slot).',
    ],
    schemaAndKeys: [
      'Redis Lock: SET seat:{eventId}:{seatId} "{userId}:{fencingToken}" NX EX 420',
      'Postgres CP: seats(event_id, seat_id, status, fencing_token BIGINT, hold_until TIMESTAMPTZ, PRIMARY KEY(event_id, seat_id))',
      'Fenced Commit: UPDATE seats SET status=\'BOOKED\' WHERE event_id=$1 AND seat_id=$2 AND fencing_token=$3',
    ],
    writePath:
      'POST /holds validates virtual-queue token + idempotencyKey -> executes Redis Lua script issuing monotonic fencingToken with 420s TTL -> writes HELD row in Postgres -> PSP payment webhook commits BOOKED via conditional UPDATE ... WHERE fencing_token = $3.',
    readPath:
      'GET /events/{id}/seats serves a compact 2.5 KB section availability bitmask cached 1s at the Edge and streamed via SSE deltas so 500k waiting fans never touch Postgres.',
    storageNotes: [
      'Postgres 16 (Strict CP): partitioned by event_id; conditional fencing_token guard guarantees zero double-selling even if Redis crashes and restarts empty.',
      'Redis Cluster: holds ephemeral 7-minute seat locks, idempotency response cache (24h TTL), and compact section availability bitmaps.',
    ],
    staffTradeoffs: [
      'Fencing token against Redis split-brain: Redis alone is AP under network partition; monotonic fencing_token verified in Postgres CAS prevents stale lock holders from overwriting a newer hold.',
      'Late webhook after 7m expiry: if Stripe webhook arrives at 7m03s after seat was re-leased, fencing_token mismatch triggers an automatic idempotent refund via Reconciler Worker.',
    ],
  },

  'social-timeline': {
    challengeId: 'social-timeline',
    headline: 'Hybrid push/pull fan-out: async Redis ZSET push (<50k followers) + read-time VIP merge (>50k)',
    planes: [
      { title: '01 · CLIENT & MEDIA CDN', startCol: 0, endCol: 0 },
      { title: '02 · API INGRESS', startCol: 1, endCol: 1 },
      { title: '03 · WRITE & MIXER TIER', startCol: 2, endCol: 2 },
      { title: '04 · INBOX CACHE, GRAPH & FAN-OUT', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'iOS / Android / Web', spec: 'Cursor Feed + Presigned PUT', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Media CDN + S3 Store', spec: 'Direct Presigned Upload', col: 0, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'GraphQL / REST Gateway', spec: 'Auth · Token Bucket · TLS', col: 1, row: 1 },
      { id: 'sol_mixer', kind: 'service', label: 'Timeline Mixer Service', spec: 'Inbox + VIP Pull · <180ms', col: 2, row: 0 },
      { id: 'sol_post', kind: 'service', label: 'Post Write Service', spec: 'Snowflake ID · VIP Check', col: 2, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Sharded Inbox Redis', spec: 'ZSET 500 IDs · 14d Active', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'ScyllaDB Post & Graph', spec: 'PK: author_id, CK: post_id', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Kafka Post Event Log', spec: '5.8k posts/s · Partitioned', col: 2, row: 2 },
      { id: 'sol_worker', kind: 'worker', label: 'Adaptive Fan-Out Fleet', spec: 'Push if <50k Followers', col: 3, row: 2 },
      { id: 'sol_hydr', kind: 'cache', label: 'Post & Author L2 Cache', spec: 'MGET Payload Hydration', col: 4, row: 0 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_cdn', label: 'Presigned Media' },
      { from: 'sol_client', to: 'sol_gw', label: 'GET /feed · POST' },
      { from: 'sol_gw', to: 'sol_mixer', label: 'GET ?cursor=' },
      { from: 'sol_gw', to: 'sol_post', label: 'POST /posts' },
      { from: 'sol_mixer', to: 'sol_cache', label: 'ZREVRANGEBYSCORE' },
      { from: 'sol_mixer', to: 'sol_db', label: 'Merge VIP Posts' },
      { from: 'sol_mixer', to: 'sol_hydr', label: 'Batch Hydrate' },
      { from: 'sol_post', to: 'sol_db', label: 'Persist Durable' },
      { from: 'sol_post', to: 'sol_kafka', label: 'post.created', async: true },
      { from: 'sol_kafka', to: 'sol_worker', label: 'Non-VIP Stream', async: true },
      { from: 'sol_worker', to: 'sol_cache', label: 'ZADD + ZREMRANGE', async: true },
    ],
    capacityMath: [
      'Traffic asymmetry: 80M DAU -> ~92k peak read QPS vs. ~5.8k post write QPS (~16:1 read-heavy).',
      'Inbox RAM: 80M active users × 500 (postId 8B + score 8B) = ~640 GB across 32 Redis shards (evict >14d cold users).',
      'Fan-out cutoff: 50k-follower threshold caps write amplification while keeping read-time VIP merges <= 15 queries.',
    ],
    schemaAndKeys: [
      'Redis Inbox: ZADD feed:{userId} {snowflakeTs} {postId}  (capped to latest 500 entries)',
      'ScyllaDB Posts: PRIMARY KEY ((author_id), post_id) WITH CLUSTERING ORDER BY (post_id DESC)',
      'Follow Graph: follows_by_user((follower_id), celebrity_flag, followee_id) for O(1) VIP list lookup',
    ],
    writePath:
      'POST /posts mints a time-sortable 64-bit Snowflake postId, writes durably to ScyllaDB, warms Post L2 Cache, and emits post.created to Kafka. Adaptive Fan-Out Workers push postId into active followers’ Redis ZSETs ONLY when followerCount < 50,000.',
    readPath:
      'Timeline Mixer fetches 25 postIds from feed:{userId} via ZREVRANGEBYSCORE (<cursor), queries recent posts from followed >50k celebrity accounts in parallel, k-way merges + filters muted/deleted IDs, and batch-hydrates payloads via MGET.',
    storageNotes: [
      'ScyllaDB / Cassandra: wide-column store partitioned by author_id makes celebrity recent-post slices sequential single-partition reads.',
      'Two-tier Redis: Inbox ZSET stores compact 64-bit IDs only; hydrated post JSON lives once in shared Post L2 Cache.',
    ],
    staffTradeoffs: [
      'Eliminates celebrity hot-key fan-out lag (a 20M-follower post takes 0 fan-out writes and appears globally in <200ms).',
      'Cold-user rebuild: users inactive >14d have no Redis ZSET; first login reconstructs inbox asynchronously from ScyllaDB followees.',
    ],
  },

  'cloud-file-sync': {
    challengeId: 'cloud-file-sync',
    headline: 'Content-addressed 4 MB SHA-256 chunking + direct presigned S3 data plane + CAS metadata journal',
    planes: [
      { title: '01 · SYNC CLIENTS', startCol: 0, endCol: 0 },
      { title: '02 · DATA vs CONTROL INGRESS', startCol: 1, endCol: 1 },
      { title: '03 · METADATA & DELTA ENGINE', startCol: 2, endCol: 2 },
      { title: '04 · BLOCK STORE, CP JOURNAL & GC', startCol: 3, endCol: 3 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Desktop / Mobile Agent', spec: 'Rabin CDC · 4MB SHA-256', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Edge Chunk Download CDN', spec: 'Immutable Block Cache', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'Control API Gateway', spec: 'mTLS · Auth · Rate Limit', col: 1, row: 1 },
      { id: 'sol_sse', kind: 'gateway', label: 'SSE / Long-Poll Broker', spec: 'Stateful Cursor Push', col: 1, row: 2 },
      { id: 'sol_blob', kind: 'blob', label: 'S3 Immutable Block Store', spec: '/chunks/{sha256} · 11 9s', col: 2, row: 0 },
      { id: 'sol_meta', kind: 'service', label: 'Manifest & Commit API', spec: 'Missing-Hash Diff + CAS', col: 2, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Session & Dedup Redis', spec: 'Hot Chunk Bloom + Presence', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'Spanner Metadata Journal', spec: 'CP · base_version CAS', col: 3, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Workspace Delta & GC Log', spec: 'Kafka Cursor + Cold Tiering', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_blob', label: 'Presigned PUT 4MB' },
      { from: 'sol_cdn', to: 'sol_client', label: 'GET Missing Blocks' },
      { from: 'sol_blob', to: 'sol_cdn', label: 'Immutable Origin' },
      { from: 'sol_client', to: 'sol_gw', label: 'Diff + Commit Manifest' },
      { from: 'sol_gw', to: 'sol_meta', label: 'gRPC Control Plane' },
      { from: 'sol_meta', to: 'sol_cache', label: 'Check Existing Hashes' },
      { from: 'sol_meta', to: 'sol_db', label: 'COMMIT ver=base+1' },
      { from: 'sol_meta', to: 'sol_q', label: 'file.committed', async: true },
      { from: 'sol_q', to: 'sol_sse', label: 'Workspace Cursor', async: true },
      { from: 'sol_sse', to: 'sol_client', label: 'Push Delta Event', async: true },
    ],
    capacityMath: [
      'Chunking efficiency: editing 12 KB inside a 2 GB video uploads 1 × 4 MB chunk (99.8% bandwidth saved).',
      'Metadata sizing: 50B files × 180 B row ≈ 9 TB sharded metadata vs. multi-PB immutable S3/Glacier raw blocks.',
      'Control-plane protection: 0 file bytes traverse stateless API pods; S3 absorbs 100% of binary throughput.',
    ],
    schemaAndKeys: [
      'S3 Key: s3://blocks/{hash_prefix}/{sha256}  (content-addressed, immutable, globally deduplicated)',
      'SQL Journal: file_versions(workspace_id, file_id, version BIGINT, chunk_hashes BYTEA[], prev_version BIGINT)',
      'Optimistic CAS: UPDATE files SET head_ver = $new WHERE file_id = $id AND head_ver = $baseVer  (else 409 Conflict)',
    ],
    writePath:
      'Sync Agent chunks file locally via rolling Rabin fingerprint (~4 MB blocks) -> calls POST /manifests/diff with SHA-256 list -> receives presigned S3 PUT URLs ONLY for unseen hashes -> uploads blocks directly to S3 -> commits new version in Spanner/Postgres using baseVersion CAS.',
    readPath:
      'Peer devices hold idle SSE/Long-Poll cursor connections -> receive workspace cursor bump in <1s -> fetch new chunk manifest -> pull only missing SHA-256 blocks via Edge CDN and reconstruct file locally.',
    storageNotes: [
      'Spanner / Sharded Postgres: strictly serializes per-workspace version cursors so offline devices replaying missed changes never skip updates.',
      'S3 + Lifecycle Policy: blocks unreferenced >30d transition to Glacier Instant Retrieval; zero in-place block mutation.',
    ],
    staffTradeoffs: [
      'Concurrent offline edit safety: if two laptops edit v7 offline, first writer commits v8; second gets HTTP 409 and materializes a deterministic "conflicted copy" with zero silent overwrite.',
      'Cross-user deduplication resistance to hash-confirmation side channels: require client proof-of-possession (chunk challenge or convergent encryption) before marking pre-existing global block uploaded.',
    ],
  },

  'ride-dispatch': {
    challengeId: 'ride-dispatch',
    headline: 'City-sharded H3 res-9 in-memory geo index (250k GPS/s) + 12s fenced atomic driver offer locks',
    planes: [
      { title: '01 · MOBILE CLIENTS', startCol: 0, endCol: 0 },
      { title: '02 · REGIONAL INGRESS', startCol: 1, endCol: 1 },
      { title: '03 · INGEST & MATCH ENGINE', startCol: 2, endCol: 2 },
      { title: '04 · H3 MEMORY, CP TRIP DB & STREAM', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Driver & Rider Apps', spec: '4s GPS Ping · Trip WS', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'Regional WS + API GW', spec: 'Sticky TLS · Geo-Routed', col: 1, row: 1 },
      { id: 'sol_loc', kind: 'service', label: 'Location Ingest Service', spec: '250k pings/s · H3 Map', col: 2, row: 0 },
      { id: 'sol_match', kind: 'service', label: 'Dispatch Match Engine', spec: 'k-Ring + Road-ETA Rank', col: 2, row: 1 },
      { id: 'sol_h3', kind: 'cache', label: 'City-Sharded H3 Redis', spec: 'Cell Sets + 12s NX Lock', col: 3, row: 0 },
      { id: 'sol_eta', kind: 'cache', label: 'Road Graph & ETA Cache', spec: 'Contraction Hierarchies', col: 4, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'CockroachDB Trip Ledger', spec: 'CP · Fenced Trip State', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Kafka GPS & Trip Stream', spec: 'City-Partitioned Telemetry', col: 2, row: 2 },
      { id: 'sol_surge', kind: 'worker', label: 'Flink Surge & Archive', spec: '30s Supply/Demand Ratio', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'WSS Ping / POST /trips' },
      { from: 'sol_gw', to: 'sol_loc', label: '250k pings/s' },
      { from: 'sol_gw', to: 'sol_match', label: 'Request / Accept' },
      { from: 'sol_loc', to: 'sol_h3', label: 'Move H3 Cell + TTL 15s' },
      { from: 'sol_match', to: 'sol_h3', label: 'k-Ring + Lock Driver' },
      { from: 'sol_match', to: 'sol_eta', label: 'Batch Road ETA' },
      { from: 'sol_match', to: 'sol_db', label: 'CAS Trip State' },
      { from: 'sol_loc', to: 'sol_kafka', label: 'Async Breadcrumbs', async: true },
      { from: 'sol_kafka', to: 'sol_surge', label: '30s Windows', async: true },
      { from: 'sol_surge', to: 'sol_h3', label: 'Publish Surge Multiplier', async: true },
    ],
    capacityMath: [
      'Write velocity: 1M active drivers ÷ 4s = 250,000 GPS updates/sec -> pure RAM updates (~120 B/driver = 120 MB global active RAM!).',
      'Spatial locality: rides are 100% regional -> shard H3 Redis & Match Engine by metro area with zero cross-continent locks.',
      'Match budget: H3 k-ring candidate fetch (2ms) + road-network ETA matrix for top 20 drivers (18ms) + NX lock (1ms) << 800ms p99.',
    ],
    schemaAndKeys: [
      'H3 Cell Index: SADD h3:{city}:{cellRes9} {driverId}  +  HSET drv:{driverId} lat .. lng .. ts .. (EXPIRE 15s)',
      'Atomic Offer Lock: SET driver_offer:{driverId} "{tripId}:{offerSeq}" NX EX 12',
      'Trip Ledger: trips(trip_id, rider_id, driver_id, state, offer_seq INT, idempotency_key UNIQUE)',
    ],
    writePath:
      'Location Service ingests 250k WebSocket pings/sec, computes Uber H3 res-9 hex (~170m edge), atomically moves driverId between cell sets in regional Redis with 15s stale auto-expiry, and tees raw breadcrumbs asynchronously to Kafka.',
    readPath:
      'Dispatch Engine expands H3 k-rings around pickup, scores top candidates by road-graph ETA (not Euclidean distance across rivers/highways!), acquires a 12s atomic driver_offer NX lock, and pushes offer via WebSocket.',
    storageNotes: [
      'Regional H3 Redis: never persists raw 4s pings to disk; lost shard rebuilds complete city state within 4 seconds from live driver heartbeats.',
      'CockroachDB / Spanner: stores durable billing-critical Trip transitions guarded by idempotency_key and offer_seq.',
    ],
    staffTradeoffs: [
      'Batch window matching vs. greedy first-come: 2-second micro-batching in dense downtown cores minimizes aggregate fleet pickup ETA via bipartite matching.',
      'Tunnel / dropped-ACK recovery: 12s Redis lock TTL expires automatically if driver loses cellular signal, advancing immediately to candidate #2.',
    ],
  },

  'edge-rate-limiter': {
    challengeId: 'edge-rate-limiter',
    headline: 'Envoy L1 batch-token lease cache + sharded Redis Lua token bucket + circuit-breaker fail-open',
    planes: [
      { title: '01 · API CALLERS', startCol: 0, endCol: 0 },
      { title: '02 · ANYCAST EDGE & ENVOY', startCol: 1, endCol: 1 },
      { title: '03 · HOT QUOTA & UPSTREAM', startCol: 2, endCol: 2 },
      { title: '04 · CONTROL PLANE & TELEMETRY', startCol: 3, endCol: 3 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'External SDK / Callers', spec: '1.2M RPS Global Ingress', col: 0, row: 1 },
      { id: 'sol_pop', kind: 'cdn', label: 'Anycast L4 Edge PoP', spec: 'DDoS Scrub + Geo-Anycast', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'Envoy + L1 Token Filter', spec: 'RAM Lease + 3ms Breaker', col: 1, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Redis Lua Token Cluster', spec: 'EVALSHA <0.8ms · 64 Shards', col: 2, row: 0 },
      { id: 'sol_svc', kind: 'service', label: 'Protected Core APIs', spec: 'Receives X-RateLimit-*', col: 2, row: 1 },
      { id: 'sol_bus', kind: 'queue', label: 'Rule Watch Pub/Sub', spec: 'Instant Policy Push', col: 2, row: 2 },
      { id: 'sol_admin', kind: 'service', label: 'Quota Control-Plane API', spec: 'Tenant Tier CRUD', col: 3, row: 2 },
      { id: 'sol_cfg', kind: 'database', label: 'Postgres Policy Store', spec: 'Versioned Quota Tiers', col: 3, row: 1 },
      { id: 'sol_tel', kind: 'queue', label: 'Kafka 429 & Usage Stream', spec: 'Async Billing & Abuse', col: 3, row: 0 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_pop', label: 'HTTPS 1.2M RPS' },
      { from: 'sol_pop', to: 'sol_gw', label: 'L7 Proxy' },
      { from: 'sol_gw', to: 'sol_redis', label: 'EVALSHA / Batch Lease' },
      { from: 'sol_gw', to: 'sol_svc', label: '200 Pass / 429 Drop' },
      { from: 'sol_gw', to: 'sol_tel', label: 'Sampled 429 Metrics', async: true },
      { from: 'sol_admin', to: 'sol_cfg', label: 'Update Tier' },
      { from: 'sol_admin', to: 'sol_bus', label: 'rule.updated', async: true },
      { from: 'sol_bus', to: 'sol_gw', label: 'Hot Reload RAM', async: true },
    ],
    capacityMath: [
      'Overhead budget: 1.2M RPS across 64 Redis shards = ~18.7k ops/shard/sec (< 0.8ms single-roundtrip Lua EVALSHA).',
      'RAM footprint: 20M active (tenant, route) buckets × 48 B = ~960 MB total Redis memory with idle EXPIRE.',
      'Hot-tenant mitigation: leasing 50 tokens at a time in Envoy RAM cuts a 200k-RPS whale tenant down to 4k Redis ops/sec.',
    ],
    schemaAndKeys: [
      'Redis Bucket: HMSET rl:{tenantId}:{routeId} tokens {rem} last_ms {now}  +  PEXPIRE {windowMs * 2}',
      'Lua Atomicity: single script computes elapsed * refillRate, clamps to burstCap, decrements 1 (or batch N), returns {allowed, remaining, resetMs}',
      'HTTP Headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After (RFC 6585)',
    ],
    writePath:
      'Envoy filter checks in-memory L1 rule config -> for ultra-high-rate keys consumes from local leased token batch; otherwise runs atomic 1-RTT Redis EVALSHA Lua token-bucket script -> injects X-RateLimit-* headers or returns 429 at the edge.',
    readPath:
      'Policy changes written to Quota Admin API persist in Postgres and broadcast over Pub/Sub into every Envoy pod’s memory so zero SQL queries ever block ingress requests.',
    storageNotes: [
      'Redis Cluster: uses Redis server TIME (not gateway wall clock) inside Lua so clock skew across Envoy pods never corrupts refill math.',
      'Local Fallback Ring: tiny bounded LRU token bucket inside each Envoy process activates automatically if Redis socket exceeds 3ms.',
    ],
    staffTradeoffs: [
      'Fail-open vs. fail-closed: general API gateways fail OPEN to local per-pod memory limits on Redis outage to avoid global self-inflicted downtime; auth/login brute-force endpoints fail CLOSED.',
      'Token bucket vs. fixed window: token bucket eliminates the 2× boundary-spike exploit at minute rollovers while requiring only 2 numbers (tokens, timestamp) vs. expensive sliding-window ZSETs.',
    ],
  },

  'realtime-chat': {
    challengeId: 'realtime-chat',
    headline: 'Stateful WebSocket edge fleet + Redis presence/session router + ScyllaDB monotonic per-chat inbox',
    planes: [
      { title: '01 · E2EE CLIENTS', startCol: 0, endCol: 0 },
      { title: '02 · STATEFUL WS EDGE', startCol: 1, endCol: 1 },
      { title: '03 · CHAT & PRESENCE CORE', startCol: 2, endCol: 2 },
      { title: '04 · SESSION REDIS, INBOX & PUSH', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Mobile / Desktop E2EE', spec: 'Signal Ratchet · WSS', col: 0, row: 1 },
      { id: 'sol_media', kind: 'blob', label: 'Encrypted Media S3 + CDN', spec: 'AES-GCM Ciphertext Blobs', col: 1, row: 0 },
      { id: 'sol_ws', kind: 'gateway', label: 'Stateful WS Gateways', spec: '100k Conns/Pod · Epoll', col: 1, row: 1 },
      { id: 'sol_pres', kind: 'service', label: 'Presence & Typing Svc', spec: 'Lazy Pull + Active Sub', col: 2, row: 0 },
      { id: 'sol_chat', kind: 'service', label: 'Chat & Sequencer Svc', spec: 'Monotonic conv seq_id', col: 2, row: 1 },
      { id: 'sol_route', kind: 'cache', label: 'Session & Presence Redis', spec: 'user->gwPod · 30s Beat', col: 3, row: 0 },
      { id: 'sol_inbox', kind: 'database', label: 'ScyllaDB Message Inbox', spec: 'PK:(conv,bucket) CK:seq', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Kafka Group & Offline Bus', spec: '500-Member Fan-Out', col: 2, row: 2 },
      { id: 'sol_push', kind: 'worker', label: 'APNs / FCM Push Fleet', spec: 'Coalesced Wakeup Push', col: 3, row: 2 },
      { id: 'sol_kv', kind: 'database', label: 'PreKey & Group Member DB', spec: 'Public Identity Bundles', col: 4, row: 1 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_media', label: 'Presigned Ciphertext' },
      { from: 'sol_client', to: 'sol_ws', label: 'Persistent WSS' },
      { from: 'sol_ws', to: 'sol_pres', label: '30s Heartbeat', async: true },
      { from: 'sol_pres', to: 'sol_route', label: 'SETEX presence 35s' },
      { from: 'sol_ws', to: 'sol_chat', label: 'gRPC send_msg' },
      { from: 'sol_chat', to: 'sol_inbox', label: 'Quorum Write seq_id' },
      { from: 'sol_chat', to: 'sol_route', label: 'Lookup Recipient GW' },
      { from: 'sol_chat', to: 'sol_kv', label: 'Cached Group Members' },
      { from: 'sol_chat', to: 'sol_kafka', label: 'Group / Offline', async: true },
      { from: 'sol_kafka', to: 'sol_push', label: 'Wake Offline Device', async: true },
    ],
    capacityMath: [
      'Connection fleet: 25M concurrent sockets ÷ 100k sockets/pod = 250 stateful WS Gateway pods (~2.4 GB kernel/buffer RAM each).',
      'Storage growth: 40B msgs/day × 250 B ciphertext envelope = 10 TB/day compressed across time-bucketed ScyllaDB partitions.',
      'Delivery SLA: local Quorum write (4ms) + Redis session lookup (1ms) + internal gRPC push to recipient WS pod (6ms) << 120ms p99.',
    ],
    schemaAndKeys: [
      'ScyllaDB: messages(conv_id UUID, bucket INT, seq_id BIGINT, client_msg_id UUID, ciphertext BLOB, PRIMARY KEY((conv_id, bucket), seq_id))',
      'Session Map: HSET sess:{userId} {deviceId} "{gwPodIp}:{connId}"  (refreshed on 30s ping)',
      'Idempotency: deduplicate retry of (conv_id, client_msg_id) so flaky subway Wi-Fi never creates duplicate bubbles',
    ],
    writePath:
      'Client encrypts payload locally with recipient Signal session -> sends over WSS with clientMsgId -> Chat Service assigns monotonic per-conversation seqId, writes quorum-durably to ScyllaDB, looks up recipient device’s WS Gateway pod in Redis, and pushes frame directly (or enqueues APNs/FCM push on miss).',
    readPath:
      'Reconnecting devices send sync(lastSeenSeq) -> single sequential partition scan in ScyllaDB streams all missed envelopes in strict causal order; attachments download directly from CDN and decrypt on-device.',
    storageNotes: [
      'Bucketed Wide-Column Partitions: (conv_id, time_bucket) prevents unbounded partition growth in multi-year active group chats.',
      'Zero plaintext on server: E2EE PreKey bundles live in Key DB; servers route opaque ciphertext + sequence metadata only.',
    ],
    staffTradeoffs: [
      'Presence fan-out storm avoidance: never broadcast "online" to 2,000 contacts on every app foreground; subscribe to live presence ONLY for the currently open chat screen.',
      'WS pod drain / crash: consistent-hashed reconnect jitter (0–5s backoff) stops 100k disconnected clients from thundering-herding remaining gateways.',
    ],
  },

  'stream-aggregator': {
    challengeId: 'stream-aggregator',
    headline: 'Stateless edge collectors -> salted Kafka partitions -> two-phase Flink event-time windows -> ClickHouse OLAP',
    planes: [
      { title: '01 · SDK BEACONS', startCol: 0, endCol: 0 },
      { title: '02 · COLLECTOR & LOG', startCol: 1, endCol: 1 },
      { title: '03 · TWO-PHASE STREAM ENGINE', startCol: 2, endCol: 2 },
      { title: '04 · REAL-TIME OLAP, LAKE & API', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Ad SDK & Beacons', spec: '500k clicks/s · click_id', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'Edge Collector Fleet', spec: 'Schema Check · 202 Ack', col: 1, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Kafka Raw Click Log', spec: 'Salted Key · 7d Replay', col: 1, row: 2 },
      { id: 'sol_p1', kind: 'worker', label: 'Flink Phase-1 Dedup', spec: 'RocksDB Bloom + Local Sum', col: 2, row: 1 },
      { id: 'sol_p2', kind: 'worker', label: 'Flink Phase-2 Window', spec: '1m Event-Time + Watermark', col: 2, row: 2 },
      { id: 'sol_olap', kind: 'database', label: 'ClickHouse OLAP Shards', spec: 'ReplacingMergeTree <80ms', col: 3, row: 1 },
      { id: 'sol_s3', kind: 'blob', label: 'S3 Parquet / Iceberg Lake', spec: 'Immutable Billing Audit', col: 3, row: 2 },
      { id: 'sol_api', kind: 'service', label: 'Advertiser Query API', spec: 'Rollup + Budget Guard', col: 4, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Dashboard Rollup Redis', spec: '5s Hot Campaign Cache', col: 4, row: 0 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'POST /beacon (500k/s)' },
      { from: 'sol_gw', to: 'sol_kafka', label: 'Async Batch Append', async: true },
      { from: 'sol_kafka', to: 'sol_p1', label: 'Partitioned by click_id', async: true },
      { from: 'sol_p1', to: 'sol_p2', label: 'Salted Partial Aggregates', async: true },
      { from: 'sol_p2', to: 'sol_olap', label: 'Idempotent 1m Upsert', async: true },
      { from: 'sol_kafka', to: 'sol_s3', label: 'Hourly Parquet Sink', async: true },
      { from: 'sol_api', to: 'sol_cache', label: 'Hot Campaign Read' },
      { from: 'sol_api', to: 'sol_olap', label: 'SQL Rollup <80ms' },
    ],
    capacityMath: [
      'Write reduction: 500,000 raw clicks/sec -> aggregated into 50k active campaigns ÷ 60s ≈ ~830 rollup rows/sec in ClickHouse (600× compression!).',
      'Dedup state: 500k clicks/sec × 3,600s (1h retry window) × 16 B click_id ≈ 28.8 GB RocksDB state sharded across 32 Flink taskmanagers.',
      'Raw audit lake: 500k/s × 150 B ≈ 75 MB/s -> ~1.1 TB/day Zstd-compressed Parquet in S3.',
    ],
    schemaAndKeys: [
      'Phase-1 Key: hash(click_id) -> exact-once dedup in RocksDB TTL state before pre-aggregating (campaign_id, salt_0_15, minute)',
      'ClickHouse DDL: CREATE TABLE click_rollups (campaign_id UInt64, window_min DateTime, version UInt64, clicks UInt64, spend_micros UInt64) ENGINE = ReplacingMergeTree(version) ORDER BY (campaign_id, window_min)',
      'Late Events: 5-minute allowed lateness watermark emits updated (campaign_id, window_min, version+1) row',
    ],
    writePath:
      'Edge Collectors validate beacon signatures and batch-append to Kafka -> Flink Phase-1 deduplicates click_id in RocksDB state and emits salted partial counts -> Flink Phase-2 merges salts per 1-minute event-time window and writes deterministic versioned upserts to ClickHouse.',
    readPath:
      'Advertiser Dashboard API serves live spend & CTR from ClickHouse 1-minute rollup tables (with 5s Redis caching on top dashboards) in < 80ms p99.',
    storageNotes: [
      'ClickHouse ReplacingMergeTree: columnar compression + deterministic deduplication on (campaign_id, window_min) guarantees replay safety without distributed 2PC.',
      'S3 Iceberg Cold Lake: preserves raw immutable events for nightly financial reconciliation and fraud backfills.',
    ],
    staffTradeoffs: [
      'Super Bowl viral-ad skew defense: salting hot campaign_id across 16 sub-keys in Phase-1 prevents one campaign with 200k clicks/sec from pegging a single Flink CPU core.',
      'Crash & replay idempotency: Flink barrier checkpoints align Kafka offsets with deterministic window version numbers so replaying 10 minutes of Kafka never double-bills an advertiser.',
    ],
  },

  'code-runner': {
    challengeId: 'code-runner',
    headline: 'Priority language queues + network-airgapped Firecracker microVMs + Redis ZSET contest leaderboard',
    planes: [
      { title: '01 · CONTESTANT IDE', startCol: 0, endCol: 0 },
      { title: '02 · API & STREAMING', startCol: 1, endCol: 1 },
      { title: '03 · SUBMISSION & QUEUES', startCol: 2, endCol: 2 },
      { title: '04 · AIRGAPPED MICROVMS & STATE', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Browser Code Editor', spec: 'POST Code + SSE Verdict', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'API & SSE Gateway', spec: 'Per-User Burst Rate Limit', col: 1, row: 1 },
      { id: 'sol_api', kind: 'service', label: 'Submission & Contest API', spec: 'Idempotent Job Mint', col: 2, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Language Priority Queues', spec: 'VisTimeout 15s · AutoScale', col: 2, row: 2 },
      { id: 'sol_dlq', kind: 'queue', label: 'Poison-Pill Quarantine', spec: 'maxReceive=3 -> Crash Verdict', col: 3, row: 2 },
      { id: 'sol_vm', kind: 'worker', label: 'Firecracker MicroVM Fleet', spec: 'net=none · cgroups · 125ms', col: 4, row: 2 },
      { id: 'sol_blob', kind: 'blob', label: 'Testcase SquashFS Store', spec: 'S3 + Local NVMe Snapshot', col: 4, row: 1 },
      { id: 'sol_db', kind: 'database', label: 'Postgres Submissions DB', spec: 'Verdict + Penalty Ledger', col: 3, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Redis ZSET Leaderboard', spec: 'O(log N) Rank + Pub/Sub', col: 3, row: 0 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'POST /submissions · SSE' },
      { from: 'sol_gw', to: 'sol_api', label: 'Source + Lang' },
      { from: 'sol_api', to: 'sol_db', label: 'INSERT PENDING' },
      { from: 'sol_api', to: 'sol_q', label: 'Enqueue sub_id', async: true },
      { from: 'sol_q', to: 'sol_vm', label: 'Lease Job (15s)', async: true },
      { from: 'sol_q', to: 'sol_dlq', label: '>3 Crashes', async: true },
      { from: 'sol_blob', to: 'sol_vm', label: 'RO Mount Tests' },
      { from: 'sol_vm', to: 'sol_db', label: 'CAS Verdict + ms' },
      { from: 'sol_vm', to: 'sol_redis', label: 'ZADD Contest Score', async: true },
      { from: 'sol_redis', to: 'sol_gw', label: 'Pub/Sub Verdict', async: true },
    ],
    capacityMath: [
      'Worker pool sizing: 60k submissions/min = 1,000 jobs/sec × 0.8s avg CPU+compile = ~800 concurrent microVM slots (~1,100 w/ headroom).',
      'Warm snapshot boot: pre-warmed Firecracker snapshots restore in <125ms vs. 2s cold container boot.',
      'Leaderboard speed: 100k contestants in 1 Redis ZSET (~6.4 MB RAM) -> ZREVRANGE top-100 + ZREVRANK user in <0.3ms.',
    ],
    schemaAndKeys: [
      'Sandbox Spec: Firecracker VM | vCPU=1 | Mem=256MB | pids.max=64 | fsize=16MB | network=NONE | rootfs=read-only',
      'Leaderboard Score: score = (problemsSolved * 10^9) - totalPenaltySeconds  (single 64-bit IEEE float/int rank key)',
      'SQL Idempotency: UPDATE submissions SET status=$verdict WHERE id=$subId AND status IN (\'PENDING\',\'RUNNING\')',
    ],
    writePath:
      'Submission API persists PENDING row and enqueues job onto language-specific queue -> isolated worker boots pre-warmed Firecracker microVM with zero NICs and read-only SquashFS test mount -> captures exit code/time/RSS -> destroys VM -> writes verdict to Postgres and updates Redis ZSET.',
    readPath:
      'Redis Pub/Sub pushes instant testcase progress & final verdict over SSE to the contestant’s browser; GET /leaderboard slices Redis ZREVRANGE in <1ms without SQL GROUP BY.',
    storageNotes: [
      'Local NVMe SquashFS Cache: immutable problem testcases are cached as read-only block images on worker hosts so 1,000 VMs/sec never re-download 50 MB test zips.',
      'Quarantine DLQ: if untrusted payload triggers hypervisor/host crash 3 times, maxReceiveCount routes job to DLQ and marks SYSTEM_ERROR automatically.',
    ],
    staffTradeoffs: [
      'Why Firecracker microVMs over plain Docker containers: shared host Linux kernel syscalls are too wide an attack surface for arbitrary C++/Rust/ASM root-exploit attempts; KVM hardware virtualization isolates kernel panics.',
      'Contest-end spike shedding: decouple interactive "Run Sample" queue (higher priority, tiny timeout) from "Full Judge" queue and autoscale spot VM hosts ahead of scheduled contest start.',
    ],
  },

  'url-shortener': {
    challengeId: 'url-shortener',
    headline: 'Range-leased Base62 counter allocator + Anycast PoP micro-cache + singleflight Redis/Scylla KV',
    planes: [
      { title: '01 · GLOBAL CALLERS', startCol: 0, endCol: 0 },
      { title: '02 · EDGE POP & INGRESS', startCol: 1, endCol: 1 },
      { title: '03 · READ vs WRITE TIER', startCol: 2, endCol: 2 },
      { title: '04 · ID RANGES, KV & ANALYTICS', startCol: 3, endCol: 4 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Browser / Link Clicker', spec: '150k Redirects/s Peak', col: 0, row: 1 },
      { id: 'sol_cdn', kind: 'cdn', label: 'Anycast Edge PoP Cache', spec: '5s Micro-Cache · 302/301', col: 1, row: 0 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', spec: 'TLS · Abuse Rate Limit', col: 1, row: 1 },
      { id: 'sol_read', kind: 'service', label: 'Redirect Read Service', spec: 'Singleflight · <15ms p99', col: 2, row: 0 },
      { id: 'sol_write', kind: 'service', label: 'Slug Creation Service', spec: 'RAM Counter -> Base62', col: 2, row: 1 },
      { id: 'sol_redis', kind: 'cache', label: 'Hot-Slug + Bloom Redis', spec: 'Top 20% + Negative TTL', col: 3, row: 0 },
      { id: 'sol_db', kind: 'database', label: 'Scylla / DynamoDB KV', spec: 'PK: slug (7B) · 2.5 TB', col: 3, row: 1 },
      { id: 'sol_coord', kind: 'database', label: 'Etcd Counter Allocator', spec: 'Lease 100k ID Blocks', col: 4, row: 1 },
      { id: 'sol_q', kind: 'queue', label: 'Kafka Click Telemetry', spec: 'Async Geo/UA -> OLAP', col: 2, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_cdn', label: 'GET /{slug}' },
      { from: 'sol_cdn', to: 'sol_read', label: 'PoP Miss' },
      { from: 'sol_client', to: 'sol_gw', label: 'POST /urls' },
      { from: 'sol_gw', to: 'sol_write', label: 'Create Link' },
      { from: 'sol_write', to: 'sol_coord', label: 'Lease 100k Block' },
      { from: 'sol_write', to: 'sol_db', label: 'PUT slug->url' },
      { from: 'sol_read', to: 'sol_redis', label: 'GET <1ms (98% hit)' },
      { from: 'sol_read', to: 'sol_db', label: 'Coalesced Miss' },
      { from: 'sol_read', to: 'sol_q', label: 'Async Click Event', async: true },
    ],
    capacityMath: [
      'Keyspace math: 62^7 = 3.52 trillion unique 7-char slugs -> >1,000 years at 100 new links/sec.',
      'Storage sizing: 10B links × 250 B (slug, url, owner, exp) = 2.5 TB durable KV; top 20% hot working set fits in ~64 GB Redis.',
      'Allocator load: each Write pod leases 100,000 IDs at a time in RAM -> Etcd sees < 0.05 requests/sec!',
    ],
    schemaAndKeys: [
      'KV Primary Key: urls(slug CHAR(7) PRIMARY KEY, target_url TEXT, expires_at BIGINT, status TINYINT)',
      'ID Obfuscation: feistelCipherPermute(counter64) -> encodeBase62() prevents sequential URL enumeration',
      'Negative Cache: invalid/expired slugs cached in Redis for 30s + Bloom filter to block random-slug DB scans',
    ],
    writePath:
      'Slug Creation Service increments its in-memory leased counter (zero DB roundtrips for ID generation), applies a reversible bit-permutation so slugs aren’t sequentially guessable, Base62-encodes to 7 chars, writes to DynamoDB/Scylla, and warms Redis.',
    readPath:
      'GET /{slug} hits Anycast PoP (5s micro-cache absorbs viral tweet storms) -> Redirect Service checks Redis (~98% hit) with Go-style singleflight request coalescing on cache miss -> returns HTTP 302 while firing non-blocking click telemetry to Kafka.',
    storageNotes: [
      'Etcd / ZooKeeper Range Lease: losing a Write pod discards at most <100k unused integers out of 3.5 trillion—trivial cost for zero coordination on hot writes.',
      '302 vs. 301 trade-off: default to 302 + short Edge Cache-Control so analytics & malicious-link takedowns work immediately.',
    ],
    staffTradeoffs: [
      'Why Base62 range leases beat truncated SHA-256: random 7-char hashes collide increasingly via the Birthday Paradox, forcing read-before-write conditional retries.',
      'Cache stampede protection: singleflight ensures 50k simultaneous clicks on a cold viral slug issue exactly 1 DynamoDB read.',
    ],
  },

  'web-crawler': {
    challengeId: 'web-crawler',
    headline: 'Host-hashed politeness queues + local DNS/robots cache + 64-bit SimHash dedup + S3 WARC archive',
    planes: [
      { title: '01 · FRONTIER SCHEDULER', startCol: 0, endCol: 0 },
      { title: '02 · POLITE FETCH FLEET', startCol: 1, endCol: 1 },
      { title: '03 · PARSE & DEDUP PIPELINE', startCol: 2, endCol: 2 },
      { title: '04 · WARC LAKE & INDEX BUS', startCol: 3, endCol: 3 },
    ],
    nodes: [
      { id: 'sol_prio', kind: 'service', label: 'Priority & Recency Scorer', spec: 'PageRank × ChangeRate', col: 0, row: 1 },
      { id: 'sol_front', kind: 'queue', label: 'Host-Sharded Queues', spec: '1 Domain -> 1 Delay Heap', col: 0, row: 2 },
      { id: 'sol_dns', kind: 'cache', label: 'Local DNS + robots.txt', spec: 'Cached Crawl-Delay Rules', col: 1, row: 0 },
      { id: 'sol_fetch', kind: 'worker', label: 'Async HTTP Fetcher Fleet', spec: '25k pages/s · 2MB Cap', col: 1, row: 1 },
      { id: 'sol_parse', kind: 'worker', label: 'DOM Parser & Canonicalizer', spec: 'SimHash-64 + URL Clean', col: 2, row: 1 },
      { id: 'sol_bloom', kind: 'cache', label: 'Sharded URL Bloom + SimHash', spec: 'RocksDB Seen-URL Filter', col: 2, row: 0 },
      { id: 'sol_meta', kind: 'database', label: 'Host & Crawl State DB', spec: 'ETag · Last-Modified · Depth', col: 2, row: 2 },
      { id: 'sol_s3', kind: 'blob', label: 'S3 Zstd WARC Archive', spec: '500 TB/mo Raw HTML', col: 3, row: 1 },
      { id: 'sol_idx', kind: 'queue', label: 'Kafka Parsed Doc Stream', spec: 'Feeds Search Indexers', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_prio', to: 'sol_front', label: 'Route hash(host)', async: true },
      { from: 'sol_front', to: 'sol_fetch', label: 'Pop when now>=nextAt' },
      { from: 'sol_fetch', to: 'sol_dns', label: 'DNS + robots Check' },
      { from: 'sol_fetch', to: 'sol_parse', label: 'Streamed Body', async: true },
      { from: 'sol_parse', to: 'sol_bloom', label: 'Hamming<=3 & URL Seen' },
      { from: 'sol_parse', to: 'sol_meta', label: 'Update ETag / Trap Cap' },
      { from: 'sol_parse', to: 'sol_s3', label: 'Batch 128MB WARC', async: true },
      { from: 'sol_parse', to: 'sol_idx', label: 'Clean Text + Links', async: true },
      { from: 'sol_parse', to: 'sol_prio', label: 'Unseen Child URLs', async: true },
    ],
    capacityMath: [
      'Throughput: 1B pages / 30 days ≈ 385 pages/sec average -> ~25,000 pages/sec peak burst.',
      'Archive volume: 1B pages × 500 KB raw (~80 KB Zstd compressed) ≈ 80 TB/month in S3 WARC segments (128 MB per object).',
      'URL Seen Bloom Filter: 10B URLs at 1% false-positive rate ≈ 9.6 bits/URL = ~12 GB sharded RAM across Parser nodes.',
    ],
    schemaAndKeys: [
      'Politeness Invariant: worker_shard = consistentHash(registrableDomain)  +  minHeap(next_fetch_ms = last_done_ms + max(robotsDelay, 10 * latency))',
      'Near-Duplicate Fingerprint: 64-bit Charikar SimHash partitioned into 4 × 16-bit tables for fast Hamming-distance <= 3 lookup',
      'Canonicalization: lowercase host, strip utm_*/#fragment, sort query params, cap depth <= 15 & per-host budget',
    ],
    writePath:
      'Politeness Heap pops ready domain -> Fetcher checks cached robots.txt & local unbound DNS -> streams response with strict 2 MB / 5s cap and conditional If-None-Match ETag -> Parser checks 64-bit SimHash for near-duplicates, appends compressed HTML into 128 MB S3 WARC bundles, and feeds unseen canonical child URLs back to Priority Scorer.',
    readPath:
      'Downstream search/ML pipelines consume clean extracted documents from Kafka and replay raw HTML sequentially from S3 WARC objects.',
    storageNotes: [
      'Why 128 MB WARC bundles instead of 1B tiny S3 objects: 1 billion individual S3 PUTs/month costs $5,000 in request fees alone; 128 MB WARC batching cuts S3 PUT ops 1,600×.',
      'RocksDB + RAM Bloom Filter: keeps 10B seen-URL checks sub-millisecond without hammering a relational DB.',
    ],
    staffTradeoffs: [
      'Strict single-queue-per-hostname mapping makes accidental parallel origin DDoS structurally impossible without distributed locks.',
      'Spider-trap immunity: infinite calendar URLs & session-ID loops are halted by per-domain crawl budgets, URL path-pattern entropy caps, and SimHash content dedup.',
    ],
  },

  'post-search': {
    challengeId: 'post-search',
    headline: 'Kafka NRT indexer (1s flush) + 64 doc-partitioned NVMe inverted shards + hedged WAND scatter-gather',
    planes: [
      { title: '01 · SEARCH CALLER', startCol: 0, endCol: 0 },
      { title: '02 · INGRESS & CDC LOG', startCol: 1, endCol: 1 },
      { title: '03 · COORDINATOR & INDEXER', startCol: 2, endCol: 2 },
      { title: '04 · INVERTED SHARDS & S3', startCol: 3, endCol: 3 },
    ],
    nodes: [
      { id: 'sol_client', kind: 'client', label: 'Search Client', spec: 'GET /search?q= · <150ms', col: 0, row: 1 },
      { id: 'sol_gw', kind: 'gateway', label: 'API Gateway', spec: 'Auth · Query Rate Limit', col: 1, row: 1 },
      { id: 'sol_coord', kind: 'service', label: 'Scatter-Gather Coord', spec: '90ms Hedged · Top-K Heap', col: 2, row: 1 },
      { id: 'sol_cache', kind: 'cache', label: 'Trending Query Redis', spec: '10s TTL · Breaking News', col: 2, row: 0 },
      { id: 'sol_hot', kind: 'search', label: 'Hot NVMe Index (64 Shards)', spec: 'Doc-Sharded · Recent 7d', col: 3, row: 0 },
      { id: 'sol_warm', kind: 'search', label: 'Warm Segment Index', spec: 'BM25 + Block-Max WAND', col: 3, row: 1 },
      { id: 'sol_kafka', kind: 'queue', label: 'Post CDC Kafka Stream', spec: '15k posts/s + Deletes', col: 1, row: 2 },
      { id: 'sol_ing', kind: 'worker', label: 'Streaming Tokenizer', spec: 'Stem · Normalizer · 1s Seg', col: 2, row: 2 },
      { id: 'sol_s3', kind: 'blob', label: 'S3 Segment Snapshot Store', spec: 'Fast Replica Recovery', col: 3, row: 2 },
    ],
    edges: [
      { from: 'sol_client', to: 'sol_gw', label: 'GET /search' },
      { from: 'sol_gw', to: 'sol_coord', label: 'gRPC' },
      { from: 'sol_coord', to: 'sol_cache', label: 'Check Hot Query' },
      { from: 'sol_coord', to: 'sol_hot', label: 'Scatter 64 Shards' },
      { from: 'sol_coord', to: 'sol_warm', label: 'If Older Cursor' },
      { from: 'sol_kafka', to: 'sol_ing', label: '15k docs/s', async: true },
      { from: 'sol_ing', to: 'sol_hot', label: '1s Immutable Segment', async: true },
      { from: 'sol_hot', to: 'sol_s3', label: 'Async Snapshot', async: true },
      { from: 'sol_s3', to: 'sol_warm', label: 'Tier >7d Segments', async: true },
    ],
    capacityMath: [
      'Index velocity: 15,000 new posts/sec ÷ 64 doc shards = ~235 docs/sec/shard flushed every 1s into RAM/NVMe segments (<3s NRT visibility).',
      'Hot tier RAM/NVMe: 7 days × 1.3B posts/day × 220 B indexed postings ≈ ~2 TB across 64 shards (~32 GB/shard fits wholly in RAM/NVMe!).',
      'Tail latency budget: 90ms shard deadline + hedged replica retry at 35ms + 8ms coordinator heap merge << 150ms p99.',
    ],
    schemaAndKeys: [
      'Shard Routing: shard_id = murmur3(doc_id) % 64  (Document-partitioned so multi-term AND stays 100% shard-local)',
      'Posting List: term -> [ (doc_id DESC, timestamp, tf_norm, positions[]) ]  ordered newest-first for early Block-Max WAND termination',
      'Soft Deletes: RoaringBitmap per segment marks deleted/private post_ids instantly; purged during background segment merge',
    ],
    writePath:
      'Post create/delete CDC events stream from Kafka -> Tokenizer normalizes & stems tokens -> routes by hash(docId) to shard -> appends lock-free to in-memory buffer flushed every 1 second as an immutable searchable Lucene-style segment (snapshotted to S3).',
    readPath:
      'Scatter-Gather Coordinator checks Redis for viral queries (10s TTL), fans out to 64 Hot NVMe Shards (with hedged read to replica after 35ms), executes Block-Max WAND early-terminating intersection ordered by recency/BM25, and k-way merges top-20 results.',
    storageNotes: [
      'Hot (0–7d) vs. Warm (>7d) Tiering: 92% of social searches only inspect recent 7d posts, letting Hot shards run purely out of RAM/NVMe.',
      'Immutable Segments + S3 Snapshots: zero in-place B-tree locking; crashed search replicas hydrate segments straight from S3 without re-tokenizing.',
    ],
    staffTradeoffs: [
      'Document partitioning vs. Term partitioning: term partitioning requires shipping giant posting lists ("the", "ai") across the network for intersection; doc partitioning keeps intersections local and scales QPS via replicas.',
      'Straggler shard defense: in a 64-shard scatter-gather, shard p99 becomes request p50! Hedged replica requests + returning 63/64 partial results at 110ms deadline eliminates tail spikes.',
    ],
  },
};

function clipRayToShapePerimeter(
  box: { x: number; y: number; w: number; h: number; shape: string },
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

  if (box.shape === 'diamond') {
    const denom = Math.abs(dx) / hw + Math.abs(dy) / hh;
    const t = denom > 0 ? 1 / denom : 0;
    return { x: cx + dx * t, y: cy + dy * t };
  }

  if (box.shape === 'ellipse') {
    const denom = Math.hypot(dx / hw, dy / hh);
    const t = denom > 0 ? 1 / denom : 0;
    return { x: cx + dx * t, y: cy + dy * t };
  }

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
  const nodeBoxes = new Map<string, { x: number; y: number; w: number; h: number; shape: string }>();

  const maxCol = Math.max(...solution.nodes.map((n) => n.col), 3);
  const maxRow = Math.max(...solution.nodes.map((n) => n.row), 2);

  const originX = 60;
  const originY = 136;
  const colStride = 368;
  const rowStride = 178;
  const nodeW = 232;
  const rectH = 86;
  const diamondH = 112;

  const totalDiagramW = maxCol * colStride + nodeW + 48;
  const planeTopY = originY - 42;
  const planeH = maxRow * rowStride + diamondH + 64;

  // 1. Top Blueprint Header Banner
  skeletons.push({
    type: 'rectangle',
    id: `bp_banner_${solution.challengeId}`,
    x: originX - 24,
    y: 20,
    width: totalDiagramW,
    height: 50,
    strokeColor: '#0f172a',
    backgroundColor: '#f1f5f9',
    fillStyle: 'solid',
    strokeWidth: 1.5,
    roughness: 0,
    roundness: { type: 3 },
    customData: { role: 'banner' },
    label: {
      text: `PRINCIPAL BLUEPRINT  ·  ${solution.headline}   (Solid = Sync Hot Path · Dashed = Async Event Flow)`,
      fontSize: 14,
      fontFamily: 2,
    },
  });

  // 2. Bounded Architectural Plane Swimlane Frames (skip overlapping duplicate ranges cleanly)
  const seenRanges = new Set<string>();
  solution.planes.forEach((plane, idx) => {
    const key = `${plane.startCol}:${plane.endCol}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);

    const px = originX - 24 + plane.startCol * colStride;
    const pw = (plane.endCol - plane.startCol) * colStride + nodeW + 48;
    skeletons.push({
      type: 'rectangle',
      id: `bp_zone_${idx}`,
      x: px,
      y: planeTopY,
      width: pw,
      height: planeH,
      strokeColor: '#94a3b8',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeStyle: 'dashed',
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      customData: { role: 'zone' },
    });
    skeletons.push({
      type: 'text',
      id: `bp_zone_lbl_${idx}`,
      x: px + 14,
      y: planeTopY + 12,
      text: plane.title,
      fontSize: 12,
      fontFamily: 2,
      strokeColor: '#475569',
      customData: { role: 'zone' },
    });
  });

  // 3. Production Architecture Nodes (2-line Title + Concrete Spec)
  for (const n of solution.nodes) {
    const preset = STENCIL_PRESETS.find((p) => p.kind === n.kind) ?? STENCIL_PRESETS[3];
    const isDiamond = preset.shape === 'diamond';
    const w = isDiamond ? 242 : nodeW;
    const h = isDiamond ? diamondH : rectH;
    const x = originX + n.col * colStride - (isDiamond ? 5 : 0);
    const y = originY + n.row * rowStride - (isDiamond ? 13 : 0);
    nodeBoxes.set(n.id, { x, y, w, h, shape: preset.shape });

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
      strokeWidth: 1.75,
      roughness: 0,
      roundness: preset.shape === 'rectangle' ? { type: 3 } : null,
      customData: { kind: n.kind },
      label: {
        text: `${n.label}\n${n.spec}`,
        fontSize: isDiamond ? 12 : 13,
        fontFamily: 2,
      },
    });
  }

  // 4. Perimeter-Accurate Sync (Solid) & Async (Dashed) Directed Edges
  solution.edges.forEach((e, idx) => {
    const a = nodeBoxes.get(e.from);
    const b = nodeBoxes.get(e.to);
    if (!a || !b) return;
    const aCx = a.x + a.w / 2;
    const aCy = a.y + a.h / 2;
    const bCx = b.x + b.w / 2;
    const bCy = b.y + b.h / 2;

    const pStart = clipRayToShapePerimeter(a, bCx, bCy, 6);
    const pEnd = clipRayToShapePerimeter(b, aCx, aCy, 8);

    const shortLabel =
      e.label && e.label.length > 18 ? `${e.label.slice(0, 17).trimEnd()}…` : e.label;

    skeletons.push({
      type: 'arrow',
      id: `sol_edge_${idx}`,
      x: pStart.x,
      y: pStart.y,
      points: [
        [0, 0],
        [pEnd.x - pStart.x, pEnd.y - pStart.y],
      ],
      strokeColor: e.async ? '#64748b' : '#1e293b',
      strokeStyle: e.async ? 'dashed' : 'solid',
      strokeWidth: e.async ? 1.4 : 1.75,
      roughness: 0,
      start: { id: e.from },
      end: { id: e.to },
      ...(shortLabel ? { label: { text: shortLabel, fontSize: 12, fontFamily: 2 } } : {}),
    });
  });

  // 5. Bottom Engineering Callout Cards (Capacity Sizing + Schema/Key Invariants)
  const calloutY = planeTopY + planeH + 24;
  const halfW = Math.floor((totalDiagramW - 24) / 2);

  skeletons.push({
    type: 'rectangle',
    id: `bp_math_card_${solution.challengeId}`,
    x: originX - 24,
    y: calloutY,
    width: halfW,
    height: 94,
    strokeColor: '#334155',
    backgroundColor: '#f8fafc',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    customData: { role: 'spec_card' },
    label: {
      text: `CAPACITY & SIZING MATH\n${solution.capacityMath[0] ?? ''}\n${solution.capacityMath[1] ?? ''}`,
      fontSize: 12,
      fontFamily: 2,
    },
  });

  skeletons.push({
    type: 'rectangle',
    id: `bp_schema_card_${solution.challengeId}`,
    x: originX - 24 + halfW + 24,
    y: calloutY,
    width: totalDiagramW - halfW - 24,
    height: 94,
    strokeColor: '#334155',
    backgroundColor: '#f8fafc',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    customData: { role: 'spec_card' },
    label: {
      text: `SCHEMA & KEY INVARIANTS\n${solution.schemaAndKeys[0] ?? ''}\n${solution.schemaAndKeys[1] ?? ''}`,
      fontSize: 12,
      fontFamily: 2,
    },
  });

  return skeletons;
}
