package com.nexuschain.balance.idempotency;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

/**
 * Stores idempotency keys for the processTransaction gRPC endpoint.
 * Prevents double-spending caused by duplicate network requests (retries, double-clicks, etc.).
 *
 * This addresses Gap 3.1 from plan_tecnico_nexuschain.md:
 * The existing ACID locks prevent race conditions on concurrent requests, but NOT
 * duplicate sequential requests with different transaction IDs. This table closes that gap.
 */
@Entity
@Table(
    name = "idempotency_keys",
    indexes = {
        @Index(name = "idx_idempotency_expires", columnList = "expires_at")
    }
)
public class IdempotencyKey {

    public enum Status {
        PROCESSING, COMPLETED, FAILED
    }

    /** UUID sent by the client — used as the primary key to deduplicate requests. */
    @Id
    @Column(name = "idempotency_key", nullable = false, length = 36)
    private String idempotencyKey;

    /**
     * SHA-256 hash of the request payload (fromAccountId + toAccountId + amount).
     * If the same idempotency key is reused with a different payload, we reject it with 409.
     */
    @Column(name = "request_hash", nullable = false, length = 64)
    private String requestHash;

    /** HTTP-equivalent status code of the cached response. */
    @Column(name = "response_status")
    private Integer responseStatus;

    /** Serialized JSON body of the response, returned verbatim on duplicate requests. */
    @Column(name = "response_body", columnDefinition = "TEXT")
    private String responseBody;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private Status status = Status.PROCESSING;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Keys are eligible for cleanup after 24 hours. */
    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    protected IdempotencyKey() {}

    public IdempotencyKey(String idempotencyKey, String requestHash) {
        this.idempotencyKey = idempotencyKey;
        this.requestHash = requestHash;
        this.status = Status.PROCESSING;
        this.createdAt = OffsetDateTime.now();
        this.expiresAt = this.createdAt.plusHours(24);
    }

    // --- Getters & Setters ---

    public String getIdempotencyKey() { return idempotencyKey; }

    public String getRequestHash() { return requestHash; }

    public Integer getResponseStatus() { return responseStatus; }
    public void setResponseStatus(Integer responseStatus) { this.responseStatus = responseStatus; }

    public String getResponseBody() { return responseBody; }
    public void setResponseBody(String responseBody) { this.responseBody = responseBody; }

    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }

    public OffsetDateTime getCreatedAt() { return createdAt; }

    public OffsetDateTime getExpiresAt() { return expiresAt; }
}
