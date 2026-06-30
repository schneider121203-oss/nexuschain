package com.nexuschain.balance.grpc;

import com.nexuschain.balance.model.Account;
import com.nexuschain.balance.service.BalanceService;
import io.grpc.stub.StreamObserver;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.UUID;

@Component
public class BalanceGrpcController extends BalanceServiceGrpc.BalanceServiceImplBase {

    @Autowired
    private BalanceService balanceService;

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
            responseObserver.onError(io.grpc.Status.INTERNAL
                    .withDescription("Failed to get balance: " + e.getMessage())
                    .asRuntimeException());
        }
    }

    @Override
    public void processTransaction(TransactionRequest request, StreamObserver<TransactionResponse> responseObserver) {
        try {
            BigDecimal amount = BigDecimal.valueOf(request.getAmount());
            BalanceService.TransactionResult result = balanceService.transfer(
                    request.getFromAccountId(),
                    request.getToAccountId(),
                    amount,
                    request.getReferenceId()
            );

            TransactionResponse response = TransactionResponse.newBuilder()
                    .setSuccess(result.isSuccess())
                    .setMessage(result.getMessage())
                    .setTransactionId(result.isSuccess() ? request.getReferenceId() : "")
                    .setRemainingBalance(result.getRemainingBalance().doubleValue())
                    .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (Exception e) {
            responseObserver.onError(io.grpc.Status.INTERNAL
                    .withDescription("Transaction execution failure: " + e.getMessage())
                    .asRuntimeException());
        }
    }
}
