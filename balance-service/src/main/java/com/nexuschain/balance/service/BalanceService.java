package com.nexuschain.balance.service;

import com.nexuschain.balance.model.Account;
import com.nexuschain.balance.repository.AccountRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;

@Service
public class BalanceService {

    @Autowired
    private AccountRepository accountRepository;

    @Transactional(readOnly = true)
    public Account getOrCreateAccount(String accountId) {
        return accountRepository.findById(accountId)
                .orElseGet(() -> {
                    // Seed initial demo funds for testing convenience
                    Account newAccount = new Account(accountId, new BigDecimal("1000.0000"), "USD");
                    return accountRepository.save(newAccount);
                });
    }

    /**
     * Processes a transfer between two accounts with strict consistency.
     * Prevents deadlock by locking accounts in alphabetical order.
     */
    @Transactional
    public TransactionResult transfer(String fromAccountId, String toAccountId, BigDecimal amount, String referenceId) {
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            return new TransactionResult(false, "Amount must be greater than zero", BigDecimal.ZERO);
        }

        if (fromAccountId.equals(toAccountId)) {
            return new TransactionResult(false, "Cannot transfer to the same account", BigDecimal.ZERO);
        }

        Account firstLock;
        Account secondLock;

        // 🔒 Deadlock avoidance: lock accounts in alphabetical order of their IDs
        if (fromAccountId.compareTo(toAccountId) < 0) {
            firstLock = lockAccount(fromAccountId);
            secondLock = lockAccount(toAccountId);
        } else {
            firstLock = lockAccount(toAccountId);
            secondLock = lockAccount(fromAccountId);
        }

        Account sender = fromAccountId.equals(firstLock.getAccountId()) ? firstLock : secondLock;
        Account receiver = toAccountId.equals(firstLock.getAccountId()) ? firstLock : secondLock;

        // Verify balance
        if (sender.getBalance().compareTo(amount) < 0) {
            return new TransactionResult(false, "Insufficient funds", sender.getBalance());
        }

        // Perform debit & credit
        sender.setBalance(sender.getBalance().subtract(amount));
        receiver.setBalance(receiver.getBalance().add(amount));

        accountRepository.save(sender);
        accountRepository.save(receiver);

        return new TransactionResult(true, "Transaction processed successfully", sender.getBalance());
    }

    private Account lockAccount(String accountId) {
        return accountRepository.findByIdWithLock(accountId)
                .orElseGet(() -> {
                    // Seed and lock
                    Account newAccount = new Account(accountId, new BigDecimal("1000.0000"), "USD");
                    return accountRepository.saveAndFlush(newAccount);
                });
    }

    public static class TransactionResult {
        private final boolean success;
        private final String message;
        private final BigDecimal remainingBalance;

        public TransactionResult(boolean success, String message, BigDecimal remainingBalance) {
            this.success = success;
            this.message = message;
            this.remainingBalance = remainingBalance;
        }

        public boolean isSuccess() {
            return success;
        }

        public String getMessage() {
            return message;
        }

        public BigDecimal getRemainingBalance() {
            return remainingBalance;
        }
    }
}
