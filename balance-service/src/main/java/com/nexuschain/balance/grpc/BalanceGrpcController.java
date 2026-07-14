package com.nexuschain.balance.grpc;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nexuschain.balance.idempotency.IdempotencyService;
import com.nexuschain.balance.idempotency.IdempotencyService.IdempotencyCheckOutcome;
import com.nexuschain.balance.model.Account;
import com.nexuschain.balance.service.BalanceService;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;

/**
 * gRPC controller for the Balance Service.
 *
 * The processTransaction endpoint is now wrapped by the Idempotency Layer:
 *   - Client sends referenceId (UUID) as the idempotency key.
 *   - Duplicate requests with the same referenceId return the cached response
 *     WITHOUT executing the transfer again — preventing double-spending by retry.
 *
 * This closes Gap 3.1 from plan_tecnico_nexuschain.md.
 */
@Component
public class BalanceGrpcController extends BalanceServiceGrpc.BalanceServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BalanceGrpcController.class);

    @Autowired
    private BalanceService balanceService;

    @Autowired
    private IdempotencyService idempotencyService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // -------------------------------------------------------------------------
    // getBalance — no idempotency needed (read-only)
    // -------------------------------------------------------------------------

    @Override
    public void getBalance(GetBalanceRequest request, StreamObserver<GetBalanceResponse> responseObserver) {
        try {
            Account account = balanceService.getOrCreateAccount(request.getAccountId());
            GetBalanceResponse response = GetBalanceResponse.newBuilder()
                    .setAccountId(account.getAccountId())
                    .setBalance(account.getBalance().doubleValue())
                    .setCurrency(account.getCurrency())
                    .build();
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("Failed to get balance for account {}: {}", request.getAccountId(), e.getMessage(), e);
            responseObserver.onError(Status.INTERNAL
                    .withDescription("Failed to get balance: " + e.getMessage())
                    .asRuntimeException());
        }
    }

    // -------------------------------------------------------------------------
    // processTransaction — protected by Idempotency Layer
    // -------------------------------------------------------------------------

    @Override
    public void processTransaction(TransactionRequest request, StreamObserver<TransactionResponse> responseObserver) {
        final String idempotencyKey = request.getReferenceId();

        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            log.warn("⚠️  processTransaction called without a referenceId — rejecting.");
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("referenceId is required and must be a unique UUID per transaction attempt.")
                    .asRuntimeException());
            return;
        }

        // Compute a fingerprint of the payload to detect key reuse with different parameters
        final String requestHash = IdempotencyService.computeRequestHash(
                request.getFromAccountId(),
                request.getToAccountId(),
                String.valueOf(request.getAmount())
        );

        // --- Idempotency check ---
        IdempotencyCheckOutcome outcome = idempotencyService.checkAndClaim(idempotencyKey, requestHash);

        switch (outcome.result()) {
            case CACHED -> {
                // Return the previously computed result verbatim
                log.info("♻️  Returning cached result for referenceId '{}'", idempotencyKey);
                responseObserver.onNext(deserializeResponse(outcome.cachedResponseBody()));
                responseObserver.onCompleted();
                return;
            }
            case IN_FLIGHT -> {
                responseObserver.onError(Status.ALREADY_EXISTS
                        .withDescription("A transaction with referenceId '" + idempotencyKey + "' is currently being processed. Wait and retry.")
                        .asRuntimeException());
                return;
            }
            case PAYLOAD_MISMATCH -> {
                responseObserver.onError(Status.ALREADY_EXISTS
                        .withDescription("referenceId '" + idempotencyKey + "' was already used with a different payload. Generate a new UUID.")
                        .asRuntimeException());
                return;
            }
            case PROCEED -> {
                // Fall through to business logic
            }
        }

        // --- Execute business logic ---
        try {
            BigDecimal amount = BigDecimal.valueOf(request.getAmount());
            BalanceService.TransactionResult result = balanceService.transfer(
                    request.getFromAccountId(),
                    request.getToAccountId(),
                    amount,
                    idempotencyKey
            );

            TransactionResponse response = TransactionResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setMessage(result.getMessage())
                    .setTransactionId(result.isSuccess() ? idempotencyKey : "")
                    .setRemainingBalance(result.getRemainingBalance().doubleValue())
                    .build();

            // Cache the response for future duplicates
            idempotencyService.markCompleted(idempotencyKey, 200, serializeResponse(response));

            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (Exception e) {
            log.error("Transaction execution failure for referenceId '{}': {}", idempotencyKey, e.getMessage(), e);
            idempotencyService.markFailed(idempotencyKey);
            responseObserver.onError(Status.INTERNAL
                    .withDescription("Transaction execution failure: " + e.getMessage())
                    .asRuntimeException());
        }
    }

    // -------------------------------------------------------------------------
    // Serialization helpers
    // -------------------------------------------------------------------------

    private String serializeResponse(TransactionResponse response) {
        try {
            Map<String, Object> map = Map.of(
                    "success", response.getSuccess(),
                    "message", response.getMessage(),
                    "transactionId", response.getTransactionId(),
                    "remainingBalance", response.getRemainingBalance()
            );
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize TransactionResponse for caching: {}", e.getMessage());
            return "{}";
        }
    }

    private TransactionResponse deserializeResponse(String json) {
        try {
            var map = objectMapper.readValue(json, Map.class);
            return TransactionResponse.newBuilder()
                    .setSuccess((Boolean) map.getOrDefault("success", false))
                    .setMessage((String) map.getOrDefault("message", ""))
                    .setTransactionId((String) map.getOrDefault("transactionId", ""))
                    .setRemainingBalance(((Number) map.getOrDefault("remainingBalance", 0.0)).doubleValue())
                    .build();
        } catch (Exception e) {
            log.error("Failed to deserialize cached TransactionResponse: {}", e.getMessage());
            return TransactionResponse.newBuilder()
                    .setSuccess(false)
                    .setMessage("Error recovering cached response")
                    .build();
        }
    }
}
