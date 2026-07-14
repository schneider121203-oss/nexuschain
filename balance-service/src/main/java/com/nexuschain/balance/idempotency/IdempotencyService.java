package com.nexuschain.balance.idempotency;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Implements the Idempotency Layer for the Balance Service.
 *
 * Problem it solves (Gap 3.1 from plan_tecnico_nexuschain.md):
 *   The existing PESSIMISTIC_WRITE locks prevent concurrent double-spending,
 *   but a client retry (after a network timeout) would create a NEW transaction
 *   with a new ID — bypassing the lock. This service detects those duplicates
 *   by caching responses keyed on a client-provided Idempotency-Key.
 *
 * Usage pattern:
 *   1. Client generates a UUID for each *logical operation* (not each HTTP retry).
 *   2. gRPC controller calls checkAndInsert() before business logic.
 *   3. If COMPLETED → return cached response immediately.
 *   4. If PROCESSING → the same key is in-flight (concurrent duplicate) → reject.
 *   5. If absent → insert PROCESSING, run business logic, mark COMPLETED with result.
 */
@Service
public class IdempotencyService {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyService.class);

    @Autowired
    private IdempotencyKeyRepository repository;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    public enum CheckResult {
        /** No prior record — caller should proceed with business logic. */
        PROCEED,
        /** A completed record exists — caller should return the cached response. */
        CACHED,
        /** Same key is currently being processed by another request — reject. */
        IN_FLIGHT,
        /** Key reused with a different payload — reject with conflict. */
        PAYLOAD_MISMATCH
    }

    public record IdempotencyCheckOutcome(CheckResult result, String cachedResponseBody) {}

    /**
     * Checks whether the idempotencyKey has been seen before.
     * If not, inserts a PROCESSING record to "claim" it.
     *
     * Uses REQUIRES_NEW propagation so the INSERT commits immediately,
     * making it visible to concurrent requests (prevents race on duplicate
     * in-flight requests at the DB level via the UUID primary key constraint).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public IdempotencyCheckOutcome checkAndClaim(String idempotencyKey, String requestHash) {
        Optional<IdempotencyKey> existing = repository.findById(idempotencyKey);

        if (existing.isPresent()) {
            IdempotencyKey record = existing.get();

            // Detect payload mismatch — client reusing a key for a different operation
            if (!record.getRequestHash().equals(requestHash)) {
                log.warn("⚠️  Idempotency key '{}' reused with different payload. Rejecting.", idempotencyKey);
                return new IdempotencyCheckOutcome(CheckResult.PAYLOAD_MISMATCH, null);
            }

            if (record.getStatus() == IdempotencyKey.Status.COMPLETED) {
                log.info("♻️  Returning cached response for idempotency key '{}'", idempotencyKey);
                return new IdempotencyCheckOutcome(CheckResult.CACHED, record.getResponseBody());
            }

            if (record.getStatus() == IdempotencyKey.Status.PROCESSING) {
                log.warn("⏳ Idempotency key '{}' is currently PROCESSING (in-flight duplicate). Rejecting.", idempotencyKey);
                return new IdempotencyCheckOutcome(CheckResult.IN_FLIGHT, null);
            }
        }

        // Not seen before — claim it
        try {
            repository.saveAndFlush(new IdempotencyKey(idempotencyKey, requestHash));
            log.info("🆕 New idempotency key '{}' claimed — proceeding with business logic.", idempotencyKey);
            return new IdempotencyCheckOutcome(CheckResult.PROCEED, null);
        } catch (DataIntegrityViolationException e) {
            // Race condition: another thread inserted the same key between our SELECT and INSERT
            log.warn("⏳ Race condition on idempotency key '{}' — treating as IN_FLIGHT.", idempotencyKey);
            return new IdempotencyCheckOutcome(CheckResult.IN_FLIGHT, null);
        }
    }

    /**
     * Marks the idempotency key as COMPLETED and caches the response body.
     * Uses REQUIRES_NEW so the commit happens immediately after the business logic transaction.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markCompleted(String idempotencyKey, int responseStatus, String responseBody) {
        repository.findById(idempotencyKey).ifPresent(record -> {
            record.setStatus(IdempotencyKey.Status.COMPLETED);
            record.setResponseStatus(responseStatus);
            record.setResponseBody(responseBody);
            repository.save(record);
            log.info("✅ Idempotency key '{}' marked COMPLETED.", idempotencyKey);
        });
    }

    /**
     * Marks the idempotency key as FAILED so the client may retry with a new key if needed.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(String idempotencyKey) {
        repository.findById(idempotencyKey).ifPresent(record -> {
            record.setStatus(IdempotencyKey.Status.FAILED);
            repository.save(record);
            log.warn("❌ Idempotency key '{}' marked FAILED.", idempotencyKey);
        });
    }

    // -------------------------------------------------------------------------
    // Cleanup job — runs every hour, deletes expired keys
    // -------------------------------------------------------------------------

    /**
     * Purges expired idempotency keys (older than 24h) to prevent unbounded table growth.
     * Scheduled to run every hour.
     */
    @Scheduled(fixedRateString = "PT1H")
    @Transactional
    public void purgeExpiredKeys() {
        int deleted = repository.deleteByExpiresAtBefore(OffsetDateTime.now());
        if (deleted > 0) {
            log.info("🧹 Purged {} expired idempotency keys.", deleted);
        }
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    /**
     * Computes a deterministic SHA-256 fingerprint of the request payload.
     * Used to detect key reuse with a different payload (misuse of idempotency keys).
     *
     * @param parts Ordered string components of the payload (e.g. fromId, toId, amount)
     * @return Lowercase hex string of the SHA-256 digest
     */
    public static String computeRequestHash(String... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String part : parts) {
                digest.update((part == null ? "" : part).getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0); // separator to avoid collisions like "ab"+"c" vs "a"+"bc"
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available — should never happen on JVM", e);
        }
    }
}
