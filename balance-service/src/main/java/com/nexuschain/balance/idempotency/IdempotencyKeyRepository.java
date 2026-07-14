package com.nexuschain.balance.idempotency;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;

@Repository
public interface IdempotencyKeyRepository extends JpaRepository<IdempotencyKey, String> {

    /**
     * Deletes expired idempotency keys.
     * Called by the scheduled cleanup job in IdempotencyService every hour.
     */
    @Modifying
    @Query("DELETE FROM IdempotencyKey ik WHERE ik.expiresAt < :now")
    int deleteByExpiresAtBefore(@Param("now") OffsetDateTime now);
}
