package com.nexuschain.balance;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BalanceApplication {
    public static void main(String[] args) {
        SpringApplication.run(BalanceApplication.class, args);
    }
}
